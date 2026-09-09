const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    PUBLIC_ORDER_PATH,
    PUBLIC_ROUTE_HEADERS,
    attachPublicOrderEndpoint
} = require("../src/http/attach-public-order-endpoint");
const {
    createPublicRouteAttestationVerifier,
    createPublicRouteSignature
} = require("../src/routing/public-route-attestation");
const { createPublicTenantResolver } = require("../src/routing/public-tenant-resolver");
const {
    createFirestorePublicRouteReader
} = require("../src/firestore/firestore-public-route-reader");
const { createOrderService } = require("../src/orders/order-service");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createProductRecord } = require("../src/catalog/product-model");

const NOW = new Date("2026-09-09T19:30:00.000Z");
const ROUTE_KEY = `route-test-${"x".repeat(32)}`;
const DOMAIN = "second.example.com";
const IDEM = "public-order-key-00000001";

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

function tenant(id, {
    plan = "starter",
    status = "active",
    ordersEnabled = true,
    customDomain = null
} = {}) {
    return Object.freeze({
        tenantId: id,
        displayName: id,
        sector: "restaurant",
        plan,
        status,
        features: Object.freeze({ catalog: true, orders: ordersEnabled }),
        profile: Object.freeze({ customDomain })
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
                if (existing) {
                    if (existing.requestHash !== order.requestHash) {
                        const error = new Error("conflict-marker");
                        error.code = "ORDER_IDEMPOTENCY_CONFLICT";
                        throw error;
                    }
                    return Object.freeze({ created: false, order: existing });
                }
                records.set(key, order);
                audits.push(auditEvent);
                return Object.freeze({ created: true, order });
            },
            async commitStatusUpdate({ nextOrder, auditEvent }) {
                records.set(`${nextOrder.tenantId}/${nextOrder.orderId}`, nextOrder);
                audits.push(auditEvent);
                return nextOrder;
            }
        })
    };
}

async function fixture({
    secondPlan = "starter",
    secondStatus = "active",
    ordersEnabled = true,
    routeTenantId = "second-tenant",
    routePresent = true
} = {}) {
    const tenants = new Map([
        ["first-tenant", tenant("first-tenant", { customDomain: "first.example.com" })],
        ["second-tenant", tenant("second-tenant", {
            plan: secondPlan,
            status: secondStatus,
            ordersEnabled,
            customDomain: DOMAIN
        })]
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
    const entitlementService = createEntitlementService({ config: config() });
    const orderService = createOrderService({
        tenantRegistry,
        productRepository: {
            async getById(tenantId, productId) {
                return products.get(`${tenantId}/${productId}`) || null;
            }
        },
        orderRepository: orderState.adapter,
        entitlementService,
        clock: () => new Date(NOW)
    });
    const routes = new Map();
    if (routePresent) {
        routes.set(DOMAIN, Object.freeze({
            schemaVersion: 1,
            domain: DOMAIN,
            tenantId: routeTenantId,
            state: "active",
            observedAt: NOW.toISOString()
        }));
    }
    const verifier = createPublicRouteAttestationVerifier({
        key: ROUTE_KEY,
        clock: () => NOW.getTime(),
        maxSkewMs: 60_000
    });
    const publicTenantResolver = createPublicTenantResolver({
        routeReader: {
            async getByDomain(domain) { return routes.get(domain) || null; }
        },
        tenantRegistry,
        attestationVerifier: verifier
    });
    const auth = {
        async verifyIdToken() { throw new Error("not-used-marker"); }
    };
    const app = createPlatformApp({ auth, tenantRegistry });
    attachPublicOrderEndpoint({
        app,
        orderService,
        publicTenantResolver,
        rateLimiter: (_req, _res, next) => next()
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        orderState,
        products,
        firstProduct,
        routes,
        tenants
    };
}

async function close(server) {
    server.close();
    await once(server, "close");
}

function signedHeaders({
    domain = DOMAIN,
    timestamp = NOW.toISOString(),
    signature = null,
    idempotencyKey = IDEM
} = {}) {
    const computed = signature || createPublicRouteSignature({
        key: ROUTE_KEY,
        method: "POST",
        path: PUBLIC_ORDER_PATH,
        domain,
        timestamp
    });
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        [PUBLIC_ROUTE_HEADERS.domain]: domain,
        [PUBLIC_ROUTE_HEADERS.timestamp]: timestamp,
        [PUBLIC_ROUTE_HEADERS.signature]: computed
    };
}

function orderBody(overrides = {}) {
    return {
        customerName: "Test Customer",
        phone: "05551234567",
        orderType: "dine_in",
        tableNumber: "T1",
        items: [{ productId: "product-1", quantity: 1, clientPrice: 120 }],
        ...overrides
    };
}

test("signed second-tenant public order flow exact tenantta idempotent ve PII-safe çalışır", async () => {
    const f = await fixture();
    try {
        const first = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders(),
            body: JSON.stringify(orderBody())
        });
        assert.equal(first.status, 200);
        const firstBody = await first.json();
        assert.equal(firstBody.success, true);
        assert.equal(firstBody.order.tenantId, "second-tenant");
        assert.equal(firstBody.order.total, 120);
        const serialized = JSON.stringify(firstBody);
        for (const forbidden of ["05551234567", "Test Customer", "requestHash", "tableNumber", "note"]) {
            assert.equal(serialized.includes(forbidden), false, forbidden);
        }
        assert.equal(f.orderState.records.size, 1);
        assert.equal(f.orderState.audits.length, 1);
        assert.equal([...f.orderState.records.values()][0].tenantId, "second-tenant");
        assert.equal(JSON.stringify(f.orderState.audits[0]).includes("05551234567"), false);
        assert.equal(f.products.get("first-tenant/first-product"), f.firstProduct);

        const replay = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders(),
            body: JSON.stringify(orderBody())
        });
        assert.equal(replay.status, 200);
        const replayBody = await replay.json();
        assert.equal(replayBody.order.orderId, firstBody.order.orderId);
        assert.equal(f.orderState.records.size, 1);
        assert.equal(f.orderState.audits.length, 1);
    } finally {
        await close(f.server);
    }
});

test("caller tenantId body/query ile tenant seçemez", async () => {
    const f = await fixture();
    try {
        const bodySpoof = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders(),
            body: JSON.stringify(orderBody({ tenantId: "first-tenant" }))
        });
        assert.equal(bodySpoof.status, 400);

        const querySpoof = await fetch(
            `${f.baseUrl}${PUBLIC_ORDER_PATH}?tenantId=first-tenant`,
            {
                method: "POST",
                headers: signedHeaders(),
                body: JSON.stringify(orderBody())
            }
        );
        assert.equal(querySpoof.status, 400);
        assert.equal(f.orderState.records.size, 0);
        assert.equal(f.orderState.audits.length, 0);
    } finally {
        await close(f.server);
    }
});

test("forged veya stale edge attestation mutationdan önce fail-closed olur", async () => {
    const f = await fixture();
    try {
        const forged = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders({ signature: "0".repeat(64) }),
            body: JSON.stringify(orderBody())
        });
        assert.equal(forged.status, 404);

        const staleTimestamp = new Date(NOW.getTime() - 5 * 60_000).toISOString();
        const stale = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders({ timestamp: staleTimestamp }),
            body: JSON.stringify(orderBody())
        });
        assert.equal(stale.status, 404);
        assert.equal(f.orderState.records.size, 0);
        assert.equal(f.orderState.audits.length, 0);
    } finally {
        await close(f.server);
    }
});

test("route missing veya domain->tenant/profile mismatch mutationdan önce reddedilir", async () => {
    for (const options of [
        { routePresent: false },
        { routeTenantId: "first-tenant" }
    ]) {
        const f = await fixture(options);
        try {
            const response = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
                method: "POST",
                headers: signedHeaders(),
                body: JSON.stringify(orderBody())
            });
            assert.equal(response.status, 404);
            assert.equal(f.orderState.records.size, 0);
            assert.equal(f.orderState.audits.length, 0);
        } finally {
            await close(f.server);
        }
    }
});

test("caller fiyatı canonical ürün fiyatını override edemez", async () => {
    const f = await fixture();
    try {
        const response = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
            method: "POST",
            headers: signedHeaders(),
            body: JSON.stringify(orderBody({
                items: [{ productId: "product-1", quantity: 1, clientPrice: 99 }]
            }))
        });
        assert.equal(response.status, 409);
        assert.equal(f.orderState.records.size, 0);
    } finally {
        await close(f.server);
    }
});

test("unknown plan, orders disabled ve non-active tenant public orderı fail-closed kapatır", async () => {
    for (const options of [
        { secondPlan: "ghost-plan" },
        { ordersEnabled: false },
        { secondStatus: "suspended" }
    ]) {
        const f = await fixture(options);
        try {
            const response = await fetch(`${f.baseUrl}${PUBLIC_ORDER_PATH}`, {
                method: "POST",
                headers: signedHeaders(),
                body: JSON.stringify(orderBody())
            });
            assert.equal([404, 409].includes(response.status), true);
            assert.equal(f.orderState.records.size, 0);
            assert.equal(f.orderState.audits.length, 0);
        } finally {
            await close(f.server);
        }
    }
});

test("Firestore public route reader yalnız exact safe route projection kabul eder", async () => {
    const reads = [];
    const db = {
        collection(name) {
            assert.equal(name, "platformTenantPublicRoutes");
            return {
                doc(domain) {
                    reads.push(domain);
                    return {
                        async get() {
                            return {
                                exists: true,
                                id: domain,
                                data() {
                                    return {
                                        schemaVersion: 1,
                                        domain,
                                        tenantId: "second-tenant",
                                        state: "active",
                                        observedAt: NOW.toISOString()
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
    const reader = createFirestorePublicRouteReader({ db });
    const route = await reader.getByDomain(DOMAIN);
    assert.deepEqual(route, {
        schemaVersion: 1,
        domain: DOMAIN,
        tenantId: "second-tenant",
        state: "active",
        observedAt: NOW.toISOString()
    });
    assert.deepEqual(reads, [DOMAIN]);
    assert.equal("provider" in route, false);
});
