const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const { attachOrderAdminEndpoints } = require("../src/http/attach-order-admin-endpoints");
const { createOrderService } = require("../src/orders/order-service");
const { issueTrustedTenantResolution } = require("../src/orders/trusted-tenant-resolution");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createProductRecord } = require("../src/catalog/product-model");

const NOW = new Date("2026-09-09T19:00:00.000Z");
const IDEM = "admin-api-order-key-0001";

function config() {
    return Object.freeze({
        plans: Object.freeze({
            default: Object.freeze({
                allowedFeatures: "*",
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }),
            starter: Object.freeze({
                allowedFeatures: Object.freeze(["catalog", "orders"]),
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            })
        }),
        tenantOverrides: Object.freeze({}),
        finops: Object.freeze({ defaultMonthlyRevenue: 2000 })
    });
}

function tenant(id, plan = "starter") {
    return Object.freeze({
        tenantId: id,
        displayName: id,
        sector: "restaurant",
        plan,
        status: "active",
        features: Object.freeze({ catalog: true, orders: true })
    });
}

function makeOrderRepository() {
    const records = new Map();
    const audits = [];
    return {
        records,
        audits,
        adapter: Object.freeze({
            async getById(tenantId, orderId) {
                return records.get(`${tenantId}/${orderId}`) || null;
            },
            async listByTenant(tenantId, { limit }) {
                return [...records.values()]
                    .filter(order => order.tenantId === tenantId)
                    .slice(0, limit);
            },
            async commitCreate({ order, auditEvent }) {
                const key = `${order.tenantId}/${order.orderId}`;
                const existing = records.get(key);
                if (existing) return { created: false, order: existing };
                records.set(key, order);
                audits.push(auditEvent);
                return { created: true, order };
            },
            async commitStatusUpdate({ nextOrder, auditEvent }) {
                records.set(`${nextOrder.tenantId}/${nextOrder.orderId}`, nextOrder);
                audits.push(auditEvent);
                return nextOrder;
            }
        })
    };
}

async function fixture({ secondPlan = "starter" } = {}) {
    const tenants = new Map([
        ["first-tenant", tenant("first-tenant")],
        ["second-tenant", tenant("second-tenant", secondPlan)]
    ]);
    const tenantRegistry = {
        async getById(id) { return tenants.get(id) || null; },
        async list({ limit }) { return [...tenants.values()].slice(0, limit); },
        async create(value) { tenants.set(value.tenantId, value); return value; },
        async update(id, value) { tenants.set(id, value); return value; }
    };
    const firstProduct = createProductRecord({
        tenantId: "first-tenant",
        productId: "first-product",
        draft: { name: "First Product", category: "Main", price: 100 },
        now: new Date(NOW)
    });
    const secondProduct = createProductRecord({
        tenantId: "second-tenant",
        productId: "product-1",
        draft: { name: "Test Döner", category: "Main", price: 120 },
        now: new Date(NOW)
    });
    const products = new Map([
        ["first-tenant/first-product", firstProduct],
        ["second-tenant/product-1", secondProduct]
    ]);
    const orderState = makeOrderRepository();
    let tick = 0;
    const orderService = createOrderService({
        tenantRegistry,
        productRepository: {
            async getById(tenantId, productId) {
                return products.get(`${tenantId}/${productId}`) || null;
            }
        },
        orderRepository: orderState.adapter,
        entitlementService: createEntitlementService({ config: config() }),
        clock: () => new Date(NOW.getTime() + (++tick * 1000))
    });
    const created = await orderService.createCustomerOrder({
        resolution: issueTrustedTenantResolution({
            tenantId: "second-tenant",
            source: "internal_test",
            observedAt: new Date(NOW)
        }),
        request: {
            customerName: "Test Customer",
            phone: "05000000000",
            orderType: "dine_in",
            tableNumber: "T1",
            items: [{ productId: "product-1", quantity: 1, clientPrice: 120 }]
        },
        idempotencyKey: IDEM,
        requestId: "req-seed"
    });

    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (token === "tenant-token") {
                return { uid: "tenant-user-1", platformAdmin: false };
            }
            throw new Error("invalid-token-marker");
        }
    };
    const app = createPlatformApp({ auth, tenantRegistry });
    attachOrderAdminEndpoints({ app, orderService });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        orderState,
        orderId: created.orderId,
        firstProduct,
        products
    };
}

async function close(server) {
    server.close();
    await once(server, "close");
}

function headers(token = "platform-token", json = false) {
    return {
        Authorization: `Bearer ${token}`,
        ...(json ? { "Content-Type": "application/json" } : {})
    };
}

test("order admin routes existing Platform Admin middleware arkasındadır", async () => {
    const f = await fixture();
    try {
        const unauth = await fetch(`${f.baseUrl}/api/platform/tenants/second-tenant/orders`);
        assert.equal(unauth.status, 401);
        const tenantToken = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders`,
            { headers: headers("tenant-token") }
        );
        assert.equal(tenantToken.status, 403);
    } finally {
        await close(f.server);
    }
});

test("Platform Admin exact second-tenant list/read/status flow yapar ve first tenant verisi değişmez", async () => {
    const f = await fixture();
    try {
        const listResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders?limit=10`,
            { headers: headers() }
        );
        assert.equal(listResponse.status, 200);
        const list = await listResponse.json();
        assert.equal(list.orders.length, 1);
        assert.equal(list.orders[0].orderId, f.orderId);
        assert.equal(list.orders[0].customer.name, "Test Customer");
        assert.equal("requestHash" in list.orders[0], false);

        const readResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${f.orderId}`,
            { headers: headers() }
        );
        assert.equal(readResponse.status, 200);
        assert.equal((await readResponse.json()).order.orderId, f.orderId);

        const updateResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${f.orderId}/status`,
            {
                method: "PATCH",
                headers: headers("platform-token", true),
                body: JSON.stringify({ status: "preparing" })
            }
        );
        assert.equal(updateResponse.status, 200);
        assert.equal((await updateResponse.json()).order.status, "preparing");

        assert.equal(f.products.get("first-tenant/first-product"), f.firstProduct);
        assert.equal([...f.orderState.records.values()].some(order => order.tenantId === "first-tenant"), false);
        const statusAudit = f.orderState.audits.at(-1);
        assert.equal(statusAudit.action, "order.status.updated");
        assert.equal(statusAudit.actorId, "platform-admin-1");
        assert.equal(typeof statusAudit.requestId, "string");
        assert.equal(JSON.stringify(statusAudit).includes("Test Customer"), false);
    } finally {
        await close(f.server);
    }
});

test("status route exact body/query ister ve invalid/terminal transition safe conflict döner", async () => {
    const f = await fixture();
    try {
        const extraBody = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${f.orderId}/status`,
            {
                method: "PATCH",
                headers: headers("platform-token", true),
                body: JSON.stringify({ status: "preparing", providerBody: "raw-marker" })
            }
        );
        assert.equal(extraBody.status, 400);
        assert.equal(JSON.stringify(await extraBody.json()).includes("raw-marker"), false);

        const query = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${f.orderId}/status?force=true`,
            {
                method: "PATCH",
                headers: headers("platform-token", true),
                body: JSON.stringify({ status: "preparing" })
            }
        );
        assert.equal(query.status, 400);

        const invalid = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${f.orderId}/status`,
            {
                method: "PATCH",
                headers: headers("platform-token", true),
                body: JSON.stringify({ status: "completed" })
            }
        );
        assert.equal(invalid.status, 409);
        const body = await invalid.json();
        assert.equal(body.message.includes("Test Customer"), false);
    } finally {
        await close(f.server);
    }
});

test("unknown plan order admin HTTP boundaryde fail-closed olur", async () => {
    const f = await fixture({ secondPlan: "ghost-plan" });
    try {
        const response = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders`,
            { headers: headers() }
        );
        assert.equal(response.status, 409);
        assert.equal(JSON.stringify(await response.json()).includes("ghost-plan"), false);
    } finally {
        await close(f.server);
    }
});
