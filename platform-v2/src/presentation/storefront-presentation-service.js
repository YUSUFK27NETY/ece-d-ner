const { getPresentationContract } = require("./presentation-contract");
const { resolveTenantPresentation } = require("./presentation-tier");
const { getSectorPresentationAdapter } = require("./sector-presentation-catalog");

const MODULE_FEATURES = Object.freeze([
    "orders",
    "appointments",
    "reservations",
    "quotes",
    "fleet",
    "whatsapp"
]);

function normalizeFeatures(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Presentation feature seti nesne olmalı.");
    }

    const normalized = {};
    for (const [key, value] of Object.entries(input)) {
        normalized[key] = value === true;
    }
    return Object.freeze(normalized);
}

function buildSections({ features, contract }) {
    const sections = [
        Object.freeze({ id: "navigation", variant: contract.navigation }),
        Object.freeze({ id: "hero", variant: contract.hero })
    ];

    if (features.catalog === true) {
        sections.push(Object.freeze({ id: "offering", variant: contract.offering }));
    }

    if (MODULE_FEATURES.some(feature => features[feature] === true)) {
        sections.push(Object.freeze({ id: "modules", variant: contract.offering }));
    }

    if (features.gallery === true) {
        sections.push(Object.freeze({ id: "gallery", variant: contract.gallery }));
    }

    if (features.reviews === true && contract.socialProof !== "hidden") {
        sections.push(Object.freeze({ id: "social-proof", variant: contract.socialProof }));
    }

    sections.push(
        Object.freeze({ id: "business-info", variant: "standard" }),
        Object.freeze({ id: "footer", variant: contract.footer })
    );

    return Object.freeze(sections);
}

function createStorefrontPresentationManifest({ tenant, effectiveFeatures } = {}) {
    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
        throw new TypeError("Presentation tenant kaydı geçersiz.");
    }

    const selection = resolveTenantPresentation(tenant.presentation);
    const contract = getPresentationContract(selection.tier);
    const sector = getSectorPresentationAdapter(tenant.sector);
    const features = normalizeFeatures(effectiveFeatures || tenant.features || {});

    return Object.freeze({
        schemaVersion: selection.version,
        tier: selection.tier,
        source: selection.source,
        sector,
        components: contract,
        sections: buildSections({ features, contract })
    });
}

module.exports = {
    MODULE_FEATURES,
    buildSections,
    createStorefrontPresentationManifest,
    normalizeFeatures
};
