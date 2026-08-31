const FEATURE_CATALOG = Object.freeze({
    catalog: Object.freeze({ defaultEnabled: true }),
    orders: Object.freeze({ defaultEnabled: false }),
    appointments: Object.freeze({ defaultEnabled: false }),
    reservations: Object.freeze({ defaultEnabled: false }),
    whatsapp: Object.freeze({ defaultEnabled: false }),
    inventory: Object.freeze({ defaultEnabled: false }),
    quotes: Object.freeze({ defaultEnabled: false }),
    fleet: Object.freeze({ defaultEnabled: false }),
    gallery: Object.freeze({ defaultEnabled: true })
});

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

module.exports = {
    FEATURE_CATALOG,
    createFeatureFlags
};
