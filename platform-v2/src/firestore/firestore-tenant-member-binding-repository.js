const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    tenantCollection,
    tenantDocument,
    tenantSettingsDocument,
    TENANT_COLLECTIONS
} = require("./tenant-paths");
const {
    DEFAULT_TENANT_REGISTRY_COLLECTION
} = require("./firestore-tenant-registry");
const {
    ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID
} = require("./firestore-admin-bootstrap-evidence-provider");
const { requireTenantMemberRole } = require("../auth/tenant-member-subject");

const INITIAL_OWNER_BINDING_SETTING_ID = "initial-owner-binding";
const SUBJECT_REF_PATTERN = /^firebase:[0-9a-f]{64}$/;
const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "subjectRef", "role", "source", "state",
    "createdAt", "updatedAt"
]);

function fail(label) {
    throw new TypeError(`Tenant member binding ${label} geçersiz.`);
}

function conflict() {
    const error = new Error("Tenant initial owner zaten bağlı.");
    error.code = "TENANT_INITIAL_OWNER_ALREADY_BOUND";
    return error;
}

function stateChanged() {
    const error = new Error("Tenant durumu bootstrap sırasında değişti.");
    error.code = "TENANT_BOOTSTRAP_STATE_CHANGED";
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireSubjectRef(value) {
    if (typeof value !== "string" || !SUBJECT_REF_PATTERN.test(value)) {
        fail("subjectRef");
    }
    return value;
}

function requireCanonicalTimestamp(value, label) {
    if (typeof value !== "string") fail(label);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) fail(label);
    return value;
}

function requireExactKeys(record, keys, label) {
    if (!isPlainRecord(record)) fail(label);
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.length !== keys.length || ownKeys.some(key =>
        typeof key !== "string" || !keys.includes(key))) {
        fail(`${label} fields`);
    }
    return record;
}

function projectBinding(record, tenantId, subjectRef) {
    requireExactKeys(record, BINDING_FIELDS, "record");
    const projected = {};
    for (const field of BINDING_FIELDS) projected[field] = record[field];

    if (projected.schemaVersion !== 1 ||
        requireCanonicalTenantId(projected.tenantId) !== tenantId ||
        requireSubjectRef(projected.subjectRef) !== subjectRef ||
        requireTenantMemberRole(projected.role) !== projected.role ||
        projected.source !== "firebase_auth" ||
        !["active", "revoked"].includes(projected.state)) {
        fail("record");
    }
    requireCanonicalTimestamp(projected.createdAt, "createdAt");
    requireCanonicalTimestamp(projected.updatedAt, "updatedAt");
    return Object.freeze(projected);
}

function requireInitialOwnerArtifacts({ expectedTenant, binding, ownerSlot, evidence, auditEvent }) {
    if (!isPlainRecord(expectedTenant) ||
        typeof expectedTenant.tenantId !== "string" ||
        expectedTenant.id !== expectedTenant.tenantId ||
        expectedTenant.status !== "provisioning") {
        fail("expected tenant");
    }
    const tenantId = requireCanonicalTenantId(expectedTenant.tenantId);
    const safeBinding = projectBinding(binding, tenantId, requireSubjectRef(binding?.subjectRef));
    if (safeBinding.role !== "tenant_owner" || safeBinding.state !== "active") fail("initial owner binding");

    requireExactKeys(ownerSlot, [
        "schemaVersion", "tenantId", "subjectRef", "kind", "role", "source", "state", "observedAt"
    ], "owner slot");
    if (ownerSlot.schemaVersion !== 1 || ownerSlot.tenantId !== tenantId ||
        ownerSlot.subjectRef !== safeBinding.subjectRef || ownerSlot.kind !== "initial_owner" ||
        ownerSlot.role !== "tenant_owner" || ownerSlot.source !== "controlled_external_identity" ||
        ownerSlot.state !== "verified") {
        fail("owner slot");
    }
    requireCanonicalTimestamp(ownerSlot.observedAt, "owner slot observedAt");

    requireExactKeys(evidence, [
        "schemaVersion", "tenantId", "kind", "role", "source", "state", "observedAt"
    ], "readiness evidence");
    if (evidence.schemaVersion !== 1 || evidence.tenantId !== tenantId ||
        evidence.kind !== "initial_owner" || evidence.role !== "tenant_owner" ||
        evidence.source !== "controlled_external_identity" || evidence.state !== "verified" ||
        evidence.observedAt !== ownerSlot.observedAt) {
        fail("readiness evidence");
    }

    if (!isPlainRecord(auditEvent) || auditEvent.tenantId !== tenantId ||
        typeof auditEvent.eventId !== "string" || !AUDIT_EVENT_ID_PATTERN.test(auditEvent.eventId) ||
        auditEvent.action !== "tenant.initial_owner.bound") {
        fail("audit event");
    }

    return Object.freeze({ tenantId, binding: safeBinding });
}

function createFirestoreTenantMemberBindingRepository({
    db,
    tenantRegistryCollection = DEFAULT_TENANT_REGISTRY_COLLECTION
}) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") {
        fail("db");
    }
    const collectionName = String(tenantRegistryCollection ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(collectionName)) fail("tenant registry collection");
    const tenantRegistry = db.collection(collectionName);

    return Object.freeze({
        async getBySubject({ tenantId: rawTenantId, subjectRef: rawSubjectRef } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const subjectRef = requireSubjectRef(rawSubjectRef);
            const ref = db.doc(tenantDocument(
                tenantId,
                TENANT_COLLECTIONS.members,
                subjectRef
            ));
            const snapshot = await ref.get();
            if (!snapshot || typeof snapshot.exists !== "boolean") fail("snapshot");
            if (!snapshot.exists) return null;
            if (typeof snapshot.data !== "function") fail("snapshot data");
            return projectBinding(snapshot.data(), tenantId, subjectRef);
        },

        async commitInitialOwner(input = {}) {
            const { tenantId, binding } = requireInitialOwnerArtifacts(input);
            const tenantRef = tenantRegistry.doc(tenantId);
            const memberRef = db.doc(tenantDocument(
                tenantId,
                TENANT_COLLECTIONS.members,
                binding.subjectRef
            ));
            const ownerSlotRef = db.doc(tenantSettingsDocument(
                tenantId,
                INITIAL_OWNER_BINDING_SETTING_ID
            ));
            const evidenceRef = db.doc(tenantSettingsDocument(
                tenantId,
                ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID
            ));
            const auditRef = db.doc(`${tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.audit
            )}/${input.auditEvent.eventId}`);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") {
                    fail("transaction");
                }

                const tenantSnapshot = await transaction.get(tenantRef);
                const memberSnapshot = await transaction.get(memberRef);
                const ownerSlotSnapshot = await transaction.get(ownerSlotRef);
                const evidenceSnapshot = await transaction.get(evidenceRef);

                if (!tenantSnapshot || tenantSnapshot.exists !== true ||
                    typeof tenantSnapshot.data !== "function") {
                    throw stateChanged();
                }
                const persistedTenant = {
                    id: tenantSnapshot.id,
                    ...tenantSnapshot.data()
                };
                if (!isDeepStrictEqual(persistedTenant, input.expectedTenant)) {
                    throw stateChanged();
                }

                for (const snapshot of [memberSnapshot, ownerSlotSnapshot, evidenceSnapshot]) {
                    if (!snapshot || typeof snapshot.exists !== "boolean") fail("transaction snapshot");
                    if (snapshot.exists) throw conflict();
                }

                transaction.create(memberRef, { ...input.binding });
                transaction.create(ownerSlotRef, { ...input.ownerSlot });
                transaction.create(evidenceRef, { ...input.evidence });
                transaction.create(auditRef, { ...input.auditEvent });
                return binding;
            });
        }
    });
}

module.exports = {
    INITIAL_OWNER_BINDING_SETTING_ID,
    createFirestoreTenantMemberBindingRepository
};
