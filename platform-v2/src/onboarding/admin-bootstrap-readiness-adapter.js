const { requireTenantId } = require("../tenant/tenant-id");

const ADMIN_BOOTSTRAP_EVIDENCE_SOURCE = "controlled_external_identity";
const ADMIN_BOOTSTRAP_EVIDENCE_STATES = Object.freeze([
    "pending",
    "verified",
    "failed"
]);
const ADMIN_BOOTSTRAP_EVIDENCE_FIELDS = Object.freeze([
    "schemaVersion",
    "tenantId",
    "kind",
    "role",
    "source",
    "state",
    "observedAt"
]);

function fail(label) {
    throw new TypeError(`Admin bootstrap readiness ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readOwn(record, key) {
    if (!record || typeof record !== "object") {
        return Object.freeze({ exists: false, safe: false, value: undefined });
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return Object.freeze({ exists: false, safe: true, value: undefined });
    }

    return Object.hasOwn(descriptor, "value")
        ? Object.freeze({ exists: true, safe: true, value: descriptor.value })
        : Object.freeze({ exists: true, safe: false, value: undefined });
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

function requireInputTenant(input) {
    if (!isPlainRecord(input)) {
        fail("request");
    }

    const requestTenantId = readOwn(input, "tenantId");
    const tenantField = readOwn(input, "tenant");
    if (!requestTenantId.exists || !requestTenantId.safe ||
        !tenantField.exists || !tenantField.safe ||
        !isPlainRecord(tenantField.value)) {
        fail("request");
    }

    const tenantId = requireCanonicalTenantId(requestTenantId.value);
    const recordTenantId = readOwn(tenantField.value, "tenantId");
    if (!recordTenantId.exists || !recordTenantId.safe ||
        requireCanonicalTenantId(recordTenantId.value) !== tenantId) {
        fail("tenant scope");
    }

    return tenantId;
}

function canonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 &&
        new Date(timestamp).toISOString() === value
        ? value
        : null;
}

function readinessResult({ tenantId, status, code, observedAt }) {
    return Object.freeze({
        source: "adminBootstrap",
        tenantId,
        status,
        code,
        observedAt
    });
}

function normalizeProvider(provider) {
    if (!isPlainRecord(provider)) {
        return null;
    }

    const getStatus = readOwn(provider, "getStatus");
    if (!getStatus.exists || !getStatus.safe ||
        typeof getStatus.value !== "function") {
        return null;
    }

    return getStatus.value.bind(provider);
}

function projectEvidence(evidence, tenantId) {
    if (!isPlainRecord(evidence)) {
        fail("evidence");
    }

    const keys = Reflect.ownKeys(evidence);
    if (keys.length !== ADMIN_BOOTSTRAP_EVIDENCE_FIELDS.length ||
        keys.some(key => typeof key !== "string" ||
            !ADMIN_BOOTSTRAP_EVIDENCE_FIELDS.includes(key))) {
        fail("evidence fields");
    }

    const values = Object.fromEntries(
        ADMIN_BOOTSTRAP_EVIDENCE_FIELDS.map(key => {
            const field = readOwn(evidence, key);
            if (!field.exists || !field.safe) {
                fail("evidence field");
            }
            return [key, field.value];
        })
    );

    if (values.schemaVersion !== 1 ||
        requireCanonicalTenantId(values.tenantId) !== tenantId ||
        values.kind !== "initial_owner" ||
        values.role !== "tenant_owner" ||
        values.source !== ADMIN_BOOTSTRAP_EVIDENCE_SOURCE ||
        !ADMIN_BOOTSTRAP_EVIDENCE_STATES.includes(values.state)) {
        fail("evidence");
    }

    const observedAt = canonicalTimestamp(values.observedAt);
    if (!observedAt) {
        fail("evidence timestamp");
    }

    if (values.state === "verified") {
        return readinessResult({
            tenantId,
            status: "ready",
            code: null,
            observedAt
        });
    }
    if (values.state === "failed") {
        return readinessResult({
            tenantId,
            status: "blocked",
            code: "ADMIN_BOOTSTRAP_BLOCKED",
            observedAt
        });
    }

    return readinessResult({
        tenantId,
        status: "pending",
        code: "ADMIN_BOOTSTRAP_PENDING",
        observedAt
    });
}

function createAdminBootstrapReadinessAdapter({
    evidenceProvider = null
} = {}) {
    const getStatus = normalizeProvider(evidenceProvider);

    return Object.freeze({
        async evaluate(input) {
            const tenantId = requireInputTenant(input);
            if (!getStatus) {
                fail("evidence provider");
            }

            const evidence = await getStatus(Object.freeze({ tenantId }));
            if (evidence === null) {
                return readinessResult({
                    tenantId,
                    status: "pending",
                    code: "ADMIN_BOOTSTRAP_PENDING",
                    observedAt: null
                });
            }

            return projectEvidence(evidence, tenantId);
        }
    });
}

function addAdminBootstrapReadinessSource({
    sourceAdapters,
    evidenceProvider
} = {}) {
    if (!isPlainRecord(sourceAdapters) ||
        Object.hasOwn(sourceAdapters, "adminBootstrap")) {
        fail("source adapters");
    }

    return Object.freeze({
        ...sourceAdapters,
        adminBootstrap: createAdminBootstrapReadinessAdapter({
            evidenceProvider
        })
    });
}

module.exports = {
    ADMIN_BOOTSTRAP_EVIDENCE_FIELDS,
    ADMIN_BOOTSTRAP_EVIDENCE_SOURCE,
    ADMIN_BOOTSTRAP_EVIDENCE_STATES,
    addAdminBootstrapReadinessSource,
    createAdminBootstrapReadinessAdapter
};
