const { requireTenantId } = require("../tenant/tenant-id");
const { tenantSettingsDocument } = require("./tenant-paths");

const SECURITY_REVIEW_EVIDENCE_SETTING_ID = "security-launch-readiness";
const EVIDENCE_FIELDS = Object.freeze([
    "schemaVersion",
    "tenantId",
    "reviewKind",
    "source",
    "state",
    "observedAt"
]);

function fail(label) {
    throw new TypeError(
        `Firestore security review evidence ${label} geçersiz.`
    );
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

    const keys = Reflect.ownKeys(record);
    if (keys.length !== EVIDENCE_FIELDS.length ||
        keys.some(key => typeof key !== "string" ||
            !EVIDENCE_FIELDS.includes(key))) {
        fail("record fields");
    }

    const output = {};
    for (const key of EVIDENCE_FIELDS) {
        output[key] = readOwn(record, key);
    }
    if (requireCanonicalTenantId(output.tenantId) !== tenantId) {
        fail("tenant scope");
    }

    return Object.freeze(output);
}

function createFirestoreSecurityReviewEvidenceProvider({ db }) {
    if (!db || typeof db.doc !== "function") {
        fail("db");
    }

    return Object.freeze({
        async getStatus(input) {
            if (!isPlainRecord(input) ||
                Reflect.ownKeys(input).length !== 1) {
                fail("request");
            }

            const tenantId = requireCanonicalTenantId(
                readOwn(input, "tenantId")
            );
            const ref = db.doc(tenantSettingsDocument(
                tenantId,
                SECURITY_REVIEW_EVIDENCE_SETTING_ID
            ));
            if (!ref || typeof ref.get !== "function") {
                fail("document");
            }

            const snapshot = await ref.get();
            if (!snapshot || typeof snapshot.exists !== "boolean") {
                fail("snapshot");
            }
            if (!snapshot.exists) {
                return null;
            }
            if (typeof snapshot.data !== "function") {
                fail("snapshot data");
            }

            return projectRecord(snapshot.data(), tenantId);
        }
    });
}

module.exports = {
    SECURITY_REVIEW_EVIDENCE_SETTING_ID,
    createFirestoreSecurityReviewEvidenceProvider
};
