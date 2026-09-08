const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");

const DOMAIN_READINESS_STATES = Object.freeze([
    "not_configured",
    "pending",
    "verified",
    "failed",
    "unavailable"
]);
const EVIDENCE_STATES = Object.freeze([
    "pending",
    "verified",
    "failed",
    "unavailable"
]);
const issuedDomainReadiness = new WeakSet();

function fail(label) {
    throw new TypeError(`Domain readiness ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function readOwn(record, key, label) {
    if (!record || typeof record !== "object") {
        fail(label);
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail(label);
    }

    return descriptor.value;
}

function requireCanonicalTenantId(value, label) {
    if (typeof value !== "string") {
        fail(label);
    }

    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail(label);
    }

    return tenantId;
}

function requireCanonicalDomain(value, label) {
    if (typeof value !== "string") {
        fail(label);
    }

    let domain;
    try {
        domain = normalizeDomain(value);
    } catch {
        fail(label);
    }
    if (domain === null || domain !== value) {
        fail(label);
    }

    return domain;
}

function canonicalTimestamp(value, evaluatedAtMs) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 &&
        timestamp <= evaluatedAtMs &&
        new Date(timestamp).toISOString() === value
        ? value
        : null;
}

function assertExactRequest(input) {
    if (!isPlainRecord(input)) {
        fail("request");
    }

    const allowed = ["tenantId", "tenant"];
    const keys = Reflect.ownKeys(input);
    if (keys.length !== allowed.length || keys.some(key =>
        typeof key !== "string" || !allowed.includes(key))) {
        fail("request");
    }
    for (const key of keys) {
        readOwn(input, key, "request");
    }

    return input;
}

function readTenantDomain(tenant, expectedTenantId) {
    if (!isPlainRecord(tenant)) {
        fail("tenant");
    }

    const tenantId = requireCanonicalTenantId(
        readOwn(tenant, "tenantId", "tenant tenantId"),
        "tenant tenantId"
    );
    if (tenantId !== expectedTenantId) {
        const error = new Error("Domain readiness tenant kapsamı eşleşmiyor.");
        error.code = "TENANT_SCOPE_MISMATCH";
        throw error;
    }

    const profile = readOwn(tenant, "profile", "tenant profile");
    if (!isPlainRecord(profile)) {
        fail("tenant profile");
    }
    const customDomain = readOwn(
        profile,
        "customDomain",
        "tenant customDomain"
    );
    if (customDomain === null) {
        return null;
    }

    return requireCanonicalDomain(customDomain, "tenant customDomain");
}

function normalizeEvidenceProvider(evidenceProvider) {
    if (evidenceProvider === null || evidenceProvider === undefined) {
        return null;
    }
    if (!isPlainRecord(evidenceProvider)) {
        fail("evidence provider");
    }

    const getStatus = readOwn(
        evidenceProvider,
        "getStatus",
        "evidence provider"
    );
    if (typeof getStatus !== "function") {
        fail("evidence provider");
    }

    return Object.freeze({ getStatus: getStatus.bind(evidenceProvider) });
}

function issueDomainReadiness({ tenantId, domain, state, observedAt }) {
    const readiness = Object.freeze({
        schemaVersion: 1,
        tenantId,
        domain,
        state,
        observedAt
    });
    issuedDomainReadiness.add(readiness);
    return readiness;
}

function unavailable(tenantId, domain) {
    return issueDomainReadiness({
        tenantId,
        domain,
        state: "unavailable",
        observedAt: null
    });
}

function projectEvidence(evidence, tenantId, domain, evaluatedAtMs) {
    if (!isPlainRecord(evidence)) {
        fail("evidence");
    }

    const evidenceTenantId = requireCanonicalTenantId(
        readOwn(evidence, "tenantId", "evidence tenantId"),
        "evidence tenantId"
    );
    const evidenceDomain = requireCanonicalDomain(
        readOwn(evidence, "domain", "evidence domain"),
        "evidence domain"
    );
    if (evidenceTenantId !== tenantId || evidenceDomain !== domain) {
        fail("evidence scope");
    }

    const state = readOwn(evidence, "state", "evidence state");
    const observedAt = canonicalTimestamp(
        readOwn(evidence, "observedAt", "evidence observedAt"),
        evaluatedAtMs
    );
    if (!EVIDENCE_STATES.includes(state) || observedAt === null) {
        fail("evidence");
    }

    return issueDomainReadiness({
        tenantId,
        domain,
        state,
        observedAt
    });
}

function assertDomainReadiness(readiness) {
    if (!readiness || typeof readiness !== "object" ||
        !issuedDomainReadiness.has(readiness)) {
        fail("read model");
    }

    return readiness;
}

function createDomainReadinessService({
    evidenceProvider = null,
    clock = Date.now
} = {}) {
    const provider = normalizeEvidenceProvider(evidenceProvider);
    if (typeof clock !== "function") {
        fail("clock");
    }

    return Object.freeze({
        async evaluate(input) {
            const request = assertExactRequest(input);
            const tenantId = requireCanonicalTenantId(
                readOwn(request, "tenantId", "tenantId"),
                "tenantId"
            );
            const domain = readTenantDomain(
                readOwn(request, "tenant", "tenant"),
                tenantId
            );

            if (domain === null) {
                return issueDomainReadiness({
                    tenantId,
                    domain: null,
                    state: "not_configured",
                    observedAt: null
                });
            }
            if (provider === null) {
                return unavailable(tenantId, domain);
            }

            try {
                const evidence = await provider.getStatus(
                    Object.freeze({ tenantId, domain })
                );
                const evaluatedAtMs = clock();
                if (!Number.isSafeInteger(evaluatedAtMs) || evaluatedAtMs <= 0 ||
                    evaluatedAtMs > 8_640_000_000_000_000) {
                    fail("clock");
                }
                return projectEvidence(
                    evidence,
                    tenantId,
                    domain,
                    evaluatedAtMs
                );
            } catch {
                return unavailable(tenantId, domain);
            }
        }
    });
}

module.exports = {
    DOMAIN_READINESS_STATES,
    assertDomainReadiness,
    createDomainReadinessService
};
