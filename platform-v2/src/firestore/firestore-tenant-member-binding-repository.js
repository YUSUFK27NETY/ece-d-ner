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
const INITIAL_OWNER_INVITE_SETTING_ID = "initial-owner-invite";
const SUBJECT_REF_PATTERN = /^firebase:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "subjectRef", "role", "source", "state",
    "createdAt", "updatedAt"
]);
const INVITE_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "emailHash", "tokenHash", "role", "state",
    "delivery", "createdAt", "expiresAt"
]);

function fail(label) {
    throw new TypeError(`Tenant member binding ${label} geçersiz.`);
}

function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function conflict() {
    return codedError("TENANT_INITIAL_OWNER_ALREADY_BOUND", "Tenant initial owner zaten bağlı.");
}

function stateChanged() {
    return codedError("TENANT_BOOTSTRAP_STATE_CHANGED", "Tenant durumu bootstrap sırasında değişti.");
}

function invalidInvite() {
    return codedError("TENANT_INITIAL_OWNER_INVITE_INVALID", "Initial owner daveti geçersiz.");
}

function expiredInvite() {
    return codedError("TENANT_INITIAL_OWNER_INVITE_EXPIRED", "Initial owner davetinin süresi dolmuş.");
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
    if (typeof value !== "string" || !SUBJECT_REF_PATTERN.test(value)) fail("subjectRef");
    return value;
}

function requireHash(value, label) {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) fail(label);
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

function projectInvite(record, tenantId) {
    requireExactKeys(record, INVITE_FIELDS, "invite");
    const projected = {};
    for (const field of INVITE_FIELDS) projected[field] = record[field];
    if (projected.schemaVersion !== 1 || projected.tenantId !== tenantId ||
        projected.role !== "tenant_owner" || projected.state !== "pending" ||
        projected.delivery !== "firebase_email_link") {
        fail("invite");
    }
    requireHash(projected.emailHash, "invite emailHash");
    requireHash(projected.tokenHash, "invite tokenHash");
    requireCanonicalTimestamp(projected.createdAt, "invite createdAt");
    requireCanonicalTimestamp(projected.expiresAt, "invite expiresAt");
    if (new Date(projected.expiresAt).getTime() <= new Date(projected.createdAt).getTime()) {
        fail("invite expiry");
    }
    return Object.freeze(projected);
}

function requireExpectedTenant(expectedTenant) {
    if (!isPlainRecord(expectedTenant) || typeof expectedTenant.tenantId !== "string" ||
        expectedTenant.id !== expectedTenant.tenantId || expectedTenant.status !== "provisioning") {
        fail("expected tenant");
    }
    return requireCanonicalTenantId(expectedTenant.tenantId);
}

function requireAuditEvent(auditEvent, tenantId, action) {
    if (!isPlainRecord(auditEvent) || auditEvent.tenantId !== tenantId ||
        typeof auditEvent.eventId !== "string" || !AUDIT_EVENT_ID_PATTERN.test(auditEvent.eventId) ||
        auditEvent.action !== action) {
        fail("audit event");
    }
    return auditEvent;
}

function requireInitialOwnerArtifacts({ expectedTenant, binding, ownerSlot, evidence, auditEvent }) {
    const tenantId = requireExpectedTenant(expectedTenant);
    const safeBinding = projectBinding(binding, tenantId, requireSubjectRef(binding?.subjectRef));
    if (safeBinding.role !== "tenant_owner" || safeBinding.state !== "active") fail("initial owner binding");

    requireExactKeys(ownerSlot, [
        "schemaVersion", "tenantId", "subjectRef", "kind", "role", "source", "state", "observedAt"
    ], "owner slot");
    if (ownerSlot.schemaVersion !== 1 || ownerSlot.tenantId !== tenantId ||
        ownerSlot.subjectRef !== safeBinding.subjectRef || ownerSlot.kind !== "initial_owner" ||
        ownerSlot.role !== "tenant_owner" || ownerSlot.source !== "controlled_external_identity" ||
        ownerSlot.state !== "verified") fail("owner slot");
    requireCanonicalTimestamp(ownerSlot.observedAt, "owner slot observedAt");

    requireExactKeys(evidence, [
        "schemaVersion", "tenantId", "kind", "role", "source", "state", "observedAt"
    ], "readiness evidence");
    if (evidence.schemaVersion !== 1 || evidence.tenantId !== tenantId ||
        evidence.kind !== "initial_owner" || evidence.role !== "tenant_owner" ||
        evidence.source !== "controlled_external_identity" || evidence.state !== "verified" ||
        evidence.observedAt !== ownerSlot.observedAt) fail("readiness evidence");

    requireAuditEvent(auditEvent, tenantId, "tenant.initial_owner.bound");
    return Object.freeze({ tenantId, binding: safeBinding });
}

function createFirestoreTenantMemberBindingRepository({
    db,
    tenantRegistryCollection = DEFAULT_TENANT_REGISTRY_COLLECTION
}) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") fail("db");
    const collectionName = String(tenantRegistryCollection ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(collectionName)) fail("tenant registry collection");
    const tenantRegistry = db.collection(collectionName);

    function refsFor(tenantId, subjectRef = null) {
        const refs = {
            tenantRef: tenantRegistry.doc(tenantId),
            ownerSlotRef: db.doc(tenantSettingsDocument(tenantId, INITIAL_OWNER_BINDING_SETTING_ID)),
            inviteRef: db.doc(tenantSettingsDocument(tenantId, INITIAL_OWNER_INVITE_SETTING_ID)),
            evidenceRef: db.doc(tenantSettingsDocument(tenantId, ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID))
        };
        if (subjectRef) {
            refs.memberRef = db.doc(tenantDocument(tenantId, TENANT_COLLECTIONS.members, subjectRef));
        }
        return refs;
    }

    function auditRef(tenantId, eventId) {
        return db.doc(`${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`);
    }

    async function assertPersistedTenant(transaction, tenantRef, expectedTenant) {
        const tenantSnapshot = await transaction.get(tenantRef);
        if (!tenantSnapshot || tenantSnapshot.exists !== true || typeof tenantSnapshot.data !== "function") {
            throw stateChanged();
        }
        const persistedTenant = { id: tenantSnapshot.id, ...tenantSnapshot.data() };
        if (!isDeepStrictEqual(persistedTenant, expectedTenant)) throw stateChanged();
    }

    return Object.freeze({
        async getBySubject({ tenantId: rawTenantId, subjectRef: rawSubjectRef } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const subjectRef = requireSubjectRef(rawSubjectRef);
            const ref = db.doc(tenantDocument(tenantId, TENANT_COLLECTIONS.members, subjectRef));
            const snapshot = await ref.get();
            if (!snapshot || typeof snapshot.exists !== "boolean") fail("snapshot");
            if (!snapshot.exists) return null;
            if (typeof snapshot.data !== "function") fail("snapshot data");
            return projectBinding(snapshot.data(), tenantId, subjectRef);
        },

        async createInitialOwnerInvite(input = {}) {
            const tenantId = requireExpectedTenant(input.expectedTenant);
            const invite = projectInvite(input.invite, tenantId);
            requireAuditEvent(input.auditEvent, tenantId, "tenant.initial_owner.invite.created");
            const refs = refsFor(tenantId);
            const createdAuditRef = auditRef(tenantId, input.auditEvent.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.set !== "function" || typeof transaction.create !== "function") {
                    fail("transaction");
                }
                await assertPersistedTenant(transaction, refs.tenantRef, input.expectedTenant);
                const ownerSlotSnapshot = await transaction.get(refs.ownerSlotRef);
                if (!ownerSlotSnapshot || typeof ownerSlotSnapshot.exists !== "boolean") fail("transaction snapshot");
                if (ownerSlotSnapshot.exists) throw conflict();
                transaction.set(refs.inviteRef, { ...invite });
                transaction.create(createdAuditRef, { ...input.auditEvent });
                return invite;
            });
        },

        async commitInitialOwner(input = {}) {
            const { tenantId, binding } = requireInitialOwnerArtifacts(input);
            const refs = refsFor(tenantId, binding.subjectRef);
            const boundAuditRef = auditRef(tenantId, input.auditEvent.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") fail("transaction");
                await assertPersistedTenant(transaction, refs.tenantRef, input.expectedTenant);
                const memberSnapshot = await transaction.get(refs.memberRef);
                const ownerSlotSnapshot = await transaction.get(refs.ownerSlotRef);
                const evidenceSnapshot = await transaction.get(refs.evidenceRef);
                for (const snapshot of [memberSnapshot, ownerSlotSnapshot, evidenceSnapshot]) {
                    if (!snapshot || typeof snapshot.exists !== "boolean") fail("transaction snapshot");
                    if (snapshot.exists) throw conflict();
                }
                transaction.create(refs.memberRef, { ...input.binding });
                transaction.create(refs.ownerSlotRef, { ...input.ownerSlot });
                transaction.create(refs.evidenceRef, { ...input.evidence });
                transaction.create(boundAuditRef, { ...input.auditEvent });
                return binding;
            });
        },

        async commitInitialOwnerFromInvite(input = {}) {
            const { tenantId, binding } = requireInitialOwnerArtifacts(input);
            const emailHash = requireHash(input.emailHash, "accept emailHash");
            const tokenHash = requireHash(input.tokenHash, "accept tokenHash");
            const acceptedAt = requireCanonicalTimestamp(input.acceptedAt, "accept timestamp");
            const refs = refsFor(tenantId, binding.subjectRef);
            const boundAuditRef = auditRef(tenantId, input.auditEvent.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function" || typeof transaction.delete !== "function") {
                    fail("transaction");
                }
                await assertPersistedTenant(transaction, refs.tenantRef, input.expectedTenant);
                const inviteSnapshot = await transaction.get(refs.inviteRef);
                const memberSnapshot = await transaction.get(refs.memberRef);
                const ownerSlotSnapshot = await transaction.get(refs.ownerSlotRef);
                const evidenceSnapshot = await transaction.get(refs.evidenceRef);
                if (!inviteSnapshot || typeof inviteSnapshot.exists !== "boolean" ||
                    !memberSnapshot || typeof memberSnapshot.exists !== "boolean" ||
                    !ownerSlotSnapshot || typeof ownerSlotSnapshot.exists !== "boolean" ||
                    !evidenceSnapshot || typeof evidenceSnapshot.exists !== "boolean") {
                    fail("transaction snapshot");
                }
                if (memberSnapshot.exists || ownerSlotSnapshot.exists || evidenceSnapshot.exists) throw conflict();
                if (!inviteSnapshot.exists || typeof inviteSnapshot.data !== "function") throw invalidInvite();
                const invite = projectInvite(inviteSnapshot.data(), tenantId);
                if (invite.emailHash !== emailHash || invite.tokenHash !== tokenHash) throw invalidInvite();
                if (new Date(acceptedAt).getTime() >= new Date(invite.expiresAt).getTime()) throw expiredInvite();

                transaction.create(refs.memberRef, { ...input.binding });
                transaction.create(refs.ownerSlotRef, { ...input.ownerSlot });
                transaction.create(refs.evidenceRef, { ...input.evidence });
                transaction.create(boundAuditRef, { ...input.auditEvent });
                transaction.delete(refs.inviteRef);
                return binding;
            });
        }
    });
}

module.exports = {
    INITIAL_OWNER_BINDING_SETTING_ID,
    INITIAL_OWNER_INVITE_SETTING_ID,
    createFirestoreTenantMemberBindingRepository
};
