const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createPublicStorefrontService
} = require("../src/public/public-storefront-service");

function createTenant(overrides = {}) {
    return {
        tenantId: "ela-doner",
        displayName: "Ela Döner",
        sector: "restaurant",
        status: "active",
        plan: "starter",
        features: {
            catalog: true,
            orders: true,
            appointments: false,
            reservations: false,
            whatsapp: false,
            inventory: false,
            quotes: false,
            crm: false,
            fleet: false,
            gallery: true,
            delivery: false,
            campaigns: false,
            loyalty: false,
            staff: false,
            reviews: false,
            analytics: false
        },
        profile: {
            brandName: "ELA DÖNER",
            phone: "+90 507 474 02 27",
            whatsapp: "+90 507 474 02 27",
            address: "Gaziantep",
            primaryColor: "#C62828",
            timezone: "Europe/Istanbul"
        },
        ...overrides
    };
}

function createFixture({ tenantOverrides = {}, unresolvedFeature = null } = {}) {
    const tenant = createTenant(tenantOverrides);
    const tenantRegistry = {
        async getById(id) {
            return id === tenant.tenantId ? tenant : null;
        }
    };
    const productRepository = {
        async listByTenant(id, options) {
            assert.equal(id, tenant.tenantId);
            assert.equal(options.limit, 200);
            return [];
        }
    };
    const entitlementService = {
        evaluate({ tenant: current, feature }) {
            return {
                feature,
                featureEnabled: current.features[feature] === true,
                usedDefaultPlanPolicy: feature === unresolvedFeature
            };
        }
    };

    return createPublicStorefrontService({
        tenantRegistry,
        productRepository,
        entitlementService
    });
}

test("public storefront response presentation alanını additive döndürür", async () => {
    const service = createFixture();
    const result = await service.get({ tenantId: "ela-doner" });

    assert.deepEqual(Object.keys(result).sort(), ["presentation", "products", "tenant"]);
    assert.equal(result.tenant.tenantId, "ela-doner");
    assert.equal(Array.isArray(result.products), true);
    assert.equal(result.presentation.tier, "starter");
    assert.equal(result.presentation.source, "legacy_fallback");
});

test("legacy Business plan presentation seçmeden Starter fallbackte kalır", async () => {
    const service = createFixture({
        tenantOverrides: { plan: "business" }
    });
    const result = await service.get({ tenantId: "ela-doner" });

    assert.equal(result.presentation.tier, "starter");
    assert.equal(result.presentation.source, "legacy_fallback");
});

test("explicit presentation plan bilgisinden bağımsız public manifeste yansır", async () => {
    const service = createFixture({
        tenantOverrides: {
            plan: "starter",
            presentation: { tier: "business", version: 1 }
        }
    });
    const result = await service.get({ tenantId: "ela-doner" });

    assert.equal(result.presentation.tier, "business");
    assert.equal(result.presentation.source, "configured");
    assert.equal(result.presentation.components.hero, "featured");
});

test("presentation bölümleri stored değil effective feature setini kullanır", async () => {
    const service = createFixture({
        unresolvedFeature: "orders",
        tenantOverrides: {
            presentation: { tier: "pro", version: 1 },
            features: {
                ...createTenant().features,
                catalog: true,
                orders: true,
                gallery: false
            }
        }
    });
    const result = await service.get({ tenantId: "ela-doner" });
    const sections = result.presentation.sections.map(section => section.id);

    assert.equal(result.tenant.features.orders, false);
    assert.equal(result.presentation.tier, "pro");
    assert.equal(sections.includes("modules"), false);
    assert.equal(sections.includes("offering"), true);
    assert.equal(sections.includes("gallery"), false);
});
