const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");

function fail(label) {
    throw new TypeError(`Public route domain evidence ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") fail("domain");
    let domain;
    try {
        domain = normalizeDomain(value);
    } catch {
        fail("domain");
    }
    if (!domain || domain !== value) fail("domain");
    return domain;
}

function requireCanonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0 ||
        new Date(timestamp).toISOString() !== value) {
        fail("observedAt");
    }
    return value;
}

function readOwn(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("record");
    return descriptor.value;
}

function assertRequest(input) {
    if (!isPlainRecord(input)) fail("request");
    const keys = Reflect.ownKeys(input);
    if (keys.length !== 2 || !keys.includes("tenantId") || !keys.includes("domain") ||
        keys.some(key => typeof key !== "string")) {
        fail("request");
    }
    return Object.freeze({
        tenantId: requireCanonicalTenantId(readOwn(input, "tenantId")),
        domain: requireCanonicalDomain(readOwn(input, "domain"))
    });
}

function projectRoute(route, expectedTenantId, expectedDomain) {
    if (!isPlainRecord(route)) fail("route");
    const allowed = ["schemaVersion", "domain", "tenantId", "state", "observedAt"];
    const keys = Reflect.ownKeys(route);
    if (keys.length !== allowed.length || keys.some(key =>
        typeof key !== "string" || !allowed.includes(key))) {
        fail("route fields");
    }

    if (readOwn(route, "schemaVersion") !== 1 ||
        requireCanonicalTenantId(readOwn(route, "tenantId")) !== expectedTenantId ||
        requireCanonicalDomain(readOwn(route, "domain")) !== expectedDomain) {
        fail("route scope");
    }

    const state = readOwn(route, "state");
    if (!new Set(["active", "inactive"]).has(state)) fail("route state");

    return Object.freeze({
        tenantId: expectedTenantId,
        domain: expectedDomain,
        state: state === "active" ? "verified" : "pending",
        observedAt: requireCanonicalTimestamp(readOwn(route, "observedAt"))
    });
}

function createPublicRouteDomainEvidenceProvider({ routeReader } = {}) {
    if (!routeReader || typeof routeReader.getByDomain !== "function") {
        fail("route reader");
    }

    return Object.freeze({
        async getStatus(input) {
            const request = assertRequest(input);
            const route = await routeReader.getByDomain(request.domain);
            if (route === null) return null;
            return projectRoute(route, request.tenantId, request.domain);
        }
    });
}

module.exports = {
    createPublicRouteDomainEvidenceProvider
};
