const { requireTenantId } = require("../tenant/tenant-id");
const { tenantCollection, TENANT_COLLECTIONS } = require("./tenant-paths");

function fail(label) {
    throw new TypeError(`Firestore audit reader ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readOwn(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail("record");
    }
    return descriptor.value;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        fail("tenantId");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail("tenantId");
    }
    return tenantId;
}

function projectRecord(record, tenantId) {
    if (!isPlainRecord(record)) {
        fail("record");
    }

    const eventTenantId = readOwn(record, "tenantId");
    const action = readOwn(record, "action");
    const createdAt = readOwn(record, "createdAt");
    if (requireCanonicalTenantId(eventTenantId) !== tenantId ||
        typeof action !== "string" ||
        !/^[a-z0-9_.-]{3,120}$/i.test(action) ||
        typeof createdAt !== "string" ||
        Number.isNaN(Date.parse(createdAt)) ||
        new Date(Date.parse(createdAt)).toISOString() !== createdAt) {
        fail("record");
    }

    return Object.freeze({
        tenantId,
        action,
        createdAt
    });
}

function createFirestoreAuditReader({ db }) {
    if (!db || typeof db.collection !== "function") {
        fail("db");
    }

    return Object.freeze({
        async getLatest(input) {
            if (!isPlainRecord(input) || Reflect.ownKeys(input).length !== 1) {
                fail("request");
            }

            const tenantId = requireCanonicalTenantId(
                readOwn(input, "tenantId")
            );
            const path = tenantCollection(tenantId, TENANT_COLLECTIONS.audit);
            const collection = db.collection(path);
            if (!collection || typeof collection.orderBy !== "function") {
                fail("collection");
            }

            const ordered = collection.orderBy("createdAt", "desc");
            if (!ordered || typeof ordered.limit !== "function") {
                fail("query");
            }
            const limited = ordered.limit(1);
            if (!limited || typeof limited.get !== "function") {
                fail("query");
            }

            const snapshot = await limited.get();
            if (!snapshot || !Array.isArray(snapshot.docs) ||
                snapshot.docs.length > 1) {
                fail("snapshot");
            }
            if (snapshot.docs.length === 0) {
                return null;
            }

            const document = snapshot.docs[0];
            if (!document || typeof document.data !== "function") {
                fail("document");
            }

            return projectRecord(document.data(), tenantId);
        }
    });
}

module.exports = {
    createFirestoreAuditReader
};
