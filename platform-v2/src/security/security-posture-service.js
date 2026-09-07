const {
    DEFAULT_PLATFORM_STEP_UP_CONFIG,
    normalizePlatformStepUpConfig
} = require("../config/platform-step-up-config");

const SECURITY_POSTURE_SCHEMA_VERSION = 1;
const SECURITY_POSTURE_ALERT_LIMIT = 20;
const SECURITY_POSTURE_SOURCE_STATES = Object.freeze([
    "active",
    "contract_only",
    "not_wired",
    "external_verification_required",
    "unavailable"
]);
const SECURITY_POSTURE_OVERALL_STATUSES = Object.freeze([
    "partial_visibility",
    "degraded"
]);
const SECURITY_POSTURE_SEVERITIES = Object.freeze([
    "info",
    "warning",
    "high",
    "critical"
]);
const REPOSITORY_SUPPLY_CHAIN_BASELINE = Object.freeze({
    sbomBaseline: "configured",
    codeqlBaseline: "configured"
});
const issuedPostures = new WeakSet();

function fail(label) {
    throw new TypeError(`Security posture ${label} geçersiz.`);
}

function requireOwnValue(record, key, label) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);

    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail(label);
    }

    return descriptor.value;
}

function requireCanonicalTimestamp(value, { maximumMs = null } = {}) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;

    if (!Number.isFinite(timestamp) || timestamp <= 0 ||
        new Date(timestamp).toISOString() !== value ||
        (maximumMs !== null && timestamp > maximumMs)) {
        fail("alert timestamp");
    }

    return value;
}

function normalizePlatformContext(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).some(key => typeof key !== "string" ||
            !["role", "actorId"].includes(key))) {
        fail("context");
    }

    const role = requireOwnValue(input, "role", "context");
    const actorId = requireOwnValue(input, "actorId", "context");
    if (role !== "platform_admin" || typeof actorId !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(actorId) || /^\d{7,15}$/.test(actorId)) {
        fail("context");
    }

    return Object.freeze({ role, actorId });
}

function normalizeSupplyChainBaseline(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).some(key => typeof key !== "string" ||
            !["sbomBaseline", "codeqlBaseline"].includes(key))) {
        fail("supply-chain baseline");
    }

    const sbomBaseline = requireOwnValue(input, "sbomBaseline", "supply-chain baseline");
    const codeqlBaseline = requireOwnValue(input, "codeqlBaseline", "supply-chain baseline");
    if (sbomBaseline !== "configured" ||
        !["configured", "not_detected"].includes(codeqlBaseline)) {
        fail("supply-chain baseline");
    }

    return Object.freeze({ sbomBaseline, codeqlBaseline });
}

function normalizeAlertList(input, nowMs) {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype ||
        input.length > SECURITY_POSTURE_ALERT_LIMIT) {
        fail("alert source");
    }

    let highestSeverity = null;
    let lastSeenAt = null;

    for (let index = 0; index < input.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("alert source");
        const alert = descriptor.value;
        if (!alert || typeof alert !== "object" || Array.isArray(alert) ||
            Object.getPrototypeOf(alert) !== Object.prototype) {
            fail("alert source");
        }

        const tenantId = requireOwnValue(alert, "tenantId", "alert source");
        const severity = requireOwnValue(alert, "severity", "alert source");
        const seenAt = requireCanonicalTimestamp(
            requireOwnValue(alert, "lastSeenAt", "alert source"),
            { maximumMs: nowMs }
        );
        if (tenantId !== null || !SECURITY_POSTURE_SEVERITIES.includes(severity)) {
            fail("alert source");
        }

        if (highestSeverity === null ||
            SECURITY_POSTURE_SEVERITIES.indexOf(severity) >
            SECURITY_POSTURE_SEVERITIES.indexOf(highestSeverity)) {
            highestSeverity = severity;
        }
        if (lastSeenAt === null || seenAt > lastSeenAt) lastSeenAt = seenAt;
    }

    return Object.freeze({
        sourceState: "active",
        recentVisibleCount: input.length,
        highestSeverity,
        lastSeenAt
    });
}

function unavailableAlerts() {
    return Object.freeze({
        sourceState: "unavailable",
        recentVisibleCount: null,
        highestSeverity: null,
        lastSeenAt: null
    });
}

function createSecurityPostureService({
    securityAlertReader = null,
    stepUpConfig = DEFAULT_PLATFORM_STEP_UP_CONFIG,
    supplyChainBaseline = REPOSITORY_SUPPLY_CHAIN_BASELINE,
    clock = Date.now
} = {}) {
    if (securityAlertReader !== null && typeof securityAlertReader?.list !== "function") {
        fail("alert reader");
    }
    if (typeof clock !== "function") fail("clock");

    const policy = normalizePlatformStepUpConfig(stepUpConfig);
    const repositoryBaseline = normalizeSupplyChainBaseline(supplyChainBaseline);
    let lastClockMs = 0;

    function now() {
        const value = clock();
        if (!Number.isSafeInteger(value) || value <= 0 ||
            value > 8_640_000_000_000_000 || value < lastClockMs) {
            fail("clock");
        }
        lastClockMs = value;
        return value;
    }

    async function loadAlerts(context, generatedAtMs) {
        if (!securityAlertReader) return unavailableAlerts();

        try {
            const alerts = await securityAlertReader.list({
                context,
                tenantId: null,
                limit: SECURITY_POSTURE_ALERT_LIMIT
            });
            return normalizeAlertList(alerts, generatedAtMs);
        } catch {
            console.error("Security posture alert kaynağı kullanılamadı.");
            return unavailableAlerts();
        }
    }

    return Object.freeze({
        async getPlatformPosture(input) {
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                Object.getPrototypeOf(input) !== Object.prototype ||
                Reflect.ownKeys(input).some(key => key !== "context")) {
                fail("request");
            }

            const context = normalizePlatformContext(
                requireOwnValue(input, "context", "request")
            );
            const generatedAtMs = now();
            const alerts = await loadAlerts(context, generatedAtMs);

            const posture = Object.freeze({
                schemaVersion: SECURITY_POSTURE_SCHEMA_VERSION,
                generatedAt: new Date(generatedAtMs).toISOString(),
                overallStatus: alerts.sourceState === "active"
                    ? "partial_visibility"
                    : "degraded",
                identity: Object.freeze({
                    sourceState: "contract_only",
                    contractStatus: "ready",
                    runtimeEnforcement: "not_wired",
                    elevatedSessionStatus: "unavailable",
                    mfaReadiness: "contract_ready",
                    enrollmentStatus: "unavailable",
                    elevatedSessionTtlMs: policy.elevatedSessionTtlMs,
                    requiredFactorTypeCount: policy.requiredFactorTypes.length
                }),
                secrets: Object.freeze({
                    sourceState: "contract_only",
                    health: "unavailable",
                    count: null,
                    healthy: null,
                    due: null,
                    overdue: null,
                    disabled: null,
                    unknown: null
                }),
                alerts,
                incidents: Object.freeze({
                    sourceState: "contract_only",
                    openCount: null,
                    criticalCount: null,
                    lastUpdatedAt: null
                }),
                breakGlass: Object.freeze({
                    sourceState: "contract_only",
                    activeSessions: null,
                    recentUsageCount: null,
                    lastUsedAt: null
                }),
                supplyChain: Object.freeze({
                    sourceState: "external_verification_required",
                    sbomBaseline: repositoryBaseline.sbomBaseline,
                    codeqlBaseline: repositoryBaseline.codeqlBaseline,
                    liveWorkflowStatus: "external_verification_required"
                })
            });
            issuedPostures.add(posture);
            return posture;
        }
    });
}

function assertSecurityPosture(posture) {
    if (!posture || typeof posture !== "object" || !issuedPostures.has(posture)) {
        fail("read model");
    }
    return posture;
}

module.exports = {
    REPOSITORY_SUPPLY_CHAIN_BASELINE,
    SECURITY_POSTURE_ALERT_LIMIT,
    SECURITY_POSTURE_OVERALL_STATUSES,
    SECURITY_POSTURE_SCHEMA_VERSION,
    SECURITY_POSTURE_SOURCE_STATES,
    assertSecurityPosture,
    createSecurityPostureService
};
