const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    tenantCollection,
    tenantSettingsDocument,
    TENANT_COLLECTIONS
} = require("./tenant-paths");
const {
    DEFAULT_TENANT_REGISTRY_COLLECTION
} = require("./firestore-tenant-registry");
const {
    SECURITY_REVIEW_EVIDENCE_SETTING_ID
} = require("./firestore-security-review-evidence-provider");

const EVIDENCE_FIELDS = Object.freeze([
    "schemaVersion",
    "tenantId",
    "reviewKind",
    "source",
    "state",
    "observedAt"
]);
const AUDIT_EVENT_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function fail(label) {
    throw new TypeError(`Security review evidence writer ${label} geçersiz.`);
}

function conflict() {
    const error = new Error("Launch security review zaten kayıtlı.");
    error.code = "SECURITY_REVIEW_ALREADY_RECORDED";
    return error;
}

function stateChanged() {
    const error = new Error("Tenant durumu security review sırasında değişti.");
    error.code = "SECURITY_REVIEW_STATE_CHANGED";
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

function requireExactKeys(record, fields, label) {
    if (!isPlainRecord(record)) fail(label);
    const keys = Reflect.ownKeys(record);
    if (keys.length !== fields.length ||
        keys.some(key => typeof key !== "string" || !fields.includes(key))) {
        fail(`${label} fields`);
    }
    return record;
}

function requireCanonicalTimestamp(value, label) {
    if (typeof value !== "string") fail(label);
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.toISOString() !== value) fail(label);
    return value;
}

function validateEvidence(evidence) {
    requireExactKeys(evidence, EVIDENCE_FIELDS, "evidence");
    const tenantId = requireCanonicalTenantId(evidence.tenantId);
    if (evidence.schemaVersion !== 1 ||
        evidence.reviewKind !== "launch_security_review" ||
        evidence.source !== "controlled_external_security_review" ||
        evidence.state !== "verified") {
        fail("evidence");
    }
    requireCanonicalTimestamp(evidence.observedAt, "observedAt");
    return Object.freeze({ tenantId, evidence: Object.freeze({ ...evidence }) });
}

function validateAuditEvent(auditEvent, tenantId) {
    if (!isPlainRecord(auditEvent) || auditEvent.tenantId !== tenantId ||
        typeof auditEvent.eventId !== "string" ||
        !AUDIT_EVENT_ID_PATTERN.test(auditEvent.eventId) ||
        auditEvent.action !== "tenant.security_launch_review.verified") {
        fail("audit event");
    }
    return auditEvent;
}

function createFirestoreSecurityReviewEvidenceWriter({
    db,
    tenantRegistryCollection = DEFAULT_TENANT_REGISTRY_COLLECTION
}) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") {
        fail("db");
    }
    const collectionName = String(tenantRegistryCollection ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(collectionName)) {
        fail("tenant registry collection");
    }
    const tenantRegistry = db.collection(collectionName);

    return Object.freeze({
        async commitVerifiedReview(input = {}) {
            if (!isPlainRecord(input) ||
                Reflect.ownKeys(input).some(key => typeof key !== "string" ||
                    !["expectedTenant", "evidence", "auditEvent"].includes(key)) ||
                !Object.hasOwn(input, "expectedTenant") ||
                !Object.hasOwn(input, "evidence") ||
                !Object.hasOwn(input, "auditEvent")) {
                fail("request");
            }

            const { tenantId, evidence } = validateEvidence(input.evidence);
            validateAuditEvent(input.auditEvent, tenantId);
            if (!isPlainRecord(input.expectedTenant) ||
                input.expectedTenant.id !== tenantId ||
                input.expectedTenant.tenantId !== tenantId ||
                input.expectedTenant.status !== "provisioning") {
                fail("expected tenant");
            }

            const tenantRef = tenantRegistry.doc(tenantId);
            const evidenceRef = db.doc(tenantSettingsDocument(
                tenantId,
                SECURITY_REVIEW_EVIDENCE_SETTING_ID
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
                if (!evidenceSnapshot ||
                    typeof evidenceSnapshot.exists !== "boolean") {
                    fail("transaction snapshot");
                }
                if (evidenceSnapshot.exists) throw conflict();

                transaction.create(evidenceRef, { ...evidence });
                transaction.create(auditRef, { ...input.auditEvent });
                return evidence;
            });
        }
    });
}

module.exports = {
    createFirestoreSecurityReviewEvidenceWriter
};
