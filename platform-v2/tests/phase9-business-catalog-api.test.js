const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const { attachCatalogAdminEndpoints } = require("../src/http/attach-catalog-admin-endpoints");
const { createCatalogService } = require("../src/catalog/catalog-service");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createProductRecord } = require("../src/catalog/product-model");

const NOW = new Date("2026-09-09T18:00:00.000Z");

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
                allowedFeatures: Object.freeze(["catalog"]),
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
        status: "provisioning",
        features: Object.freeze({ catalog: true })
    });
}

function repository(seed = []) {
    const records = new Map(seed.map(product => [
        `${product.tenantId}/${product.productId}`,
        product
    ]));
    const audits = [];
    return {
        records,
        audits,
        adapter: Object.freeze({
            async listByTenant(tenantId, { limit }) {
                return [...records.values()]
                    .filter(product => product.tenantId === tenantId)
                    .slice(0, limit);
            },
            async getById(tenantId, productId) {
                return records.get(`${tenantId}/${productId}`) || null;
            },
            async commitCreate({ product, auditEvent }) {
                records.set(`${product.tenantId}/${product.productId}`, product);
                audits.push(auditEvent);
                return product;
            },
            async commitUpdate({ nextProduct, auditEvent }) {
                records.set(`${nextProduct.tenantId}/${nextProduct.productId}`, nextProduct);
                audits.push(auditEvent);
                return nextProduct;
            }
        })
    };
}

async function fixture({ secondPlan = "starter" } = {}) {
    const tenants = new Map([
        ["first-tenant", tenant("first-tenant")],
        ["second-tenant", tenant("second-tenant", secondPlan)]
    ]);
    const firstProduct = createProductRecord({
        tenantId: "first-tenant",
        productId: "first-product",
        draft: { name: "First Product", category: "Main", price: 100 },
        now: new Date(NOW)
    });
    const productState = repository([firstProduct]);
    const tenantRegistry = {
        async getById(id) { return tenants.get(id) || null; },
        async list({ limit }) { return [...tenants.values()].slice(0, limit); },
        async create(value) { tenants.set(value.tenantId, value); return value; },
        async update(id, value) { tenants.set(id, value); return value; }
    };
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (token === "tenant-token") {
                return { uid: "tenant-owner-1", platformAdmin: false };
            }
            throw new Error("invalid-token-marker");
        }
    };
    const catalogService = createCatalogService({
        tenantRegistry,
        productRepository: productState.adapter,
        entitlementService: createEntitlementService({ config: config() }),
        clock: () => new Date(NOW),
        idFactory: () => "second-product"
    });
    const app = createPlatformApp({ auth, tenantRegistry });
    attachCatalogAdminEndpoints({ app, catalogService });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        tenants,
        productState,
        firstProduct
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

test("catalog admin API unauthenticated ve non-platform-admin istekleri mevcut middleware ile reddeder", async () => {
    const f = await fixture();
    try {
        const unauth = await fetch(`${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`);
        assert.equal(unauth.status, 401);

        const tenantToken = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            { headers: headers("tenant-token") }
        );
        assert.equal(tenantToken.status, 403);
        assert.equal(f.productState.records.has("second-tenant/second-product"), false);
    } finally {
        await close(f.server);
    }
});

test("Platform Admin second-tenant catalog create/list/update/archive gerçek application service üzerinden çalışır", async () => {
    const f = await fixture();
    try {
        const createdResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            {
                method: "POST",
                headers: headers("platform-token", true),
                body: JSON.stringify({
                    name: "Second Döner",
                    category: "Döner",
                    price: 220,
                    description: "second"
                })
            }
        );
        assert.equal(createdResponse.status, 201);
        const created = await createdResponse.json();
        assert.equal(created.product.tenantId, "second-tenant");
        assert.equal(created.product.productId, "second-product");

        const listResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            { headers: headers() }
        );
        assert.equal(listResponse.status, 200);
        const listed = await listResponse.json();
        assert.deepEqual(listed.products.map(product => product.productId), ["second-product"]);

        const updateResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product`,
            {
                method: "PATCH",
                headers: headers("platform-token", true),
                body: JSON.stringify({ price: 240 })
            }
        );
        assert.equal(updateResponse.status, 200);
        assert.equal((await updateResponse.json()).product.price, 240);

        const archiveResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product/archive`,
            { method: "POST", headers: headers() }
        );
        assert.equal(archiveResponse.status, 200);
        assert.equal((await archiveResponse.json()).product.archived, true);

        const hiddenResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            { headers: headers() }
        );
        assert.deepEqual((await hiddenResponse.json()).products, []);

        const allResponse = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products?includeArchived=true&limit=10`,
            { headers: headers() }
        );
        assert.equal((await allResponse.json()).products.length, 1);

        assert.equal(f.productState.records.get("first-tenant/first-product"), f.firstProduct);
        assert.equal(f.productState.audits.length, 3);
        assert.equal(f.productState.audits.every(event =>
            event.tenantId === "second-tenant" &&
            event.actorId === "platform-admin-1" &&
            typeof event.requestId === "string"
        ), true);
    } finally {
        await close(f.server);
    }
});

test("unknown plan HTTP boundaryde fail-closed conflict olur ve default plan grant edilmez", async () => {
    const f = await fixture({ secondPlan: "ghost-plan" });
    try {
        const response = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            {
                method: "POST",
                headers: headers("platform-token", true),
                body: JSON.stringify({ name: "Blocked", category: "Main", price: 10 })
            }
        );
        assert.equal(response.status, 409);
        const body = await response.json();
        assert.equal(body.message.includes("ghost-plan"), false);
        assert.equal(f.productState.records.has("second-tenant/second-product"), false);
        assert.equal(f.productState.audits.length, 0);
    } finally {
        await close(f.server);
    }
});

test("archive body/query kabul etmez ve repeated archive duplicate audit üretmez", async () => {
    const f = await fixture();
    try {
        await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            {
                method: "POST",
                headers: headers("platform-token", true),
                body: JSON.stringify({ name: "Archive", category: "Main", price: 10 })
            }
        );
        const withQuery = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product/archive?force=true`,
            { method: "POST", headers: headers() }
        );
        assert.equal(withQuery.status, 400);

        const withBody = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product/archive`,
            {
                method: "POST",
                headers: headers("platform-token", true),
                body: JSON.stringify({ force: true })
            }
        );
        assert.equal(withBody.status, 400);

        const first = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product/archive`,
            { method: "POST", headers: headers() }
        );
        assert.equal(first.status, 200);
        const auditCount = f.productState.audits.length;

        const repeated = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products/second-product/archive`,
            { method: "POST", headers: headers() }
        );
        assert.equal(repeated.status, 200);
        assert.equal(f.productState.audits.length, auditCount);
    } finally {
        await close(f.server);
    }
});

test("catalog query/body validation safe ve bilinmeyen provider-benzeri input projectiona giremez", async () => {
    const f = await fixture();
    try {
        const invalidQuery = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products?providerBody=x`,
            { headers: headers() }
        );
        assert.equal(invalidQuery.status, 400);

        const hostile = await fetch(
            `${f.baseUrl}/api/platform/tenants/second-tenant/catalog/products`,
            {
                method: "POST",
                headers: headers("platform-token", true),
                body: JSON.stringify({
                    name: "Safe Product",
                    category: "Main",
                    price: 10,
                    token: "raw-token-marker"
                })
            }
        );
        assert.equal(hostile.status, 400);
        assert.equal(JSON.stringify(await hostile.json()).includes("raw-token-marker"), false);
    } finally {
        await close(f.server);
    }
});
