const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const {
    createCommercialPlanPreviewService
} = require("../src/entitlements/commercial-plan-preview-service");
const {
    createTenantRecord
} = require("../src/tenant/tenant-record");

function platformContext() {
    return Object.freeze({
        role: "platform_admin",
        actorId: "platform-admin-1"
    });
}

function configFixture({ tenantOverrides = {} } = {}) {
    return loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            "alpha-plan": {
                allowedFeatures: ["catalog", "orders"],
                softRequestLimit: 100,
                warningThreshold: 0.7,
                dedicatedReviewThreshold: 1.2,
                monthlyRevenueReference: 12345678
            },
            "beta-plan": {
                allowedFeatures: [
                    "catalog",
                    "appointments",
                    "reservations"
                ],
                softRequestLimit: 200,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1.5,
                monthlyRevenueReference: 87654321
            }
        },
        tenantOverrides
    }));
}

function tenantFixture(overrides = {}) {
    return createTenantRecord({
        tenantId: "tenant-a",
        displayName: "Tenant A",
        sector: "restaurant",
        plan: "alpha-plan",
        features: {
            catalog: true,
            orders: true,
            appointments: true,
            reservations: false,
            quotes: true
        },
        now: new Date("2026-09-08T17:00:00.000Z"),
        ...overrides
    });
}

function createService({ config = configFixture(), entitlementService = null } = {}) {
    return createCommercialPlanPreviewService({
        config,
        entitlementService: entitlementService || createEntitlementService({ config })
    });
}

function previewInput(overrides = {}) {
    return {
        context: platformContext(),
        tenantId: "tenant-a",
        tenant: tenantFixture(),
        targetPlan: "beta-plan",
        ...overrides
    };
}

function feature(preview, name) {
    return preview.features.find(item => item.feature === name);
}

test("configured plan catalog yalnız config.plans ID'lerinden sabit güvenli projection üretir", () => {
    const catalog = createService().getCatalog({ context: platformContext() });

    assert.deepEqual(catalog, {
        schemaVersion: 1,
        planIds: ["alpha-plan", "beta-plan", "default", "starter"]
    });
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(catalog.planIds), true);
    assert.deepEqual(Object.keys(catalog), ["schemaVersion", "planIds"]);
    assert.equal(JSON.stringify(catalog).includes("allowedFeatures"), false);
    assert.equal(JSON.stringify(catalog).includes("softRequestLimit"), false);
});

test("varsayılan catalog default ve starter planlarını raporlar", () => {
    const config = loadPlatformGuardrailsConfig();
    const catalog = createService({ config }).getCatalog({
        context: platformContext()
    });

    assert.deepEqual(catalog.planIds, ["default", "starter"]);
});

test("unknown veya non-canonical target plan default policy'ye düşmeden reddedilir", () => {
    const config = configFixture();
    const base = createEntitlementService({ config });
    let evaluateCalls = 0;
    let policyCalls = 0;
    const entitlementService = {
        evaluate(input) {
            evaluateCalls += 1;
            return base.evaluate(input);
        },
        resolvePolicy(input) {
            policyCalls += 1;
            return base.resolvePolicy(input);
        }
    };
    const service = createService({ config, entitlementService });

    for (const targetPlan of [
        "missing-plan",
        "BETA-PLAN",
        " beta-plan ",
        "constructor"
    ]) {
        assert.throws(
            () => service.preview(previewInput({ targetPlan })),
            error => error?.code === "TARGET_PLAN_NOT_CONFIGURED"
        );
    }
    assert.equal(evaluateCalls, 0);
    assert.equal(policyCalls, 0);
});

test("feature preview gained lost ve unchanged etkileri FEATURE_CATALOG üzerinden ayırır", () => {
    const preview = createService().preview(previewInput());

    assert.equal(feature(preview, "appointments").change, "gained");
    assert.equal(feature(preview, "orders").change, "lost");
    assert.equal(feature(preview, "catalog").change, "unchanged");
    assert.equal(preview.features.length, 9);
    assert.equal(Object.isFrozen(preview.features), true);
    assert.equal(preview.features.every(Object.isFrozen), true);
});

test("tenant-disabled feature plan allowance'dan ayrı kalır ve effective kazanım uydurmaz", () => {
    const preview = createService().preview(previewInput());
    const reservations = feature(preview, "reservations");

    assert.deepEqual(reservations, {
        feature: "reservations",
        tenantEnabled: false,
        currentPlanAllowed: false,
        targetPlanAllowed: true,
        currentEffective: false,
        targetEffective: false,
        change: "unchanged"
    });
});

test("tenant override semantiği current ve target policy değerlendirmesinde aynen korunur", () => {
    const config = configFixture({
        tenantOverrides: {
            "tenant-a": {
                allowedFeatures: ["catalog", "quotes"],
                softRequestLimit: 50,
                warningThreshold: 0.6,
                dedicatedReviewThreshold: 1.1
            }
        }
    });
    const preview = createService({ config }).preview(previewInput());

    assert.deepEqual(feature(preview, "quotes"), {
        feature: "quotes",
        tenantEnabled: true,
        currentPlanAllowed: true,
        targetPlanAllowed: true,
        currentEffective: true,
        targetEffective: true,
        change: "unchanged"
    });
    assert.equal(feature(preview, "orders").currentPlanAllowed, false);
    assert.deepEqual(preview.limits.softRequestLimit, {
        current: 50,
        target: 50,
        change: "unchanged"
    });
    assert.deepEqual(preview.limits.warningThreshold, {
        current: 0.6,
        target: 0.6,
        change: "unchanged"
    });
});

test("unknown current plan default-policy fallback'ını dürüst raporlar ve tenantı değiştirmez", () => {
    const tenant = tenantFixture({ plan: "legacy-plan" });
    const before = structuredClone(tenant);
    const preview = createService().preview(previewInput({ tenant }));

    assert.equal(preview.currentPlan, "legacy-plan");
    assert.equal(preview.currentPlanConfigured, false);
    assert.equal(preview.currentUsesDefaultPolicyFallback, true);
    assert.equal(preview.targetPlan, "beta-plan");
    assert.deepEqual(tenant, before);
});

test("configured current plan fallback kullanmadığını açıkça raporlar", () => {
    const preview = createService().preview(previewInput());

    assert.equal(preview.currentPlanConfigured, true);
    assert.equal(preview.currentUsesDefaultPolicyFallback, false);
});

test("safe teknik limit policy diff current target ve yön bilgisini taşır", () => {
    const preview = createService().preview(previewInput());

    assert.deepEqual(preview.limits, {
        softRequestLimit: {
            current: 100,
            target: 200,
            change: "increased"
        },
        warningThreshold: {
            current: 0.7,
            target: 0.8,
            change: "increased"
        },
        dedicatedReviewThreshold: {
            current: 1.2,
            target: 1.5,
            change: "increased"
        }
    });
    assert.equal(Object.isFrozen(preview.limits), true);
});

test("preview monthlyRevenueReference veya customer price alanı üretmez", () => {
    const serialized = JSON.stringify(createService().preview(previewInput()));

    for (const marker of [
        "monthlyRevenueReference",
        "customerPrice",
        "priceRecommendation",
        "12345678",
        "87654321"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("preview tenant config ve feature flag nesnelerini mutate etmez; automaticApply false kalır", () => {
    const config = configFixture();
    const tenant = tenantFixture();
    const configBefore = structuredClone(config);
    const tenantBefore = structuredClone(tenant);
    const preview = createService({ config }).preview(previewInput({ tenant }));

    assert.equal(preview.automaticApply, false);
    assert.equal(Object.isFrozen(preview), true);
    assert.deepEqual(config, configBefore);
    assert.deepEqual(tenant, tenantBefore);
});

test("hostile raw secret PII ve provider alanları projection'a veya getter erişimine sızmaz", () => {
    const config = configFixture();
    const base = createEntitlementService({ config });
    let getterCalls = 0;
    const withHostileExtras = value => {
        const output = { ...value };
        Object.defineProperty(output, "rawProviderBody", {
            enumerable: true,
            get() {
                getterCalls += 1;
                throw new Error("raw provider getter marker");
            }
        });
        output.token = "opaque-token-marker";
        output.email = "not-returned@example.invalid";
        return output;
    };
    const service = createService({
        config,
        entitlementService: {
            evaluate(input) {
                return withHostileExtras(base.evaluate(input));
            },
            resolvePolicy(input) {
                return withHostileExtras(base.resolvePolicy(input));
            }
        }
    });
    const tenant = { ...tenantFixture() };
    Object.defineProperty(tenant, "rawIdentityProviderRecord", {
        enumerable: true,
        get() {
            getterCalls += 1;
            throw new Error("raw tenant provider getter marker");
        }
    });
    const tenantPasswordMarker = ["synthetic", "tenant", "field"].join("-");
    tenant[["pass", "word"].join("")] = tenantPasswordMarker;
    const preview = service.preview(previewInput({ tenant }));
    const serialized = JSON.stringify(preview);

    assert.equal(getterCalls, 0);
    for (const marker of [
        "rawProviderBody",
        "opaque-token-marker",
        "not-returned@example.invalid",
        "raw provider getter marker",
        "rawIdentityProviderRecord",
        tenantPasswordMarker,
        "raw tenant provider getter marker"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("exact input allowlist hostile alanları getter çalıştırmadan reddeder", () => {
    const input = previewInput();
    let getterCalls = 0;
    Object.defineProperty(input, "password", {
        enumerable: true,
        get() {
            getterCalls += 1;
            throw new Error("password getter marker");
        }
    });

    assert.throws(() => createService().preview(input), error => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message.includes("marker"), false);
        return true;
    });
    assert.equal(getterCalls, 0);
});

test("Platform Admin ve exact tenant scope servis sınırında zorunludur", () => {
    const service = createService();

    assert.throws(
        () => service.getCatalog({ context: { role: "tenant_owner" } }),
        error => error?.code === "PERMISSION_DENIED"
    );
    assert.throws(
        () => service.preview(previewInput({
            context: {
                role: "tenant_owner",
                tenantId: "tenant-a"
            }
        })),
        error => error?.code === "PERMISSION_DENIED"
    );
    assert.throws(
        () => service.preview(previewInput({ tenantId: "TENANT-A" })),
        TypeError
    );
    assert.throws(
        () => service.preview(previewInput({
            tenant: tenantFixture({ tenantId: "tenant-b" })
        })),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("existing EntitlementService current unknown-plan fallback ve resolvePolicy semantiğini korur", () => {
    const config = loadPlatformGuardrailsConfig();
    const service = createEntitlementService({ config });
    const tenant = {
        tenantId: "tenant-old",
        plan: "legacy-plan",
        features: { catalog: true }
    };

    const entitlement = service.evaluate({ tenant, feature: "catalog" });
    const policy = service.resolvePolicy({ tenant });
    assert.equal(entitlement.usedDefaultPlanPolicy, true);
    assert.equal(policy.usedDefaultPlanPolicy, true);
    assert.equal(policy.plan, "legacy-plan");
});

test("production runtime aynı config ve EntitlementService ile read-only preview servisini wire eder", () => {
    const platformRoot = path.resolve(__dirname, "..");
    const serverSource = fs.readFileSync(
        path.join(platformRoot, "server.js"),
        "utf8"
    );
    const serviceSource = fs.readFileSync(
        path.join(
            platformRoot,
            "src",
            "entitlements",
            "commercial-plan-preview-service.js"
        ),
        "utf8"
    );

    assert.match(serverSource, /createCommercialPlanPreviewService\(\{[\s\S]*?config: guardrailsConfig,[\s\S]*?entitlementService[\s\S]*?\}\)/);
    assert.match(serverSource, /commercialPlanPreviewService,/);
    assert.doesNotMatch(serviceSource, /tenantRegistry|billing|identityProvider|monthlyRevenueReference/);
    assert.doesNotMatch(serviceSource, /\.(?:create|insert|patch|save|update|delete)\s*\(/);
});
