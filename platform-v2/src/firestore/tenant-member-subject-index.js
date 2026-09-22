"use strict";

const { requireTenantId } = require("../tenant/tenant-id");

const DEFAULT_TENANT_MEMBER_SUBJECT_INDEX_COLLECTION =
    "platformTenantMemberSubjects";
const SUBJECT_REF_PATTERN = /^firebase:[0-9a-f]{64}$/;
const INDEX_FIELDS = Object.freeze([
    "schemaVersion",
    "subjectRef",
    "tenantId",
    "state",
    "observedAt"
]);

function fail(label) {
    throw new TypeError(`Tenant member subject index ${label} geçersiz.`);
}

function requireSubjectRef(value) {
    if (typeof value !== "string" || !SUBJECT_REF_PATTERN.test(value)) {
        fail("subjectRef");
    }
    return value;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireTimestamp(value) {
    if (typeof value !== "string") fail("observedAt");
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
        fail("observedAt");
    }
    return value;
}

function isPlainRecord(value) {
    return Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function createTenantMemberSubjectIndex({
    subjectRef: rawSubjectRef,
    tenantId: rawTenantId,
    observedAt: rawObservedAt
} = {}) {
    return Object.freeze({
        schemaVersion: 1,
        subjectRef: requireSubjectRef(rawSubjectRef),
        tenantId: requireCanonicalTenantId(rawTenantId),
        state: "active",
        observedAt: requireTimestamp(rawObservedAt)
    });
}

function projectTenantMemberSubjectIndex(record, expectedSubjectRef = null) {
    if (!isPlainRecord(record)) fail("record");
    const keys = Reflect.ownKeys(record);
    if (keys.length !== INDEX_FIELDS.length ||
        keys.some(key => typeof key !== "string" || !INDEX_FIELDS.includes(key))) {
        fail("record fields");
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail("record");
        }
    }

    const projected = createTenantMemberSubjectIndex({
        subjectRef: record.subjectRef,
        tenantId: record.tenantId,
        observedAt: record.observedAt
    });
    if (record.schemaVersion !== 1 || record.state !== "active") {
        fail("record");
    }
    if (expectedSubjectRef !== null &&
        requireSubjectRef(expectedSubjectRef) !== projected.subjectRef) {
        fail("record subjectRef");
    }
    return projected;
}

function createTenantMemberSubjectIndexCollection({
    db,
    collectionName = DEFAULT_TENANT_MEMBER_SUBJECT_INDEX_COLLECTION
} = {}) {
    if (!db || typeof db.collection !== "function") fail("db");
    const safeName = String(collectionName ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeName)) fail("collection");
    const collection = db.collection(safeName);
    if (!collection || typeof collection.doc !== "function") {
        fail("collection");
    }
    return collection;
}

module.exports = {
    DEFAULT_TENANT_MEMBER_SUBJECT_INDEX_COLLECTION,
    createTenantMemberSubjectIndex,
    createTenantMemberSubjectIndexCollection,
    projectTenantMemberSubjectIndex
};
