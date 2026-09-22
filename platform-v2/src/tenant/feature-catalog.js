const FEATURE_CATALOG = Object.freeze({
    catalog: Object.freeze({ defaultEnabled: true, runtimeAvailable: true }),
    orders: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    appointments: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    reservations: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    whatsapp: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    inventory: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    quotes: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    crm: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    fleet: Object.freeze({ defaultEnabled: false, runtimeAvailable: true }),
    gallery: Object.freeze({ defaultEnabled: true, runtimeAvailable: true }),
    delivery: Object.freeze({ defaultEnabled: false, runtimeAvailable: false }),
    campaigns: Object.freeze({ defaultEnabled: false, runtimeAvailable: false }),
    loyalty: Object.freeze({ defaultEnabled: false, runtimeAvailable: false }),
    staff: Object.freeze({ defaultEnabled: false, runtimeAvailable: false }),
    reviews: Object.freeze({ defaultEnabled: false, runtimeAvailable: false }),
    analytics: Object.freeze({ defaultEnabled: false, runtimeAvailable: false })
});

const RUNTIME_UNAVAILABLE_FEATURES = Object.freeze(
    Object.keys(FEATURE_CATALOG).filter(
        feature => FEATURE_CATALOG[feature].runtimeAvailable !== true
    )
);

function createFeatureFlags(overrides = {}) {
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
        throw new TypeError("Feature overrides nesne olmalı.");
    }

    const flags = {};

    for (const [key, definition] of Object.entries(FEATURE_CATALOG)) {
        flags[key] = definition.defaultEnabled;
    }

    for (const [key, value] of Object.entries(overrides)) {
        if (!(key in FEATURE_CATALOG)) {
            throw new TypeError(`Bilinmeyen feature flag: ${key}`);
        }

        if (typeof value !== "boolean") {
            throw new TypeError(`Feature flag boolean olmalı: ${key}`);
        }

        flags[key] = value;
    }

    return Object.freeze(flags);
}

function assertFeatureActivationAvailable({
    currentFeatures = {},
    nextFeatures = {}
} = {}) {
    const current = createFeatureFlags(currentFeatures);
    const next = createFeatureFlags(nextFeatures);

    for (const feature of RUNTIME_UNAVAILABLE_FEATURES) {
        if (current[feature] !== true && next[feature] === true) {
            throw new TypeError(
                `${feature} modülü henüz runtime kullanımına açık değil.`
            );
        }
    }

    return next;
}

module.exports = {
    FEATURE_CATALOG,
    RUNTIME_UNAVAILABLE_FEATURES,
    assertFeatureActivationAvailable,
    createFeatureFlags
};
