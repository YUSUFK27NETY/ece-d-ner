const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { isDeepStrictEqual } = require("node:util");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    attachCatalogAdminEndpoints
} = require("../src/http/attach-catalog-admin-endpoints");
const {
    attachOrderAdminEndpoints
} = require("../src/http/attach-order-admin-endpoints");
const {
    PUBLIC_ORDER_PATH,
    PUBLIC_ROUTE_HEADERS,
    attachPublicOrderEndpoint
} = require("../src/http/attach-public-order-endpoint");
const { createCatalogService } = require("../src/catalog/catalog-service");
const {
    createProductRecord
} = require("../src/catalog/product-model");
const { createOrderService } = require("../src/orders/order-service");
const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const {
    createPublicRouteAttestationVerifier,
    createPublicRouteSignature
} = require("../src/routing/public-route-attestation");
const {
    createPublicTenantResolver
} = require("../src/routing/public-tenant-resolver");

const NOW = new Date("2026-09-09T20:30:00.000Z");
const DOMAIN = "second.example.com";
const ROUTE_KEY = `business-flow-route-${"z".repeat(32)}`;
const IDEMPOTENCY_KEY = "business-flow-order-00000001";

function guardrailsConfig() {
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

function tenant(tenantId, customDomain) {
    return Object.freeze({
        tenantId,
        displayName: tenantId === "first-tenant" ? "First Tenant" : "Second Tenant",
        sector: "restaurant",
        plan: "starter",
        status: "active",
        features: Object.freeze({ catalog: true, orders: true }),
        profile: Object.freeze({ customDomain })
    });
}

function createTenantRegistry() {
    const records = new Map([
        ["first-tenant", tenant("first-tenant", "first.example.com")],
        ["second-tenant", tenant("second-tenant", DOMAIN)]
    ]);
    return {
        records,
        adapter: Object.freeze({
            async getById(tenantId) {
                return records.get(tenantId) || null;
            },
            async list({ limit }) {
                return [...records.values()].slice(0, limit);
            },
            async create(value) {
                if (records.has(value.tenantId)) {
                    const error = new Error("exists");
                    error.code = "TENANT_ALREADY_EXISTS";
                    throw error;
                }
                records.set(value.tenantId, value);
                return value;
            },
            async update(tenantId, value) {
                if (!records.has(tenantId)) {
                    const error = new Error("missing");
                    error.code = "TENANT_NOT_FOUND";
                    throw error;
                }
                records.set(tenantId, value);
                return value;
            }
        })
    };
}

function createProductRepository() {
    const firstProduct = createProductRecord({
        tenantId: "first-tenant",
        productId: "first-product",
        draft: {
            name: "First Product",
            category: "Main",
            price: 90
        },
        now: new Date(NOW)
    });
    const records = new Map([
        ["first-tenant/first-product", firstProduct]
    ]);
    const audits = [];
    const mutations = [];

    return {
        records,
        audits,
        mutations,
        firstProduct,
        adapter: Object.freeze({
            async listByTenant(tenantId, { limit }) {
                return [...records.values()]
                    .filter(record => record.tenantId === tenantId)
                    .slice(0, limit);
            },
            async getById(tenantId, productId) {
                return records.get(`${tenantId}/${productId}`) || null;
            },
            async commitCreate({ product, auditEvent }) {
                const key = `${product.tenantId}/${product.productId}`;
                if (records.has(key)) {
                    const error = new Error("exists");
                    error.code = "CATALOG_PRODUCT_ALREADY_EXISTS";
                    throw error;
                }
                records.set(key, product);
                audits.push(auditEvent);
                mutations.push({ type: "create", tenantId: product.tenantId, productId: product.productId });
                return product;
            },
            async commitUpdate({ expectedProduct, nextProduct, auditEvent }) {
                const key = `${expectedProduct.tenantId}/${expectedProduct.productId}`;
                const persisted = records.get(key);
                if (!persisted || !isDeepStrictEqual(persisted, expectedProduct)) {
                    const error = new Error("changed");
                    error.code = "CATALOG_PRODUCT_STATE_CHANGED";
                    throw error;
                }
                records.set(key, nextProduct);
                audits.push(auditEvent);
                mutations.push({ type: "update", tenantId: nextProduct.tenantId, productId: nextProduct.productId });
                return nextProduct;
            }
        })
    };
}

function createOrderRepository() {
    const records = new Map();
    const audits = [];
    const mutations = [];

    return {
        records,
        audits,
        mutations,
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
                        const error = new Error("conflict");
                        error.code = "ORDER_IDEMPOTENCY_CONFLICT";
                        throw error;
                    }
                    return Object.freeze({ created: false, order: existing });
                }
                records.set(key, order);
                audits.push(auditEvent);
                mutations.push({ type: "create", tenantId: order.tenantId, orderId: order.orderId });
                return Object.freeze({ created: true, order });
            },
            async commitStatusUpdate({ expectedOrder, nextOrder, auditEvent }) {
                const key = `${expectedOrder.tenantId}/${expectedOrder.orderId}`;
                const persisted = records.get(key);
                if (!persisted || !isDeepStrictEqual(persisted, expectedOrder)) {
                    const error = new Error("changed");
                    error.code = "ORDER_STATE_CHANGED";
                    throw error;
                }
                records.set(key, nextOrder);
                audits.push(auditEvent);
                mutations.push({ type: "status", tenantId: nextOrder.tenantId, orderId: nextOrder.orderId });
                return nextOrder;
            }
        })
    };
}

function adminHeaders(json = false) {
    return {
        Authorization: "Bearer platform-token",
        ...(json ? { "Content-Type": "application/json" } : {})
    };
}

function publicHeaders() {
    const timestamp = NOW.toISOString();
    const signature = createPublicRouteSignature({
        key: ROUTE_KEY,
        method: "POST",
        path: PUBLIC_ORDER_PATH,
        domain: DOMAIN,
        timestamp
    });
    return {
        "Content-Type": "application/json",
        "Idempotency-Key": IDEMPOTENCY_KEY,
        [PUBLIC_ROUTE_HEADERS.domain]: DOMAIN,
        [PUBLIC_ROUTE_HEADERS.timestamp]: timestamp,
        [PUBLIC_ROUTE_HEADERS.signature]: signature
    };
}

async function startFixture() {
    const tenants = createTenantRegistry();
    const products = createProductRepository();
    const orders = createOrderRepository();
    const entitlementService = createEntitlementService({
        config: guardrailsConfig()
    });
    const catalogService = createCatalogService({
        tenantRegistry: tenants.adapter,
        productRepository: products.adapter,
        entitlementService,
        clock: () => new Date(NOW),
        idFactory: () => "second-main-product"
    });
    const orderService = createOrderService({
        tenantRegistry: tenants.adapter,
        productRepository: products.adapter,
        orderRepository: orders.adapter,
        entitlementService,
        clock: () => new Date(NOW)
    });
    const verifier = createPublicRouteAttestationVerifier({
        key: ROUTE_KEY,
        clock: () => NOW.getTime()
    });
    const publicTenantResolver = createPublicTenantResolver({
        routeReader: {
            async getByDomain(domain) {
                if (domain !== DOMAIN) return null;
                return Object.freeze({
                    schemaVersion: 1,
                    domain: DOMAIN,
                    tenantId: "second-tenant",
                    state: "active",
                    observedAt: NOW.toISOString()
                });
            }
        },
        tenantRegistry: tenants.adapter,
        attestationVerifier: verifier
    });
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            return { uid: "tenant-user-1", platformAdmin: false };
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry: tenants.adapter
    });
    attachCatalogAdminEndpoints({ app, catalogService });
    attachOrderAdminEndpoints({ app, orderService });
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
        tenants,
        products,
        orders,
        catalogService,
        orderService
    };
}

async function stop(server) {
    server.close();
    await once(server, "close");
}

test("second tenant gerçek catalog -> public order -> admin order akışı first tenantı değiştirmez", async () => {
    const f = await startFixture();
    const firstTenantBefore = structuredClone(f.tenants.records.get("first-tenant"));
    const firstProductBefore = structuredClone(f.products.records.get("first-tenant/first-product"));

    try {
        const createResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            {
                method: "POST",
                headers: adminHeaders(true),
                body: JSON.stringify({
                    name: "Second Döner",
                    category: "Döner",
                    price: 120,
                    description: "Second tenant ürünü"
                })
            }
        );
        assert.equal(createResponse.status, 201);
        const created = (await createResponse.json()).product;
        assert.equal(created.tenantId, "second-tenant");
        assert.equal(created.productId, "second-main-product");

        const listResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            { headers: adminHeaders() }
        );
        assert.equal(listResponse.status, 200);
        const listed = (await listResponse.json()).products;
        assert.equal(listed.length, 1);
        assert.equal(listed[0].tenantId, "second-tenant");

        const updateResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/${created.productId}`,
            {
                method: "PATCH",
                headers: adminHeaders(true),
                body: JSON.stringify({ price: 135 })
            }
        );
        assert.equal(updateResponse.status, 200);
        assert.equal((await updateResponse.json()).product.price, 135);

        const publicOrderResponse = await fetch(
            `${f.baseUrl}${PUBLIC_ORDER_PATH}`,
            {
                method: "POST",
                headers: publicHeaders(),
                body: JSON.stringify({
                    customerName: "Second Customer",
                    phone: "05551234567",
                    orderType: "dine_in",
                    tableNumber: "T2",
                    note: "Az acılı",
                    items: [{
                        productId: created.productId,
                        quantity: 2,
                        clientPrice: 135
                    }]
                })
            }
        );
        assert.equal(publicOrderResponse.status, 200);
        const publicOrderBody = await publicOrderResponse.json();
        assert.equal(publicOrderBody.order.tenantId, "second-tenant");
        assert.equal(publicOrderBody.order.total, 270);
        const customerProjection = JSON.stringify(publicOrderBody);
        for (const forbidden of [
            "Second Customer",
            "05551234567",
            "Az acılı",
            "tableNumber",
            "requestHash"
        ]) {
            assert.equal(customerProjection.includes(forbidden), false, forbidden);
        }
        const orderId = publicOrderBody.order.orderId;

        const orderListResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders`,
            { headers: adminHeaders() }
        );
        assert.equal(orderListResponse.status, 200);
        const orderList = (await orderListResponse.json()).orders;
        assert.equal(orderList.length, 1);
        assert.equal(orderList[0].orderId, orderId);
        assert.equal(orderList[0].customer.phone, "+905551234567");

        const orderReadResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${orderId}`,
            { headers: adminHeaders() }
        );
        assert.equal(orderReadResponse.status, 200);
        assert.equal((await orderReadResponse.json()).order.tenantId, "second-tenant");

        const statusResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/orders/${orderId}/status`,
            {
                method: "PATCH",
                headers: adminHeaders(true),
                body: JSON.stringify({ status: "preparing" })
            }
        );
        assert.equal(statusResponse.status, 200);
        assert.equal((await statusResponse.json()).order.status, "preparing");

        const archiveResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/${created.productId}/archive`,
            {
                method: "POST",
                headers: adminHeaders()
            }
        );
        assert.equal(archiveResponse.status, 200);
        assert.equal((await archiveResponse.json()).product.archived, true);

        const archivedListResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products?includeArchived=true`,
            { headers: adminHeaders() }
        );
        assert.equal(archivedListResponse.status, 200);
        const archivedList = (await archivedListResponse.json()).products;
        assert.equal(archivedList.length, 1);
        assert.equal(archivedList[0].archived, true);

        assert.deepEqual(
            f.tenants.records.get("first-tenant"),
            firstTenantBefore
        );
        assert.deepEqual(
            f.products.records.get("first-tenant/first-product"),
            firstProductBefore
        );
        assert.equal(
            [...f.orders.records.values()].some(order => order.tenantId === "first-tenant"),
            false
        );
        assert.equal(
            [...f.products.audits, ...f.orders.audits]
                .every(event => event.tenantId === "second-tenant"),
            true
        );
        const auditProjection = JSON.stringify([
            ...f.products.audits,
            ...f.orders.audits
        ]);
        for (const forbidden of ["Second Customer", "05551234567", "Az acılı"]) {
            assert.equal(auditProjection.includes(forbidden), false, forbidden);
        }

        for (const role of ["tenant_owner", "tenant_admin"]) {
            const context = Object.freeze({
                tenantId: "second-tenant",
                role,
                actorId: `${role}-second`
            });
            const productMutationCount = f.products.mutations.length;
            const orderMutationCount = f.orders.mutations.length;

            await assert.rejects(
                () => f.catalogService.create({
                    context,
                    tenantId: "first-tenant",
                    product: {
                        name: "Cross Tenant",
                        category: "Blocked",
                        price: 1
                    },
                    requestId: `${role}-catalog-cross`
                }),
                error => error?.code === "TENANT_SCOPE_MISMATCH"
            );
            await assert.rejects(
                () => f.orderService.listAdmin({
                    context,
                    tenantId: "first-tenant"
                }),
                error => error?.code === "TENANT_SCOPE_MISMATCH"
            );

            assert.equal(f.products.mutations.length, productMutationCount);
            assert.equal(f.orders.mutations.length, orderMutationCount);
        }
    } finally {
        await stop(f.server);
    }
});
