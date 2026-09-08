const DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG = Object.freeze({
    dedupeWindowMs: 300_000,
    maxScopes: 1000,
    maxEventsPerScope: 1000,
    repeated401: Object.freeze({ windowMs: 300_000, countThreshold: 5, highThreshold: 20 }),
    repeated403: Object.freeze({ windowMs: 300_000, countThreshold: 3, highThreshold: 10 })
});

function assertKeys(input, allowed) {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).some(key => !allowed.includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value"))) {
        throw new TypeError("Security alerts config alanları geçersiz.");
    }
}

function integer(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new TypeError("Security alerts config sayısal değeri geçersiz.");
    }
    return value;
}

function normalizePlatformSecurityAlertsConfig(input = DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG) {
    assertKeys(input, ["dedupeWindowMs", "maxScopes", "maxEventsPerScope", "repeated401", "repeated403"]);
    const maxEventsPerScope = integer(input.maxEventsPerScope, 2, 10_000);
    function repeated(policy) {
        assertKeys(policy, ["windowMs", "countThreshold", "highThreshold"]);
        const countThreshold = integer(policy.countThreshold, 2, maxEventsPerScope);
        return Object.freeze({
            windowMs: integer(policy.windowMs, 1000, 3_600_000),
            countThreshold,
            highThreshold: integer(policy.highThreshold, countThreshold + 1, maxEventsPerScope)
        });
    }
    return Object.freeze({
        dedupeWindowMs: integer(input.dedupeWindowMs, 1000, 3_600_000),
        maxScopes: integer(input.maxScopes, 1, 10_000),
        maxEventsPerScope,
        repeated401: repeated(input.repeated401),
        repeated403: repeated(input.repeated403)
    });
}

module.exports = { DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG, normalizePlatformSecurityAlertsConfig };
