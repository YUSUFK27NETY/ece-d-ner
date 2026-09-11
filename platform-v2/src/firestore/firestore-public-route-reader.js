const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");

const DEFAULT_PUBLIC_ROUTE_COLLECTION = "platformTenantPublicRoutes";
const PUBLIC_ROUTE_STATES = Object.freeze(["active", "inactive"]);

function fail(label) {
    throw new TypeError(`Public route reader ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
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

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireIsoTimestamp(value) {
    if (typeof value !== "string") fail("observedAt");
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
        fail("observedAt");
    }
    return value;
}

function normalizePublicRouteRecord({ domain, data }) {
    const safeDomain = requireCanonicalDomain(domain);
    if (!isPlainRecord(data)) fail("record");
    const allowed = ["schemaVersion", "domain", "tenantId", "state", "observedAt"];
    const keys = Reflect.ownKeys(data);
    if (keys.length !== allowed.length || keys.some(key =>
        typeof key !== "string" || !allowed.includes(key))) {
        fail("record");
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(data, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("record");
    }
    if (ownValue(data, "schemaVersion") !== 1 ||
        ownValue(data, "domain") !== safeDomain) {
        fail("record");
    }
    const tenantId = requireCanonicalTenantId(ownValue(data, "tenantId"));
    const state = ownValue(data, "state");
    if (!PUBLIC_ROUTE_STATES.includes(state)) fail("state");
    const observedAt = requireIsoTimestamp(ownValue(data, "observedAt"));
    return Object.freeze({
        schemaVersion: 1,
        domain: safeDomain,
        tenantId,
        state,
        observedAt
    });
}

function createFirestorePublicRouteReader({
    db,
    collectionName = DEFAULT_PUBLIC_ROUTE_COLLECTION
} = {}) {
    if (!db || typeof db.collection !== "function") {
        fail("db");
    }
    const safeCollectionName = String(collectionName ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeCollectionName)) {
        fail("collection");
    }
    const collection = db.collection(safeCollectionName);
    if (!collection || typeof collection.doc !== "function") {
        fail("collection");
    }

    return Object.freeze({
        async getByDomain(rawDomain) {
            const domain = requireCanonicalDomain(rawDomain);
            const snapshot = await collection.doc(domain).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (snapshot.id !== domain || typeof snapshot.data !== "function") {
                fail("snapshot");
            }
            return normalizePublicRouteRecord({
                domain,
                data: snapshot.data()
            });
        }
    });
}

module.exports = {
    DEFAULT_PUBLIC_ROUTE_COLLECTION,
    PUBLIC_ROUTE_STATES,
    createFirestorePublicRouteReader,
    normalizePublicRouteRecord
};
