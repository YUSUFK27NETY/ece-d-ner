const { breakGlassFields, breakGlassId, rejectBreakGlass } = require("./break-glass-contract");
const { VERIFIED_FACTOR_TYPES, normalizePlatformStepUpConfig } = require("../config/platform-step-up-config");

function scalar(value, type) {
    if (value != null && typeof value !== type) rejectBreakGlass("INVALID_AUTH_METADATA");
    return value;
}

function denseValues(array, max) {
    if (!Array.isArray(array) || Object.getPrototypeOf(array) !== Array.prototype || array.length > max ||
        Reflect.ownKeys(array).length !== array.length + 1) rejectBreakGlass("INVALID_AUTH_METADATA");
    const result = [];
    for (let i = 0; i < array.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(array, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) rejectBreakGlass("INVALID_AUTH_METADATA");
        result.push(descriptor.value);
    }
    return result;
}

// Shape validation only; Paket 1 still decides freshness, claim, factor and auth-event binding.
// Input must be verified metadata from a trusted backend adapter, never a raw token/provider body.
function snapshotBreakGlassAuth(input) {
    if (input == null) return Object.freeze({});
    breakGlassFields(input, ["actorId", "platformAdmin", "verified", "authenticatedAtMs", "verifiedFactors"]);
    const factors = input.verifiedFactors == null ? [] : denseValues(input.verifiedFactors, 16).map(factor => {
        breakGlassFields(factor, ["type", "verified", "actorId", "authenticatedAtMs", "verifiedAtMs"]);
        if (!VERIFIED_FACTOR_TYPES.includes(factor.type)) rejectBreakGlass("INVALID_AUTH_METADATA");
        return Object.freeze({
            type: factor.type, verified: scalar(factor.verified, "boolean"),
            actorId: factor.actorId == null ? null : breakGlassId(factor.actorId),
            authenticatedAtMs: scalar(factor.authenticatedAtMs, "number"), verifiedAtMs: scalar(factor.verifiedAtMs, "number")
        });
    });
    return Object.freeze({
        actorId: input.actorId == null ? null : breakGlassId(input.actorId),
        platformAdmin: scalar(input.platformAdmin, "boolean"), verified: scalar(input.verified, "boolean"),
        authenticatedAtMs: scalar(input.authenticatedAtMs, "number"), verifiedFactors: Object.freeze(factors)
    });
}

// Protect the legacy config normalizer from accessor/extra payloads without changing Paket 1.
function safeBreakGlassStepUpConfig(input) {
    if (input === undefined) return normalizePlatformStepUpConfig();
    breakGlassFields(input, ["elevatedSessionTtlMs", "requiredFactorTypes"]);
    const factors = denseValues(input.requiredFactorTypes, VERIFIED_FACTOR_TYPES.length);
    if (!factors.every(type => VERIFIED_FACTOR_TYPES.includes(type))) rejectBreakGlass("INVALID_BREAK_GLASS_CONFIG");
    return normalizePlatformStepUpConfig({ elevatedSessionTtlMs: input.elevatedSessionTtlMs, requiredFactorTypes: factors });
}

module.exports = { snapshotBreakGlassAuth, safeBreakGlassStepUpConfig };
