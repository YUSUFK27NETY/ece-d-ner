const { requireTenantId } = require("../tenant/tenant-id");

const SECURITY_REVIEW_SOURCE = "controlled_external_security_review";
const SECURITY_REVIEW_STATES = Object.freeze([
    "pending",
    "verified",
    "failed"
]);
const SECURITY_REVIEW_FIELDS = Object.freeze([
    "schemaVersion",
    "tenantId",
    "reviewKind",
    "source",
    "state",
    "observedAt"
]);
const SECURITY_READINESS_ALERT_LIMIT = 200;
const SECURITY_ALERT_SEVERITIES = Object.freeze([
    "info",
    "warning",
    "high",
    "critical"
]);
const INTERNAL_SECURITY_READ_CONTEXT = Object.freeze({
    role: "platform_admin"
});

function fail(label) {
    throw new TypeError(`Security readiness ${label} geçersiz.`);
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
        source: "security",
        tenantId,
        status,
        code,
        observedAt
    });
}

function normalizeMethodDependency(dependency, method, label) {
    if (!isPlainRecord(dependency)) {
        return null;
    }

    const field = readOwn(dependency, method);
    if (!field.exists || !field.safe || typeof field.value !== "function") {
        return null;
    }

    return field.value.bind(dependency);
}

function projectReviewEvidence(evidence, tenantId) {
    if (!isPlainRecord(evidence)) {
        fail("review evidence");
    }

    const keys = Reflect.ownKeys(evidence);
    if (keys.length !== SECURITY_REVIEW_FIELDS.length ||
        keys.some(key => typeof key !== "string" ||
            !SECURITY_REVIEW_FIELDS.includes(key))) {
        fail("review evidence fields");
    }

    const values = Object.fromEntries(
        SECURITY_REVIEW_FIELDS.map(key => {
            const field = readOwn(evidence, key);
            if (!field.exists || !field.safe) {
                fail("review evidence field");
            }
            return [key, field.value];
        })
    );

    if (values.schemaVersion !== 1 ||
        requireCanonicalTenantId(values.tenantId) !== tenantId ||
        values.reviewKind !== "launch_security_review" ||
        values.source !== SECURITY_REVIEW_SOURCE ||
        !SECURITY_REVIEW_STATES.includes(values.state)) {
        fail("review evidence");
    }

    const observedAt = canonicalTimestamp(values.observedAt);
    if (!observedAt) {
        fail("review evidence timestamp");
    }

    return Object.freeze({
        state: values.state,
        observedAt
    });
}

function requireSafeAlerts(alerts, tenantId, reviewedAt) {
    if (!Array.isArray(alerts) ||
        Object.getPrototypeOf(alerts) !== Array.prototype ||
        alerts.length > SECURITY_READINESS_ALERT_LIMIT) {
        fail("alert list");
    }

    const reviewedAtMs = Date.parse(reviewedAt);
    let blockingAt = null;
    let warningAt = null;

    for (let index = 0; index < alerts.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(alerts, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail("alert list item");
        }
        const alert = descriptor.value;
        if (!isPlainRecord(alert)) {
            fail("alert");
        }

        const alertTenantId = readOwn(alert, "tenantId");
        const severity = readOwn(alert, "severity");
        const lastSeenAt = readOwn(alert, "lastSeenAt");
        if (!alertTenantId.exists || !alertTenantId.safe ||
            !severity.exists || !severity.safe ||
            !lastSeenAt.exists || !lastSeenAt.safe ||
            requireCanonicalTenantId(alertTenantId.value) !== tenantId ||
            !SECURITY_ALERT_SEVERITIES.includes(severity.value)) {
            fail("alert projection");
        }

        const observedAt = canonicalTimestamp(lastSeenAt.value);
        if (!observedAt) {
            fail("alert timestamp");
        }
        if (Date.parse(observedAt) < reviewedAtMs) {
            continue;
        }

        if (["high", "critical"].includes(severity.value)) {
            if (blockingAt === null || observedAt > blockingAt) {
                blockingAt = observedAt;
            }
        } else if (severity.value === "warning") {
            if (warningAt === null || observedAt > warningAt) {
                warningAt = observedAt;
            }
        }
    }

    return Object.freeze({
        blockingAt,
        warningAt,
        truncated: alerts.length === SECURITY_READINESS_ALERT_LIMIT
    });
}

function createSecurityReadinessAdapter({
    reviewEvidenceProvider = null,
    securityAlertReader = null
} = {}) {
    const getReview = normalizeMethodDependency(
        reviewEvidenceProvider,
        "getStatus",
        "review evidence provider"
    );
    const listAlerts = normalizeMethodDependency(
        securityAlertReader,
        "list",
        "security alert reader"
    );

    return Object.freeze({
        async evaluate(input) {
            const tenantId = requireInputTenant(input);
            if (!getReview) {
                fail("review evidence provider");
            }

            const rawEvidence = await getReview(Object.freeze({ tenantId }));
            if (rawEvidence === null) {
                return readinessResult({
                    tenantId,
                    status: "pending",
                    code: "SECURITY_REVIEW_PENDING",
                    observedAt: null
                });
            }

            const review = projectReviewEvidence(rawEvidence, tenantId);
            if (review.state === "failed") {
                return readinessResult({
                    tenantId,
                    status: "blocked",
                    code: "SECURITY_BLOCKED",
                    observedAt: review.observedAt
                });
            }
            if (review.state === "pending") {
                return readinessResult({
                    tenantId,
                    status: "pending",
                    code: "SECURITY_REVIEW_PENDING",
                    observedAt: review.observedAt
                });
            }
            if (!listAlerts) {
                fail("security alert reader");
            }

            const alerts = await listAlerts(Object.freeze({
                context: INTERNAL_SECURITY_READ_CONTEXT,
                tenantId,
                limit: SECURITY_READINESS_ALERT_LIMIT
            }));
            const alertState = requireSafeAlerts(
                alerts,
                tenantId,
                review.observedAt
            );

            if (alertState.blockingAt !== null) {
                return readinessResult({
                    tenantId,
                    status: "blocked",
                    code: "SECURITY_BLOCKED",
                    observedAt: alertState.blockingAt
                });
            }
            if (alertState.truncated) {
                fail("alert visibility");
            }
            if (alertState.warningAt !== null) {
                return readinessResult({
                    tenantId,
                    status: "pending",
                    code: "SECURITY_REVIEW_PENDING",
                    observedAt: alertState.warningAt
                });
            }

            return readinessResult({
                tenantId,
                status: "ready",
                code: null,
                observedAt: review.observedAt
            });
        }
    });
}

function addSecurityReadinessSource({
    sourceAdapters,
    reviewEvidenceProvider,
    securityAlertReader
} = {}) {
    if (!isPlainRecord(sourceAdapters) ||
        Object.hasOwn(sourceAdapters, "security")) {
        fail("source adapters");
    }

    return Object.freeze({
        ...sourceAdapters,
        security: createSecurityReadinessAdapter({
            reviewEvidenceProvider,
            securityAlertReader
        })
    });
}

module.exports = {
    SECURITY_READINESS_ALERT_LIMIT,
    SECURITY_REVIEW_FIELDS,
    SECURITY_REVIEW_SOURCE,
    SECURITY_REVIEW_STATES,
    addSecurityReadinessSource,
    createSecurityReadinessAdapter
};
