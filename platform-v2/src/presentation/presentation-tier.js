const {
    requireDesignFamily,
    resolveDesignFamily
} = require("./presentation-family");

const PRESENTATION_SCHEMA_VERSION = 1;
const PRESENTATION_TIERS = Object.freeze([
    "starter",
    "business",
    "pro"
]);
const PRESENTATION_TIER_SET = new Set(PRESENTATION_TIERS);

function requirePresentationTier(value) {
    const tier = String(value ?? "").trim().toLowerCase();
    if (!PRESENTATION_TIER_SET.has(tier)) {
        throw new TypeError("Presentation tier geçersiz.");
    }
    return tier;
}

function requirePresentationVersion(value = PRESENTATION_SCHEMA_VERSION) {
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version !== PRESENTATION_SCHEMA_VERSION) {
        throw new TypeError("Presentation version geçersiz.");
    }
    return version;
}

function createTenantPresentation(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Presentation ayarı nesne olmalı.");
    }

    const presentation = {
        tier: requirePresentationTier(input.tier),
        version: requirePresentationVersion(input.version)
    };

    if (input.family !== undefined && input.family !== null && input.family !== "") {
        presentation.family = requireDesignFamily(input.family);
    }

    return Object.freeze(presentation);
}

function resolveTenantPresentation(input = null) {
    if (input === undefined || input === null) {
        const family = resolveDesignFamily({ tier: "starter" });
        return Object.freeze({
            tier: "starter",
            version: PRESENTATION_SCHEMA_VERSION,
            source: "legacy_fallback",
            family: family.family,
            familySource: family.source
        });
    }

    const presentation = createTenantPresentation(input);
    const family = resolveDesignFamily({
        tier: presentation.tier,
        family: presentation.family
    });
    return Object.freeze({
        ...presentation,
        family: family.family,
        familySource: family.source,
        source: "configured"
    });
}

module.exports = {
    PRESENTATION_SCHEMA_VERSION,
    PRESENTATION_TIERS,
    createTenantPresentation,
    requirePresentationTier,
    resolveTenantPresentation
};
