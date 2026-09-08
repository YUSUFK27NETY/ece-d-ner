const VERIFIED_FACTOR_TYPES = Object.freeze(["totp", "passkey", "security_key"]);

const DEFAULT_PLATFORM_STEP_UP_CONFIG = Object.freeze({
    elevatedSessionTtlMs: 5 * 60_000,
    requiredFactorTypes: VERIFIED_FACTOR_TYPES
});

function normalizePlatformStepUpConfig(input = DEFAULT_PLATFORM_STEP_UP_CONFIG) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Object.keys(input).some(key => !["elevatedSessionTtlMs", "requiredFactorTypes"].includes(key))) {
        throw new TypeError("Platform step-up config geçersiz alan içeriyor.");
    }

    const { elevatedSessionTtlMs, requiredFactorTypes } = input;
    // No coercion: null, booleans and numeric strings must never weaken this gate.
    if (!Number.isSafeInteger(elevatedSessionTtlMs) ||
        elevatedSessionTtlMs < 1000 || elevatedSessionTtlMs > 15 * 60_000) {
        throw new TypeError("Platform step-up elevatedSessionTtlMs geçersiz.");
    }
    if (!Array.isArray(requiredFactorTypes) || requiredFactorTypes.length === 0 ||
        requiredFactorTypes.length > VERIFIED_FACTOR_TYPES.length ||
        new Set(requiredFactorTypes).size !== requiredFactorTypes.length ||
        ![...requiredFactorTypes].every(type => VERIFIED_FACTOR_TYPES.includes(type))) {
        throw new TypeError("Platform step-up requiredFactorTypes geçersiz.");
    }

    return Object.freeze({
        elevatedSessionTtlMs,
        requiredFactorTypes: Object.freeze([...requiredFactorTypes])
    });
}

module.exports = {
    VERIFIED_FACTOR_TYPES,
    DEFAULT_PLATFORM_STEP_UP_CONFIG,
    normalizePlatformStepUpConfig
};
