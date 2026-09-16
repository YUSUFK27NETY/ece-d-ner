const test = require("node:test");
const assert = require("node:assert/strict");

const {
    resolveTenantPresentation
} = require("../src/presentation/presentation-tier");
const {
    DESIGN_FAMILIES,
    requireDesignFamily
} = require("../src/presentation/presentation-family");
const {
    getPresentationContract
} = require("../src/presentation/presentation-contract");
const {
    getSectorPresentationAdapter
} = require("../src/presentation/sector-presentation-catalog");
const {
    createStorefrontPresentationManifest
} = require("../src/presentation/storefront-presentation-service");

test("legacy tenant presentation ayarı olmadan starter + modern fallback kullanır", () => {
    assert.deepEqual(resolveTenantPresentation(), {
        tier: "starter",
        version: 1,
        source: "legacy_fallback",
        family: "modern",
        familySource: "tier_default"
    });
});

test("configured presentation tier plan bilgisinden bağımsız çözülür", () => {
    const base = {
        tenantId: "ece-doner",
        sector: "restaurant",
        presentation: { tier: "business", version: 1 },
        features: { catalog: true, orders: true, whatsapp: true }
    };

    const starterPlan = createStorefrontPresentationManifest({
        tenant: { ...base, plan: "starter" }
    });
    const proPlan = createStorefrontPresentationManifest({
        tenant: { ...base, plan: "business_pro" }
    });

    assert.equal(starterPlan.tier, "business");
    assert.equal(proPlan.tier, "business");
    assert.equal(starterPlan.designFamily, "modern");
    assert.equal(proPlan.designFamily, "modern");
    assert.deepEqual(starterPlan.components, proPlan.components);
    assert.deepEqual(starterPlan.sections, proPlan.sections);
});

test("presentation config varsa bilinmeyen tier sessizce plana düşmez", () => {
    assert.throws(
        () => resolveTenantPresentation({ tier: "enterprise", version: 1 }),
        TypeError
    );
});

test("design family kataloğu altı kontrollü görsel karakter sunar", () => {
    assert.deepEqual(DESIGN_FAMILIES, [
        "modern", "warm", "bold", "corporate", "editorial", "minimal"
    ]);
    assert.equal(requireDesignFamily(" Warm "), "warm");
    assert.throws(() => requireDesignFamily("random-template"), TypeError);
});

test("explicit design family tier ve plandan bağımsız korunur", () => {
    const resolved = resolveTenantPresentation({
        tier: "business",
        version: 1,
        family: "bold"
    });

    assert.equal(resolved.tier, "business");
    assert.equal(resolved.family, "bold");
    assert.equal(resolved.familySource, "configured");

    const manifest = createStorefrontPresentationManifest({
        tenant: {
            tenantId: "bold-business",
            sector: "barber",
            plan: "starter",
            presentation: { tier: "business", version: 1, family: "bold" },
            features: { catalog: true, appointments: true }
        }
    });
    assert.equal(manifest.tier, "business");
    assert.equal(manifest.designFamily, "bold");
    assert.equal(manifest.designFamilySource, "configured");
});

test("family eksik configured Pro tenant mevcut editorial karakterini varsayılan alır", () => {
    const resolved = resolveTenantPresentation({ tier: "pro", version: 1 });
    assert.equal(resolved.family, "editorial");
    assert.equal(resolved.familySource, "tier_default");
});

test("tier contractları görsel capability seviyelerini ayırır", () => {
    assert.equal(getPresentationContract("starter").hero, "compact");
    assert.equal(getPresentationContract("business").hero, "featured");
    assert.equal(getPresentationContract("pro").hero, "immersive");
});

test("sector adapter özellik açmaz ve bilinmeyen sektörde general fallback kullanır", () => {
    const barber = getSectorPresentationAdapter("barber");
    const unknown = getSectorPresentationAdapter("future-sector");

    assert.equal(barber.primaryActionFeature, "appointments");
    assert.equal(Object.hasOwn(barber, "features"), false);
    assert.equal(unknown.sector, "general");
});

test("effective feature seti sadece uygun bölümlerin görünürlüğünü belirler", () => {
    const tenant = {
        tenantId: "ece-doner",
        sector: "restaurant",
        plan: "business_pro",
        presentation: { tier: "pro", version: 1 },
        features: {
            catalog: true,
            orders: true,
            gallery: true,
            reviews: true
        }
    };

    const manifest = createStorefrontPresentationManifest({
        tenant,
        effectiveFeatures: {
            catalog: true,
            orders: false,
            whatsapp: false,
            gallery: false,
            reviews: false
        }
    });

    assert.equal(manifest.tier, "pro");
    assert.equal(manifest.designFamily, "editorial");
    assert.deepEqual(
        manifest.sections.map(section => section.id),
        ["navigation", "hero", "offering", "business-info", "footer"]
    );
});

test("legacy tenant plan business olsa bile explicit presentation olmadan starter kalır", () => {
    const manifest = createStorefrontPresentationManifest({
        tenant: {
            tenantId: "legacy-business",
            sector: "restaurant",
            plan: "business",
            features: { catalog: true, orders: true }
        }
    });

    assert.equal(manifest.tier, "starter");
    assert.equal(manifest.source, "legacy_fallback");
    assert.equal(manifest.designFamily, "modern");
});
