const test = require("node:test");
const assert = require("node:assert/strict");

const {
    suggestPresentationForPlan
} = require("../src/presentation/plan-presentation-suggestion");
const {
    resolveTenantPresentation
} = require("../src/presentation/presentation-tier");

test("known commercial plans onboarding presentation önerisi üretir", () => {
    assert.deepEqual(suggestPresentationForPlan("starter"), {
        tier: "starter",
        version: 1,
        source: "plan_suggestion"
    });
    assert.deepEqual(suggestPresentationForPlan("business"), {
        tier: "business",
        version: 1,
        source: "plan_suggestion"
    });
    assert.deepEqual(suggestPresentationForPlan("business_pro"), {
        tier: "pro",
        version: 1,
        source: "plan_suggestion"
    });
});

test("business pro plan aliasları yalnız onboarding önerisinde normalize edilir", () => {
    assert.equal(suggestPresentationForPlan("business-pro").tier, "pro");
    assert.equal(suggestPresentationForPlan("business pro").tier, "pro");
});

test("unknown plan presentation uydurmaz", () => {
    assert.equal(suggestPresentationForPlan("enterprise"), null);
    assert.equal(suggestPresentationForPlan(""), null);
});

test("runtime resolver plan suggestion fonksiyonuna bağlı değildir", () => {
    const suggestion = suggestPresentationForPlan("business_pro");
    const legacyRuntime = resolveTenantPresentation(null);

    assert.equal(suggestion.tier, "pro");
    assert.equal(legacyRuntime.tier, "starter");
    assert.equal(legacyRuntime.source, "legacy_fallback");
});
