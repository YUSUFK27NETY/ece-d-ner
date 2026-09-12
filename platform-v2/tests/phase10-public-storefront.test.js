const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    createPublicStorefrontService
} = require("../src/public/public-storefront-service");
const {
    attachPublicStorefrontRuntime
} = require("../src/http/attach-public-storefront-runtime");

function tenant(status = "active") {
    return {
        tenantId: "ela-doner",
        displayName: "Ela Döner",
        sector: "restaurant",
        status,
        plan: "starter",
        features: {
            catalog: true,
            orders: true,
            appointments: false,
            reservations: false,
            whatsapp: true,
            inventory: false,
            quotes: false,
            fleet: false,
            gallery: true
        },
        profile: {
            brandName: "ELA DÖNER",
            phone: "+90 342 000 00 00",
            whatsapp: "+90 530 000 00 00",
            email: "merhaba@example.com",
            website: "https://example.com/",
            logoUrl: "https://example.com/logo.png",
            primaryColor: "#C62828",
            address: "Gaziantep",
            timezone: "Europe/Istanbul"
        },
        createdBy: "private-actor",
        internalSecret: "must-not-leak"
    };
}

function product(overrides = {}) {
    return {
        schemaVersion: 1,
        tenantId: "ela-doner",
        productId: "doner-1",
        name: "Dürüm Döner",
        category: "Döner",
        price: 190,
        description: "Lavaş ve közlenmiş sebze",
        available: true,
        archived: false,
        createdAt: "2026-09-11T00:00:00.000Z",
        updatedAt: "2026-09-11T00:00:00.000Z",
        ...overrides
    };
}

function createFixture({ status = "active", unresolvedFeature = null } = {}) {
    const currentTenant = tenant(status);
    const tenantRegistry = {
        async getById(id) {
            return id === "ela-doner" ? currentTenant : null;
        },
        async list() {
            return [currentTenant];
        },
        async create(value) {
            return value;
        },
        async update(id, value) {
            return value;
        }
    };
    const productRepository = {
        async listByTenant(id, options) {
            assert.equal(id, "ela-doner");
            assert.equal(options.limit, 200);
            return [
                product(),
                product({ productId: "kapali-1", name: "Kapalı Ürün", available: false }),
                product({ productId: "arsiv-1", name: "Arşiv Ürün", available: false, archived: true })
            ];
        }
    };
    const entitlementService = {
        evaluate({ tenant: value, feature }) {
            assert.equal(value.tenantId, "ela-doner");
            return {
                feature,
                featureEnabled: value.features[feature] === true,
                usedDefaultPlanPolicy: feature === unresolvedFeature
            };
        }
    };
    return {
        tenantRegistry,
        productRepository,
        entitlementService,
        service: createPublicStorefrontService({
            tenantRegistry,
            productRepository,
            entitlementService
        })
    };
}

async function startServer(options = {}) {
    const fixture = createFixture(options);
    const app = createPlatformApp({
        auth: {
            async verifyIdToken() {
                throw new Error("not used");
            }
        },
        tenantRegistry: fixture.tenantRegistry
    });
    attachPublicStorefrontRuntime({
        app,
        storefrontService: fixture.service,
        rateLimiter: (req, res, next) => next()
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        ...fixture
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

test("aktif tenant storefront güvenli public projection ve yalnız satılabilir ürünleri döndürür", async () => {
    const fixture = createFixture();
    const result = await fixture.service.get({ tenantId: "ela-doner" });

    assert.equal(result.tenant.tenantId, "ela-doner");
    assert.equal(result.tenant.displayName, "Ela Döner");
    assert.equal(result.tenant.features.catalog, true);
    assert.equal(result.tenant.features.orders, true);
    assert.equal(result.products.length, 1);
    assert.deepEqual(Object.keys(result.products[0]).sort(), [
        "category",
        "description",
        "imageUrl",
        "name",
        "price",
        "productId"
    ]);
    assert.equal(result.products[0].imageUrl, "");
    assert.equal(Object.hasOwn(result.tenant, "createdBy"), false);
    assert.equal(Object.hasOwn(result.tenant, "internalSecret"), false);
    assert.equal(Object.hasOwn(result.tenant.profile, "customDomain"), false);
});

test("provisioning/suspended/unknown tenant public storefronttan fail-closed kalır", async () => {
    for (const status of ["provisioning", "suspended", "archived"]) {
        const fixture = createFixture({ status });
        await assert.rejects(
            () => fixture.service.get({ tenantId: "ela-doner" }),
            error => error?.code === "STOREFRONT_NOT_AVAILABLE"
        );
    }

    const fixture = createFixture();
    await assert.rejects(
        () => fixture.service.get({ tenantId: "missing-tenant" }),
        error => error?.code === "STOREFRONT_NOT_AVAILABLE"
    );
});

test("çözümlenemeyen plan policy public feature'ı sessizce kapatır", async () => {
    const fixture = createFixture({ unresolvedFeature: "orders" });
    const result = await fixture.service.get({ tenantId: "ela-doner" });
    assert.equal(result.tenant.features.catalog, true);
    assert.equal(result.tenant.features.orders, false);
});

test("public storefront endpoint auth istemez ama yalnız active tenant yayınlar", async () => {
    const active = await startServer();
    try {
        const response = await fetch(`${active.baseUrl}/api/public/storefront/ela-doner`);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.storefront.tenant.tenantId, "ela-doner");
        assert.equal(body.storefront.products.length, 1);

        const query = await fetch(`${active.baseUrl}/api/public/storefront/ela-doner?debug=1`);
        assert.equal(query.status, 400);
    } finally {
        await closeServer(active.server);
    }

    const provisioning = await startServer({ status: "provisioning" });
    try {
        const response = await fetch(`${provisioning.baseUrl}/api/public/storefront/ela-doner`);
        const body = await response.json();
        assert.equal(response.status, 404);
        assert.equal(body.message, "İşletme sayfası bulunamadı.");
    } finally {
        await closeServer(provisioning.server);
    }
});

test("direct-link /m/:tenantId storefront shell ve sıkı CSP ile sunulur", async () => {
    const fixture = await startServer();
    try {
        const response = await fetch(`${fixture.baseUrl}/m/ela-doner`);
        const html = await response.text();
        assert.equal(response.status, 200);
        assert.match(html, /id="storefront"/);
        assert.match(html, /\/m\/storefront\.js/);
        assert.match(response.headers.get("content-security-policy"), /script-src 'self'/);
        assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);

        const invalid = await fetch(`${fixture.baseUrl}/m/ELA-DONER`);
        assert.equal(invalid.status, 404);
    } finally {
        await closeServer(fixture.server);
    }
});

test("storefront frontend safe DOM projection kullanır ve QR zorunluluğu içermez", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/storefront/index.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/storefront/storefront.js"), "utf8");

    assert.match(html, /Paylaş/);
    assert.match(html, /WhatsApp'tan Sipariş Ver/);
    assert.match(script, /\/api\/public\/storefront\//);
    assert.match(script, /navigator\.share/);
    assert.match(script, /textContent/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
    assert.doesNotMatch(script, /document\.write/);
});
