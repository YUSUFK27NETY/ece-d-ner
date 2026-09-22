const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    FEATURE_CATALOG,
    RUNTIME_UNAVAILABLE_FEATURES
} = require("../src/tenant/feature-catalog");
const {
    loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const {
    resolveTenantPolicy
} = require("../src/entitlements/entitlement-service");
const {
    FEATURE_LABELS,
    RUNTIME_UNAVAILABLE_FEATURES: UI_RUNTIME_UNAVAILABLE_FEATURES,
    PLAN_PACKAGE_CATALOG,
    PACKAGE_ORDER,
    normalizePlanId,
    suggestedFeaturesForPlan,
    isRuntimeFeatureAvailable
} = require("../public/admin/plan-packages");

const ROOT = path.join(__dirname, "..");
const NEW_OPTIONAL_FEATURES = Object.freeze([
    "analytics",
    "campaigns",
    "delivery",
    "loyalty",
    "reviews",
    "staff"
]);

function sortedKeys(value) {
    return Object.keys(value).sort();
}

test("Starter, Business and Business Pro presets cover the server feature catalog exactly", () => {
    assert.deepEqual(PACKAGE_ORDER, ["starter", "business", "business_pro"]);
    const featureKeys = sortedKeys(FEATURE_CATALOG);

    assert.deepEqual(sortedKeys(FEATURE_LABELS), featureKeys);
    for (const planId of PACKAGE_ORDER) {
        assert.deepEqual(sortedKeys(PLAN_PACKAGE_CATALOG[planId].features), featureKeys);
        for (const feature of NEW_OPTIONAL_FEATURES) {
            assert.equal(PLAN_PACKAGE_CATALOG[planId].features[feature], false);
        }
    }

    assert.deepEqual(
        Object.entries(suggestedFeaturesForPlan("starter"))
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .sort(),
        ["catalog", "gallery", "whatsapp"]
    );

    assert.deepEqual(
        Object.entries(suggestedFeaturesForPlan("business"))
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .sort(),
        [
            "appointments",
            "catalog",
            "gallery",
            "inventory",
            "orders",
            "reservations",
            "whatsapp"
        ]
    );

    assert.deepEqual(
        Object.entries(suggestedFeaturesForPlan("business_pro"))
            .filter(([, enabled]) => enabled)
            .map(([key]) => key)
            .sort(),
        [
            "appointments",
            "catalog",
            "crm",
            "fleet",
            "gallery",
            "inventory",
            "orders",
            "quotes",
            "reservations",
            "whatsapp"
        ]
    );
});

test("declared future featurelar etiketli kalır ama runtime açılımına kapalıdır", () => {
    assert.deepEqual(
        Object.fromEntries(NEW_OPTIONAL_FEATURES.map(feature => [feature, FEATURE_LABELS[feature]])),
        {
            analytics: "Raporlama / Analitik",
            campaigns: "Kampanya / Kupon",
            delivery: "Teslimat",
            loyalty: "Sadakat",
            reviews: "Yorumlar",
            staff: "Personel"
        }
    );
    assert.deepEqual(
        [...UI_RUNTIME_UNAVAILABLE_FEATURES].sort(),
        [...RUNTIME_UNAVAILABLE_FEATURES].sort()
    );
    for (const feature of NEW_OPTIONAL_FEATURES) {
        assert.equal(isRuntimeFeatureAvailable(feature), false);
    }
    assert.equal(isRuntimeFeatureAvailable("orders"), true);
});

test("package aliases normalize without accepting arbitrary plans as presets", () => {
    assert.equal(normalizePlanId("Business Pro"), "business_pro");
    assert.equal(normalizePlanId("business-pro"), "business_pro");
    assert.equal(suggestedFeaturesForPlan("legacy_custom"), null);
});

test("Business plans are configured server-side but do not remove manual feature overrides", () => {
    const config = loadPlatformGuardrailsConfig("");

    for (const plan of ["starter", "business", "business_pro"]) {
        assert.ok(config.plans[plan]);
        assert.equal(config.plans[plan].allowedFeatures, "*");
        const policy = resolveTenantPolicy({
            tenant: { tenantId: "ela-doner", plan },
            config
        });
        assert.equal(policy.plan, plan);
        assert.equal(policy.usedDefaultPlanPolicy, false);
        assert.equal(policy.allowedFeatures, "*");
    }
});

test("both admin entry points load package presets before their main page logic", () => {
    const quickSetup = fs.readFileSync(
        path.join(ROOT, "public/admin/quick-setup.html"),
        "utf8"
    );
    const centralAdmin = fs.readFileSync(
        path.join(ROOT, "public/admin/index.html"),
        "utf8"
    );

    const quickPackageIndex = quickSetup.indexOf('/admin/plan-packages.js');
    const quickMainIndex = quickSetup.indexOf('/admin/quick-setup.js');
    const adminPackageIndex = centralAdmin.indexOf('/admin/plan-packages.js');
    const adminMainIndex = centralAdmin.indexOf('/admin/admin.js');

    assert.ok(quickPackageIndex >= 0 && quickPackageIndex < quickMainIndex);
    assert.ok(adminPackageIndex >= 0 && adminPackageIndex < adminMainIndex);
    assert.match(centralAdmin, /data-feature="crm"/);
});

test("package preset UI remains suggestion-only and never persists on selection", () => {
    const source = fs.readFileSync(
        path.join(ROOT, "public/admin/plan-packages.js"),
        "utf8"
    );

    assert.match(source, /Paket yalnız modül önerisi uygular/);
    assert.match(source, /input\.disabled = !available/);
    assert.match(source, /Yakında/);
    assert.match(source, /if \(input\.disabled\) continue/);
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /localStorage|sessionStorage/);
    assert.doesNotMatch(source, /innerHTML/);
});
