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

function resolveTenantPresentation(input = null) {
    if (input === undefined || input === null) {
        return Object.freeze({
            tier: "starter",
            version: PRESENTATION_SCHEMA_VERSION,
            source: "legacy_fallback"
        });
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Presentation ayarı nesne olmalı.");
    }

    return Object.freeze({
        tier: requirePresentationTier(input.tier),
        version: requirePresentationVersion(input.version),
        source: "configured"
    });
}

module.exports = {
    PRESENTATION_SCHEMA_VERSION,
    PRESENTATION_TIERS,
    requirePresentationTier,
    resolveTenantPresentation
};
