const DESIGN_FAMILIES = Object.freeze([
    "modern",
    "warm",
    "bold",
    "corporate",
    "editorial",
    "minimal"
]);

const DESIGN_FAMILY_SET = new Set(DESIGN_FAMILIES);
const DEFAULT_FAMILY_BY_TIER = Object.freeze({
    starter: "modern",
    business: "modern",
    pro: "editorial"
});

function requireDesignFamily(value) {
    const family = String(value ?? "").trim().toLowerCase();
    if (!DESIGN_FAMILY_SET.has(family)) {
        throw new TypeError("Design family geçersiz.");
    }
    return family;
}

function defaultDesignFamilyForTier(tier) {
    const family = DEFAULT_FAMILY_BY_TIER[tier];
    if (!family) {
        throw new TypeError("Design family için presentation tier geçersiz.");
    }
    return family;
}

function resolveDesignFamily({ tier, family = null } = {}) {
    if (family === undefined || family === null || family === "") {
        return Object.freeze({
            family: defaultDesignFamilyForTier(tier),
            source: "tier_default"
        });
    }
    return Object.freeze({
        family: requireDesignFamily(family),
        source: "configured"
    });
}

module.exports = {
    DESIGN_FAMILIES,
    DEFAULT_FAMILY_BY_TIER,
    defaultDesignFamilyForTier,
    requireDesignFamily,
    resolveDesignFamily
};
