const { requireTenantId } = require("../tenant/tenant-id");

const TRUSTED_TENANT_RESOLUTION_SOURCES = Object.freeze([
    "verified_domain",
    "trusted_route",
    "internal_test"
]);
const ISSUED_RESOLUTIONS = new WeakSet();

function fail() {
    const error = new Error("Trusted tenant resolution gerekli.");
    error.code = "TRUSTED_TENANT_RESOLUTION_REQUIRED";
    throw error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail();
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail();
    return tenantId;
}

function requireSource(value) {
    if (typeof value !== "string" ||
        !TRUSTED_TENANT_RESOLUTION_SOURCES.includes(value)) {
        fail();
    }
    return value;
}

function requireIsoTimestamp(value) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
        new Date(Date.parse(value)).toISOString() !== value) {
        fail();
    }
    return value;
}

function issueTrustedTenantResolution({
    tenantId,
    source,
    observedAt = new Date()
} = {}) {
    if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
        fail();
    }

    const resolution = Object.freeze({
        tenantId: requireCanonicalTenantId(tenantId),
        source: requireSource(source),
        observedAt: observedAt.toISOString()
    });
    ISSUED_RESOLUTIONS.add(resolution);
    return resolution;
}

function assertTrustedTenantResolution(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype ||
        Object.isFrozen(value) !== true ||
        !ISSUED_RESOLUTIONS.has(value)) {
        fail();
    }

    const keys = Reflect.ownKeys(value);
    if (keys.length !== 3 ||
        !keys.every(key => ["tenantId", "source", "observedAt"].includes(key))) {
        fail();
    }

    requireCanonicalTenantId(value.tenantId);
    requireSource(value.source);
    requireIsoTimestamp(value.observedAt);
    return value;
}

module.exports = {
    TRUSTED_TENANT_RESOLUTION_SOURCES,
    assertTrustedTenantResolution,
    issueTrustedTenantResolution
};
