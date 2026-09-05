const { requireTenantId } = require("../tenant/tenant-id");

function rejectIncident(code = "INVALID_INCIDENT_METADATA") {
    const error = new TypeError("Incident metadata kontratı reddedildi.");
    error.code = code;
    throw error;
}

function incidentFields(input, allowed) {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) rejectIncident();
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !allowed.includes(key) ||
            ["__proto__", "constructor", "prototype"].includes(key) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value")) rejectIncident();
    }
}

function incidentId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || /^\d{7,15}$/.test(value)) rejectIncident();
    return value;
}

function incidentUuid(value) {
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) rejectIncident();
    return value;
}

function incidentTenant(value) {
    if (value === null) return null;
    if (typeof value !== "string" || /^\d{7,15}$/.test(value)) rejectIncident("TENANT_SCOPE_REQUIRED");
    try { if (requireTenantId(value) === value) return value; } catch { /* Do not reflect input. */ }
    rejectIncident("TENANT_SCOPE_REQUIRED");
}

function incidentInteger(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) rejectIncident("INVALID_INCIDENT_CONFIG");
    return value;
}

function incidentNow(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > Date.parse("9990-01-01T00:00:00.000Z")) rejectIncident("INVALID_CLOCK");
    return value;
}

function incidentTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) rejectIncident();
    const time = Date.parse(value);
    if (!Number.isFinite(time) || time <= 0 || new Date(time).toISOString() !== value) rejectIncident();
    return time;
}

function incidentIds(value, max = 1000) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max ||
        Reflect.ownKeys(value).length !== value.length + 1) rejectIncident();
    const result = [];
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) rejectIncident();
        const id = incidentId(descriptor.value);
        if (result.includes(id)) rejectIncident();
        result.push(id);
    }
    return Object.freeze(result);
}

// Trusted backend context only. Even a platform admin must select one exact scope.
function authorizeIncident(context, tenantId, write = false) {
    incidentFields(context, ["actorId", "tenantId", "role"]);
    const target = incidentTenant(tenantId);
    const actorId = incidentId(context.actorId);
    if (incidentTenant(context.tenantId) !== target) rejectIncident("TENANT_SCOPE_MISMATCH");
    const roles = write || target === null ? ["platform_admin"] : ["platform_admin", "tenant_owner", "tenant_admin"];
    if (!roles.includes(context.role)) rejectIncident("PERMISSION_DENIED");
    return actorId;
}

module.exports = {
    rejectIncident, incidentFields, incidentId, incidentUuid, incidentTenant, incidentInteger,
    incidentNow, incidentTime, incidentIds, authorizeIncident
};
