const { requireTenantId } = require("../tenant/tenant-id");

function rejectBreakGlass(code = "INVALID_BREAK_GLASS_METADATA") {
    const error = new TypeError("Break-glass metadata kontratı reddedildi.");
    error.code = code;
    throw error;
}

function breakGlassFields(input, allowed) {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) rejectBreakGlass();
    // Inspect descriptors first: do not read unknown payloads or execute accessors/coercion.
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !allowed.includes(key) ||
            ["__proto__", "prototype", "constructor"].includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value")) rejectBreakGlass();
    }
}

function breakGlassId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || /^\d{7,15}$/.test(value)) rejectBreakGlass();
    return value;
}

function breakGlassInteger(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) rejectBreakGlass("INVALID_BREAK_GLASS_CONFIG");
    return value;
}

function breakGlassNow(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > Date.parse("9990-01-01T00:00:00.000Z")) rejectBreakGlass("INVALID_CLOCK");
    return value;
}

function breakGlassTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) rejectBreakGlass();
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time <= 0 || new Date(time).toISOString() !== value) rejectBreakGlass();
    return time;
}

function breakGlassScope(scope, tenantId) {
    if (scope === "platform" && tenantId === null) return null;
    if (scope !== "tenant" || typeof tenantId !== "string" || /^\d{7,15}$/.test(tenantId)) rejectBreakGlass("INVALID_SCOPE");
    try { if (requireTenantId(tenantId) === tenantId) return tenantId; } catch { /* Never reflect input. */ }
    rejectBreakGlass("INVALID_SCOPE");
}

// Trusted backend context only, not authentication or a client-supplied authorization claim.
function authorizeBreakGlass(context, scope, tenantId) {
    breakGlassFields(context, ["actorId", "role", "scope", "tenantId"]);
    const actorId = breakGlassId(context.actorId);
    breakGlassScope(scope, tenantId);
    breakGlassScope(context.scope, context.tenantId);
    if (context.role !== "platform_admin") rejectBreakGlass("PERMISSION_DENIED");
    if (context.scope !== scope || context.tenantId !== tenantId) rejectBreakGlass("TENANT_SCOPE_MISMATCH");
    return actorId;
}

module.exports = {
    rejectBreakGlass, breakGlassFields, breakGlassId, breakGlassInteger,
    breakGlassNow, breakGlassTime, breakGlassScope, authorizeBreakGlass
};
