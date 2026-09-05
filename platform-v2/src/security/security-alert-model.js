const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");
const { PLATFORM_ADMIN_OPERATION_RISKS } = require("../auth/platform-admin-step-up");
const { ROLE_PERMISSIONS } = require("../auth/authorize-tenant-action");
const { normalizePlatformSecurityAlertsConfig } = require("../config/platform-security-alerts-config");

const SECURITY_EVENT_SEVERITIES = Object.freeze({
    repeated_401: "warning",
    repeated_403: "warning",
    auth_anomaly: "warning",
    privilege_change: "high",
    tenant_boundary_violation: "high",
    destructive_operation_attempt: "high",
    step_up_denied: "warning",
    suspicious_admin_activity: "warning",
    admin_activity_observed: "info",
    admin_takeover_confirmed: "critical"
});
const SECURITY_EVENT_SOURCES = Object.freeze([
    "platform.admin.auth", "tenant.authorization", "platform.admin.step_up", "platform.audit", "security.monitor"
]);
const SECURITY_EVENT_OPERATIONS = Object.freeze([...new Set([
    ...Object.keys(PLATFORM_ADMIN_OPERATION_RISKS),
    ...Object.values(ROLE_PERMISSIONS).flat().filter(operation => operation !== "*"),
    "platform.admin.auth", "tenant.access", "tenant.profile.read"
])]);
const SECURITY_EVENT_REASON_CODES = Object.freeze([
    "UNSPECIFIED", "AUTHENTICATION_FAILED", "PERMISSION_DENIED", "AUTH_ANOMALY",
    "PRIVILEGE_CHANGED", "TENANT_SCOPE_MISMATCH", "TENANT_BOUNDARY_VIOLATION",
    "DESTRUCTIVE_OPERATION_ATTEMPT", "SUSPICIOUS_ADMIN_ACTIVITY", "ADMIN_ACTIVITY_OBSERVED",
    "ADMIN_TAKEOVER_CONFIRMED", "MISSING_ACTOR", "NOT_PLATFORM_ADMIN", "UNVERIFIED_AUTH",
    "AUTH_TIME_MISSING", "AUTH_TIME_INVALID", "AUTH_EXPIRED", "VERIFIED_FACTOR_REQUIRED",
    "UNKNOWN_OPERATION", "INVALID_CONFIG", "INVALID_OPERATION_POLICY", "INVALID_CLOCK"
]);
const SEVERITIES = Object.freeze(["info", "warning", "high", "critical"]);
const events = new WeakSet();
const alerts = new WeakSet();

function fail(label) {
    throw new TypeError(`Security alert ${label} geçersiz.`);
}

// Inspect descriptors before reading anything; do not invoke user-supplied getters/toJSON.
function assertFlatSecurityInput(input, nestedField = "metadata") {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) fail("input");
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || ["__proto__", "constructor", "prototype"].includes(key)) fail("unsafe key");
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!Object.hasOwn(descriptor, "value")) fail("accessor");
        const value = descriptor.value;
        if (key === nestedField) {
            assertFlatSecurityInput(value, null);
        } else if (value !== null && !["undefined", "string", "number", "boolean"].includes(typeof value)) {
            fail("nested payload");
        }
    }
}

function optionalOpaqueId(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value) || /^\d{7,15}$/.test(value)) fail("actorId");
    return value;
}

function optionalTenantId(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || requireTenantId(value) !== value) fail("tenantId");
    return value;
}

function optionalUuid(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) fail("correlation identifier");
    return value;
}

function requireTimestamp(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 8_640_000_000_000_000) fail("clock");
    return value;
}

function normalizeSecurityEvent(input, { nowMs = Date.now() } = {}) {
    assertFlatSecurityInput(input);
    requireTimestamp(nowMs);
    if (typeof input.eventType !== "string" || !Object.hasOwn(SECURITY_EVENT_SEVERITIES, input.eventType)) fail("event type");
    if (input.severity !== undefined && !SEVERITIES.includes(input.severity)) fail("severity");
    if (!SECURITY_EVENT_SOURCES.includes(input.source)) fail("source");
    const reasonCode = input.reasonCode === undefined ? "UNSPECIFIED" : input.reasonCode;
    if (!SECURITY_EVENT_REASON_CODES.includes(reasonCode)) fail("reason code");
    const operation = input.operation ?? null;
    if (operation !== null && !SECURITY_EVENT_OPERATIONS.includes(operation)) fail("operation");
    const occurredAt = input.occurredAt === undefined ? new Date(nowMs).toISOString() : input.occurredAt;
    const occurredAtMs = typeof occurredAt === "string" ? Date.parse(occurredAt) : NaN;
    if (!Number.isFinite(occurredAtMs) || occurredAtMs <= 0 || occurredAtMs > nowMs ||
        new Date(occurredAtMs).toISOString() !== occurredAt) fail("occurredAt");

    const event = Object.freeze({
        schemaVersion: 1,
        eventType: input.eventType,
        severity: SECURITY_EVENT_SEVERITIES[input.eventType],
        tenantId: optionalTenantId(input.tenantId),
        actorId: optionalOpaqueId(input.actorId),
        requestId: optionalUuid(input.requestId),
        correlationId: optionalUuid(input.correlationId) || crypto.randomUUID(),
        source: input.source,
        occurredAt,
        reasonCode,
        operation
    });
    events.add(event);
    return event;
}

function securityEventScopeKey(event) {
    if (!events.has(event)) fail("normalized event");
    // Structured nulls cannot collide with actual IDs such as 'platform' or 'unknown'.
    return crypto.createHash("sha256").update(JSON.stringify([
        1, event.eventType, event.tenantId, event.actorId, event.source, event.operation, event.reasonCode
    ])).digest("hex");
}

function repeatedPolicy(eventType, config) {
    if (eventType === "repeated_401") return config.repeated401;
    if (eventType === "repeated_403") return config.repeated403;
    return null;
}

function buildSecurityAlert({ event, config, groupStartedAtMs, firstSeenAt, lastSeenAt,
    eventCount, rollingCount, correlationId, previousAlert = null }) {
    if (!events.has(event)) fail("normalized event");
    const policy = normalizePlatformSecurityAlertsConfig(config);
    requireTimestamp(groupStartedAtMs);
    if (![eventCount, rollingCount].every(value => Number.isSafeInteger(value) && value >= 1)) fail("aggregate");
    for (const timestamp of [firstSeenAt, lastSeenAt]) {
        if (typeof timestamp !== "string" || !Number.isFinite(Date.parse(timestamp)) ||
            new Date(timestamp).toISOString() !== timestamp) fail("aggregate time");
    }
    if (Date.parse(firstSeenAt) > Date.parse(lastSeenAt)) fail("aggregate order");
    const dedupeKey = crypto.createHash("sha256").update(JSON.stringify([
        securityEventScopeKey(event), policy.dedupeWindowMs, groupStartedAtMs
    ])).digest("hex");
    if (previousAlert !== null) {
        assertSecurityAlert(previousAlert);
        if (previousAlert.dedupeKey !== dedupeKey || eventCount <= previousAlert.eventCount) fail("previous aggregate");
    }
    const previousSeverity = previousAlert?.severity || "info";
    const repeated = repeatedPolicy(event.eventType, policy);
    if (repeated && rollingCount < repeated.countThreshold && !previousAlert) fail("threshold");
    const baseSeverity = repeated && rollingCount >= repeated.highThreshold ? "high" : event.severity;
    const severity = SEVERITIES[Math.max(SEVERITIES.indexOf(baseSeverity), SEVERITIES.indexOf(previousSeverity))];
    const alert = Object.freeze({
        schemaVersion: 1,
        alertId: dedupeKey,
        dedupeKey,
        eventType: event.eventType,
        severity,
        tenantId: event.tenantId,
        actorId: event.actorId,
        requestId: event.requestId,
        correlationId: previousAlert?.correlationId || optionalUuid(correlationId) || event.correlationId,
        source: event.source,
        occurredAt: event.occurredAt,
        reasonCode: event.reasonCode,
        operation: event.operation,
        eventCount,
        duplicateCount: eventCount - 1,
        rollingCount,
        firstSeenAt,
        lastSeenAt
    });
    alerts.add(alert);
    return alert;
}

function assertSecurityAlert(alert) {
    if (!alerts.has(alert)) fail("issued alert");
    return alert;
}

module.exports = {
    SECURITY_EVENT_SEVERITIES, SECURITY_EVENT_SOURCES, SECURITY_EVENT_OPERATIONS,
    SECURITY_EVENT_REASON_CODES, assertFlatSecurityInput, normalizeSecurityEvent,
    securityEventScopeKey, repeatedPolicy, buildSecurityAlert, assertSecurityAlert,
    optionalTenantId, optionalOpaqueId, requireTimestamp
};
