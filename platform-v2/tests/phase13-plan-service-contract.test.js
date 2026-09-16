"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CORE_MANAGED_SERVICES,
    PLAN_SERVICE_IDS,
    STANDARD_EXCLUSIONS,
    getPlanServiceCatalog,
    getPlanServiceContract
} = require("../src/tenant/plan-service-contract");

test("Starter, Business ve Business Pro aylık yönetilen hizmet kontratına sahiptir", () => {
    assert.deepEqual(PLAN_SERVICE_IDS, ["starter", "business", "business_pro"]);

    for (const planId of PLAN_SERVICE_IDS) {
        const contract = getPlanServiceContract(planId);
        assert.ok(contract);
        assert.equal(contract.id, planId);
        assert.ok(contract.servicePromise.length > 20);
        assert.ok(contract.customerFacingIncludes.length >= 5);
    }
});

test("tüm paketlerde temel işletim, güvenlik, yedek ve uyumluluk hizmetleri korunur", () => {
    for (const planId of PLAN_SERVICE_IDS) {
        const services = getPlanServiceContract(planId).managedServices;
        for (const coreService of CORE_MANAGED_SERVICES) {
            assert.equal(services.includes(coreService), true, `${planId}: ${coreService}`);
        }
    }
});

test("Business ve Pro aylık hizmet kapsamı Starter'dan bağımsız olarak genişler", () => {
    const starter = getPlanServiceContract("starter");
    const business = getPlanServiceContract("business");
    const pro = getPlanServiceContract("business_pro");

    assert.equal(starter.support.priority, "standard");
    assert.equal(business.support.priority, "priority");
    assert.equal(pro.support.priority, "highest");

    assert.equal(business.managedServices.includes("monthly_service_review"), true);
    assert.equal(pro.managedServices.includes("proactive_technical_review"), true);
    assert.equal(pro.managedServices.includes("brand_presentation_maintenance"), true);
});

test("aylık hizmet kontratı feature entitlement veya presentation tier belirlemez", () => {
    for (const planId of PLAN_SERVICE_IDS) {
        const contract = getPlanServiceContract(planId);
        assert.equal(Object.hasOwn(contract, "features"), false);
        assert.equal(Object.hasOwn(contract, "presentationTier"), false);
        assert.equal(Object.hasOwn(contract, "price"), false);
        assert.equal(Object.hasOwn(contract, "monthlyPrice"), false);
    }
});

test("fiyatlandırma kontrattan ayrı tutulur ve yanlış plan güvenli biçimde reddedilir", () => {
    const catalog = getPlanServiceCatalog();

    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.pricingManagedSeparately, true);
    assert.equal(getPlanServiceContract("business-pro").id, "business_pro");
    assert.equal(getPlanServiceContract("business pro").id, "business_pro");
    assert.equal(getPlanServiceContract("unknown"), null);
});

test("sınırsız iş ve ayrı anlaşma gerektiren kalemler paket kapsamına otomatik dahil edilmez", () => {
    assert.equal(STANDARD_EXCLUSIONS.includes("unlimited_revision_or_data_entry"), true);
    assert.equal(STANDARD_EXCLUSIONS.includes("new_feature_or_module_development"), true);
    assert.equal(STANDARD_EXCLUSIONS.includes("twenty_four_seven_sla_unless_separately_agreed"), true);

    for (const planId of PLAN_SERVICE_IDS) {
        assert.deepEqual(getPlanServiceContract(planId).exclusions, STANDARD_EXCLUSIONS);
    }
});
