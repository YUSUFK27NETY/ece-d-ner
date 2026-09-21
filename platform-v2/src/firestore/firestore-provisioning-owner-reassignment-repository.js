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
const {
    INITIAL_OWNER_BINDING_SETTING_ID
} = require("./firestore-tenant-member-binding-repository");

const OWNER_REASSIGNMENT_INVITE_SETTING_ID = "initial-owner-reassignment-invite";
const SUBJECT_REF_PATTERN = /^firebase:[0-9a-f]{64}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const AUDIT_EVENT_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MEMBER_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "subjectRef", "role", "source", "state",
    "createdAt", "updatedAt"
]);
const OWNER_SLOT_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "subjectRef", "kind", "role", "source",
    "state", "observedAt"
]);
const EVIDENCE_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "kind", "role", "source", "state", "observedAt"
]);
const INVITE_FIELDS = Object.freeze([
    "schemaVersion", "tenantId", "emailHash", "tokenHash",
    "expectedOwnerSubjectRef", "role", "state", "delivery",
    "createdAt", "expiresAt"
]);

function fail(label) {
    throw new TypeError(`Provisioning owner reassignment ${label} geçersiz.`);
}

function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function stateChanged() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_STATE_CHANGED",
        "Owner reassignment durumu değişti."
    );
}

function ownerMissing() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_OWNER_MISSING",
        "Tutarlı mevcut owner bulunamadı."
    );
}

function invalidInvite() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_INVITE_INVALID",
        "Owner reassignment daveti geçersiz."
    );
}

function expiredInvite() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_INVITE_EXPIRED",
        "Owner reassignment davetinin süresi dolmuş."
    );
}

function targetExists() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_TARGET_EXISTS",
        "Yeni owner kimliği bu tenantta zaten kayıtlı."
    );
}

function sameSubject() {
    return codedError(
        "TENANT_OWNER_REASSIGNMENT_SAME_SUBJECT",
        "Yeni owner mevcut owner ile aynı."
    );
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(record, keys, label) {
    if (!isPlainRecord(record)) fail(label);
    const ownKeys = Reflect.ownKeys(record);
    if (ownKeys.length !== keys.length ||
        ownKeys.some(key => typeof key !== "string" || !keys.includes(key))) {
        fail(`${label} fields`);
    }
    return record;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireSubjectRef(value, label = "subjectRef") {
    if (typeof value !== "string" || !SUBJECT_REF_PATTERN.test(value)) {
        fail(label);
    }
    return value;
}

function requireHash(value, label) {
    if (typeof value !== "string" || !HASH_PATTERN.test(value)) fail(label);
    return value;
}

function requireTimestamp(value, label) {
    if (typeof value !== "string") fail(label);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
        fail(label);
    }
    return value;
}

function requireProvisioningTenant(tenant) {
    if (!isPlainRecord(tenant) || typeof tenant.tenantId !== "string" ||
        tenant.id !== tenant.tenantId || tenant.status !== "provisioning") {
        fail("expected tenant");
    }
    return requireCanonicalTenantId(tenant.tenantId);
}

function requireAuditEvent(event, tenantId, action) {
    if (!isPlainRecord(event) || event.tenantId !== tenantId ||
        typeof event.eventId !== "string" ||
        !AUDIT_EVENT_ID_PATTERN.test(event.eventId) ||
        event.action !== action) {
        fail("audit event");
    }
    return event;
}

function projectMember(record, tenantId, subjectRef) {
    requireExactKeys(record, MEMBER_FIELDS, "member");
    if (record.schemaVersion !== 1 || record.tenantId !== tenantId ||
        record.subjectRef !== subjectRef || record.role !== "tenant_owner" ||
        record.source !== "firebase_auth" ||
        !["active", "revoked"].includes(record.state)) {
        fail("member");
    }
    requireTimestamp(record.createdAt, "member createdAt");
    requireTimestamp(record.updatedAt, "member updatedAt");
    return Object.freeze({ ...record });
}

function projectOwnerSlot(record, tenantId) {
    requireExactKeys(record, OWNER_SLOT_FIELDS, "owner slot");
    const subjectRef = requireSubjectRef(record.subjectRef, "owner slot subjectRef");
    if (record.schemaVersion !== 1 || record.tenantId !== tenantId ||
        record.kind !== "initial_owner" || record.role !== "tenant_owner" ||
        record.source !== "controlled_external_identity" ||
        record.state !== "verified") {
        fail("owner slot");
    }
    requireTimestamp(record.observedAt, "owner slot observedAt");
    return Object.freeze({ ...record, subjectRef });
}

function projectEvidence(record, tenantId) {
    requireExactKeys(record, EVIDENCE_FIELDS, "evidence");
    if (record.schemaVersion !== 1 || record.tenantId !== tenantId ||
        record.kind !== "initial_owner" || record.role !== "tenant_owner" ||
        record.source !== "controlled_external_identity" ||
        record.state !== "verified") {
        fail("evidence");
    }
    requireTimestamp(record.observedAt, "evidence observedAt");
    return Object.freeze({ ...record });
}

function projectInvite(record, tenantId) {
    requireExactKeys(record, INVITE_FIELDS, "invite");
    if (record.schemaVersion !== 1 || record.tenantId !== tenantId ||
        record.role !== "tenant_owner" || record.state !== "pending" ||
        record.delivery !== "firebase_email_link") {
        fail("invite");
    }
    requireHash(record.emailHash, "invite emailHash");
    requireHash(record.tokenHash, "invite tokenHash");
    requireSubjectRef(
        record.expectedOwnerSubjectRef,
        "invite expectedOwnerSubjectRef"
    );
    requireTimestamp(record.createdAt, "invite createdAt");
    requireTimestamp(record.expiresAt, "invite expiresAt");
    if (new Date(record.expiresAt).getTime() <= new Date(record.createdAt).getTime()) {
        fail("invite expiry");
    }
    return Object.freeze({ ...record });
}

function requireCurrentOwnerConsistency({ ownerSlot, evidence, member }) {
    if (ownerSlot.state !== "verified" || evidence.state !== "verified" ||
        ownerSlot.observedAt !== evidence.observedAt ||
        member.state !== "active" ||
        member.subjectRef !== ownerSlot.subjectRef) {
        throw ownerMissing();
    }
}

function createFirestoreProvisioningOwnerReassignmentRepository({
    db,
    tenantRegistryCollection = DEFAULT_TENANT_REGISTRY_COLLECTION
}) {
    if (!db || typeof db.doc !== "function" ||
        typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") {
        fail("db");
    }
    const collectionName = String(tenantRegistryCollection ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(collectionName)) {
        fail("tenant registry collection");
    }
    const tenantRegistry = db.collection(collectionName);

    function refs(tenantId) {
        return Object.freeze({
            tenantRef: tenantRegistry.doc(tenantId),
            ownerSlotRef: db.doc(tenantSettingsDocument(
                tenantId,
                INITIAL_OWNER_BINDING_SETTING_ID
            )),
            evidenceRef: db.doc(tenantSettingsDocument(
                tenantId,
                ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID
            )),
            inviteRef: db.doc(tenantSettingsDocument(
                tenantId,
                OWNER_REASSIGNMENT_INVITE_SETTING_ID
            ))
        });
    }

    function memberRef(tenantId, subjectRef) {
        return db.doc(tenantDocument(
            tenantId,
            TENANT_COLLECTIONS.members,
            subjectRef
        ));
    }

    function auditRef(tenantId, eventId) {
        return db.doc(
            `${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`
        );
    }

    async function assertTenant(transaction, tenantRef, expectedTenant) {
        const snapshot = await transaction.get(tenantRef);
        if (!snapshot || snapshot.exists !== true ||
            typeof snapshot.data !== "function") {
            throw stateChanged();
        }
        const persisted = { id: snapshot.id, ...snapshot.data() };
        if (!isDeepStrictEqual(persisted, expectedTenant)) {
            throw stateChanged();
        }
    }

    async function readCurrentOwner(transaction, tenantId, baseRefs) {
        const ownerSnapshot = await transaction.get(baseRefs.ownerSlotRef);
        const evidenceSnapshot = await transaction.get(baseRefs.evidenceRef);
        if (!ownerSnapshot || typeof ownerSnapshot.exists !== "boolean" ||
            !evidenceSnapshot || typeof evidenceSnapshot.exists !== "boolean") {
            fail("transaction snapshot");
        }
        if (!ownerSnapshot.exists || !evidenceSnapshot.exists ||
            typeof ownerSnapshot.data !== "function" ||
            typeof evidenceSnapshot.data !== "function") {
            throw ownerMissing();
        }

        const ownerSlot = projectOwnerSlot(ownerSnapshot.data(), tenantId);
        const evidence = projectEvidence(evidenceSnapshot.data(), tenantId);
        const oldMemberRef = memberRef(tenantId, ownerSlot.subjectRef);
        const oldMemberSnapshot = await transaction.get(oldMemberRef);
        if (!oldMemberSnapshot ||
            typeof oldMemberSnapshot.exists !== "boolean") {
            fail("transaction snapshot");
        }
        if (!oldMemberSnapshot.exists ||
            typeof oldMemberSnapshot.data !== "function") {
            throw ownerMissing();
        }
        const oldMember = projectMember(
            oldMemberSnapshot.data(),
            tenantId,
            ownerSlot.subjectRef
        );
        requireCurrentOwnerConsistency({ ownerSlot, evidence, member: oldMember });
        return Object.freeze({
            ownerSlot,
            evidence,
            oldMember,
            oldMemberRef
        });
    }

    return Object.freeze({
        async createInvite(input = {}) {
            const tenantId = requireProvisioningTenant(input.expectedTenant);
            const invite = projectInvite(input.invite, tenantId);
            requireAuditEvent(
                input.auditEvent,
                tenantId,
                "tenant.initial_owner.reassignment.invite.created"
            );
            const baseRefs = refs(tenantId);
            const createdAuditRef = auditRef(
                tenantId,
                input.auditEvent.eventId
            );

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.set !== "function" ||
                    typeof transaction.create !== "function") {
                    fail("transaction");
                }
                await assertTenant(
                    transaction,
                    baseRefs.tenantRef,
                    input.expectedTenant
                );
                const current = await readCurrentOwner(
                    transaction,
                    tenantId,
                    baseRefs
                );
                if (invite.expectedOwnerSubjectRef !==
                    current.ownerSlot.subjectRef) {
                    throw stateChanged();
                }

                transaction.set(baseRefs.inviteRef, { ...invite });
                transaction.create(createdAuditRef, { ...input.auditEvent });
                return invite;
            });
        },

        async commitReassignment(input = {}) {
            const tenantId = requireProvisioningTenant(input.expectedTenant);
            const emailHash = requireHash(input.emailHash, "accept emailHash");
            const tokenHash = requireHash(input.tokenHash, "accept tokenHash");
            const acceptedAt = requireTimestamp(
                input.acceptedAt,
                "accept timestamp"
            );
            const newBinding = projectMember(
                input.newBinding,
                tenantId,
                requireSubjectRef(
                    input.newBinding?.subjectRef,
                    "new binding subjectRef"
                )
            );
            const newOwnerSlot = projectOwnerSlot(
                input.newOwnerSlot,
                tenantId
            );
            const newEvidence = projectEvidence(
                input.newEvidence,
                tenantId
            );
            if (newBinding.state !== "active" ||
                newOwnerSlot.subjectRef !== newBinding.subjectRef ||
                newEvidence.observedAt !== newOwnerSlot.observedAt ||
                newOwnerSlot.observedAt !== acceptedAt) {
                fail("new owner artifacts");
            }
            requireAuditEvent(
                input.auditEvent,
                tenantId,
                "tenant.initial_owner.reassigned"
            );

            const baseRefs = refs(tenantId);
            const reassignedAuditRef = auditRef(
                tenantId,
                input.auditEvent.eventId
            );

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.set !== "function" ||
                    typeof transaction.create !== "function" ||
                    typeof transaction.delete !== "function") {
                    fail("transaction");
                }
                await assertTenant(
                    transaction,
                    baseRefs.tenantRef,
                    input.expectedTenant
                );

                const inviteSnapshot = await transaction.get(
                    baseRefs.inviteRef
                );
                if (!inviteSnapshot ||
                    typeof inviteSnapshot.exists !== "boolean") {
                    fail("transaction snapshot");
                }
                if (!inviteSnapshot.exists ||
                    typeof inviteSnapshot.data !== "function") {
                    throw invalidInvite();
                }
                const invite = projectInvite(
                    inviteSnapshot.data(),
                    tenantId
                );
                if (invite.emailHash !== emailHash ||
                    invite.tokenHash !== tokenHash) {
                    throw invalidInvite();
                }
                if (new Date(acceptedAt).getTime() >=
                    new Date(invite.expiresAt).getTime()) {
                    throw expiredInvite();
                }

                const current = await readCurrentOwner(
                    transaction,
                    tenantId,
                    baseRefs
                );
                if (invite.expectedOwnerSubjectRef !==
                    current.ownerSlot.subjectRef) {
                    throw stateChanged();
                }
                if (newBinding.subjectRef === current.ownerSlot.subjectRef) {
                    throw sameSubject();
                }

                const newMemberRef = memberRef(
                    tenantId,
                    newBinding.subjectRef
                );
                const newMemberSnapshot = await transaction.get(
                    newMemberRef
                );
                if (!newMemberSnapshot ||
                    typeof newMemberSnapshot.exists !== "boolean") {
                    fail("transaction snapshot");
                }
                if (newMemberSnapshot.exists) {
                    throw targetExists();
                }

                const revokedOldMember = {
                    ...current.oldMember,
                    state: "revoked",
                    updatedAt: acceptedAt
                };

                transaction.set(
                    current.oldMemberRef,
                    revokedOldMember
                );
                transaction.create(
                    newMemberRef,
                    { ...newBinding }
                );
                transaction.set(
                    baseRefs.ownerSlotRef,
                    { ...newOwnerSlot }
                );
                transaction.set(
                    baseRefs.evidenceRef,
                    { ...newEvidence }
                );
                transaction.create(
                    reassignedAuditRef,
                    { ...input.auditEvent }
                );
                transaction.delete(baseRefs.inviteRef);
                return newBinding;
            });
        }
    });
}

module.exports = {
    OWNER_REASSIGNMENT_INVITE_SETTING_ID,
    createFirestoreProvisioningOwnerReassignmentRepository
};
