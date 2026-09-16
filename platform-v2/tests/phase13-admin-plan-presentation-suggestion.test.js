const test = require("node:test");
const assert = require("node:assert/strict");

const packages = require("../public/admin/plan-packages.js");

test("admin plan catalog presentation önerilerini açıkça taşır", () => {
    assert.equal(packages.PLAN_PACKAGE_CATALOG.starter.presentationTier, "starter");
    assert.equal(packages.PLAN_PACKAGE_CATALOG.business.presentationTier, "business");
    assert.equal(packages.PLAN_PACKAGE_CATALOG.business_pro.presentationTier, "pro");
});

test("admin presentation önerisi plan aliases ile normalize edilir", () => {
    assert.deepEqual(packages.suggestedPresentationForPlan("starter"), {
        tier: "starter",
        version: 1
    });
    assert.deepEqual(packages.suggestedPresentationForPlan("business-pro"), {
        tier: "pro",
        version: 1
    });
    assert.equal(packages.suggestedPresentationForPlan("custom"), null);
});
