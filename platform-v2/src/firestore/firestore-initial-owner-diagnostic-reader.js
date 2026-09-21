const { requireTenantId } = require("../tenant/tenant-id");
const {
    tenantDocument,
    tenantSettingsDocument,
    TENANT_COLLECTIONS
} = require("./tenant-paths");
const {
    INITIAL_OWNER_BINDING_SETTING_ID,
    INITIAL_OWNER_INVITE_SETTING_ID
} = require("./firestore-tenant-member-binding-repository");
const {
    ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID
} = require("./firestore-admin-bootstrap-evidence-provider");

const SUBJECT_REF_PATTERN = /^firebase:[0-9a-f]{64}$/;
const OWNER_SLOT_FIELDS = new Set([
    "schemaVersion", "tenantId", "subjectRef", "kind", "role", "source", "state", "observedAt"
]);
const INVITE_FIELDS = new Set([
    "schemaVersion", "tenantId", "emailHash", "tokenHash", "role", "state",
    "delivery", "createdAt", "expiresAt"
]);
const EVIDENCE_FIELDS = new Set([
    "schemaVersion", "tenantId", "kind", "role", "source", "state", "observedAt"
]);
const MEMBER_FIELDS = new Set([
    "schemaVersion", "tenantId", "subjectRef", "role", "source", "state",
    "createdAt", "updatedAt"
]);

function fail(label) {
    throw new TypeError(`Initial owner diagnostic reader ${label} geçersiz.`);
}

function canonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function hasExactFields(record, allowed) {
    if (!isPlainRecord(record)) return false;
    const keys = Reflect.ownKeys(record);
    return keys.length === allowed.size &&
        keys.every(key => typeof key === "string" && allowed.has(key));
}

function canonicalTimestamp(value) {
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value ? null : value;
}

function snapshotRecord(snapshot) {
    if (!snapshot || typeof snapshot.exists !== "boolean") fail("snapshot");
    if (!snapshot.exists) return null;
    if (typeof snapshot.data !== "function") fail("snapshot data");
    return snapshot.data();
}

function projectOwnerSlot(record, tenantId) {
    if (!record) {
        return Object.freeze({
            exists: false,
            valid: true,
            role: null,
            state: null,
            observedAt: null
        });
    }
    const observedAt = canonicalTimestamp(record.observedAt);
    const subjectRefValid = typeof record.subjectRef === "string" &&
        SUBJECT_REF_PATTERN.test(record.subjectRef);
    const valid = hasExactFields(record, OWNER_SLOT_FIELDS) &&
        record.schemaVersion === 1 &&
        record.tenantId === tenantId &&
        subjectRefValid &&
        record.kind === "initial_owner" &&
        record.role === "tenant_owner" &&
        record.source === "controlled_external_identity" &&
        record.state === "verified" &&
        observedAt !== null;
    return Object.freeze({
        exists: true,
        valid,
        role: record.role === "tenant_owner" ? "tenant_owner" : null,
        state: record.state === "verified" ? "verified" : null,
        observedAt,
        subjectRefValid
    });
}

function projectInvite(record, tenantId, nowMs) {
    if (!record) {
        return Object.freeze({
            exists: false,
            valid: true,
            state: null,
            delivery: null,
            createdAt: null,
            expiresAt: null,
            expired: null
        });
    }
    const createdAt = canonicalTimestamp(record.createdAt);
    const expiresAt = canonicalTimestamp(record.expiresAt);
    const valid = hasExactFields(record, INVITE_FIELDS) &&
        record.schemaVersion === 1 &&
        record.tenantId === tenantId &&
        typeof record.emailHash === "string" && /^[0-9a-f]{64}$/.test(record.emailHash) &&
        typeof record.tokenHash === "string" && /^[0-9a-f]{64}$/.test(record.tokenHash) &&
        record.role === "tenant_owner" &&
        record.state === "pending" &&
        record.delivery === "firebase_email_link" &&
        createdAt !== null &&
        expiresAt !== null &&
        new Date(expiresAt).getTime() > new Date(createdAt).getTime();
    return Object.freeze({
        exists: true,
        valid,
        state: record.state === "pending" ? "pending" : null,
        delivery: record.delivery === "firebase_email_link" ? "firebase_email_link" : null,
        createdAt,
        expiresAt,
        expired: expiresAt === null ? null : nowMs >= new Date(expiresAt).getTime()
    });
}

function projectEvidence(record, tenantId) {
    if (!record) {
        return Object.freeze({
            exists: false,
            valid: true,
            state: null,
            observedAt: null
        });
    }
    const observedAt = canonicalTimestamp(record.observedAt);
    const validState = ["pending", "verified", "failed"].includes(record.state);
    const valid = hasExactFields(record, EVIDENCE_FIELDS) &&
        record.schemaVersion === 1 &&
        record.tenantId === tenantId &&
        record.kind === "initial_owner" &&
        record.role === "tenant_owner" &&
        record.source === "controlled_external_identity" &&
        validState &&
        observedAt !== null;
    return Object.freeze({
        exists: true,
        valid,
        state: validState ? record.state : null,
        observedAt
    });
}

function projectMember(record, tenantId, subjectRef) {
    if (record === undefined) {
        return Object.freeze({
            checked: false,
            exists: null,
            valid: null,
            role: null,
            state: null,
            matchesOwnerBinding: null
        });
    }
    if (record === null) {
        return Object.freeze({
            checked: true,
            exists: false,
            valid: true,
            role: null,
            state: null,
            matchesOwnerBinding: false
        });
    }
    const validState = ["active", "revoked"].includes(record.state);
    const valid = hasExactFields(record, MEMBER_FIELDS) &&
        record.schemaVersion === 1 &&
        record.tenantId === tenantId &&
        record.subjectRef === subjectRef &&
        record.role === "tenant_owner" &&
        record.source === "firebase_auth" &&
        validState &&
        canonicalTimestamp(record.createdAt) !== null &&
        canonicalTimestamp(record.updatedAt) !== null;
    return Object.freeze({
        checked: true,
        exists: true,
        valid,
        role: record.role === "tenant_owner" ? "tenant_owner" : null,
        state: validState ? record.state : null,
        matchesOwnerBinding: record.subjectRef === subjectRef
    });
}

function createFirestoreInitialOwnerDiagnosticReader({ db, clock = Date.now }) {
    if (!db || typeof db.doc !== "function") fail("db");
    if (typeof clock !== "function") fail("clock");

    return Object.freeze({
        async read({ tenantId: rawTenantId } = {}) {
            const tenantId = canonicalTenantId(rawTenantId);
            const nowMs = Number(clock());
            if (!Number.isFinite(nowMs)) fail("clock result");

            const ownerRef = db.doc(tenantSettingsDocument(
                tenantId,
                INITIAL_OWNER_BINDING_SETTING_ID
            ));
            const inviteRef = db.doc(tenantSettingsDocument(
                tenantId,
                INITIAL_OWNER_INVITE_SETTING_ID
            ));
            const evidenceRef = db.doc(tenantSettingsDocument(
                tenantId,
                ADMIN_BOOTSTRAP_EVIDENCE_SETTING_ID
            ));
            const [ownerSnapshot, inviteSnapshot, evidenceSnapshot] = await Promise.all([
                ownerRef.get(),
                inviteRef.get(),
                evidenceRef.get()
            ]);
            const ownerRecord = snapshotRecord(ownerSnapshot);
            const inviteRecord = snapshotRecord(inviteSnapshot);
            const evidenceRecord = snapshotRecord(evidenceSnapshot);

            let memberRecord;
            const subjectRef = typeof ownerRecord?.subjectRef === "string" &&
                SUBJECT_REF_PATTERN.test(ownerRecord.subjectRef)
                ? ownerRecord.subjectRef
                : null;
            if (subjectRef) {
                const memberRef = db.doc(tenantDocument(
                    tenantId,
                    TENANT_COLLECTIONS.members,
                    subjectRef
                ));
                memberRecord = snapshotRecord(await memberRef.get());
            }

            return Object.freeze({
                tenantId,
                ownerBinding: projectOwnerSlot(ownerRecord, tenantId),
                invite: projectInvite(inviteRecord, tenantId, nowMs),
                evidence: projectEvidence(evidenceRecord, tenantId),
                member: projectMember(memberRecord, tenantId, subjectRef)
            });
        }
    });
}

module.exports = {
    createFirestoreInitialOwnerDiagnosticReader
};
