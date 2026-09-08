const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    SECURITY_EVENT_OPERATIONS,
    SECURITY_EVENT_REASON_CODES,
    SECURITY_EVENT_SEVERITIES,
    SECURITY_EVENT_SOURCES,
    assertSecurityAlert,
    optionalOpaqueId,
    optionalTenantId
} = require("../security/security-alert-model");

const SECURITY_ALERTS_COLLECTION = "securityAlerts";
const PLATFORM_SECURITY_ALERTS_COLLECTION = "platformSecurityAlerts";
const ALERT_ID_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REPEATED_EVENT_TYPES = new Set(["repeated_401", "repeated_403"]);
const SEVERITY_ORDER = Object.freeze(["info", "warning", "high", "critical"]);

function fail(label) {
    throw new TypeError(`Firestore security alert ${label} geçersiz.`);
}

function requireOwnValue(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);

    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail("persisted record");
    }

    return descriptor.value;
}

function requireAlertId(value) {
    if (typeof value !== "string" || !ALERT_ID_PATTERN.test(value)) {
        fail("alertId");
    }

    return value;
}

function requireCanonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;

    if (!Number.isFinite(timestamp) || timestamp <= 0 ||
        new Date(timestamp).toISOString() !== value) {
        fail("timestamp");
    }

    return value;
}

function requireCount(value, { zeroAllowed = false } = {}) {
    if (!Number.isSafeInteger(value) || value < (zeroAllowed ? 0 : 1)) {
        fail("count");
    }

    return value;
}

function requirePersistedTenantId(value) {
    if (value === null) return null;
    if (typeof value !== "string" || optionalTenantId(value) !== value) {
        fail("tenantId");
    }
    return value;
}

function optionalPersistedUuid(value) {
    if (value === null) return null;
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        fail("correlation identifier");
    }
    return value;
}

function optionalPersistedOpaqueId(value) {
    if (value === null) return null;
    if (value === undefined) fail("actorId");
    return optionalOpaqueId(value);
}

function requirePersistedAlertSeverity(eventType, severity) {
    const baseSeverity = SECURITY_EVENT_SEVERITIES[eventType];
    const allowed = REPEATED_EVENT_TYPES.has(eventType)
        ? new Set([baseSeverity, "high"])
        : new Set([baseSeverity]);

    if (!allowed.has(severity)) {
        fail("severity");
    }

    return severity;
}

function projectIssuedAlert(alert) {
    assertSecurityAlert(alert);

    return Object.freeze({
        schemaVersion: alert.schemaVersion,
        alertId: alert.alertId,
        dedupeKey: alert.dedupeKey,
        eventType: alert.eventType,
        severity: alert.severity,
        tenantId: alert.tenantId,
        actorId: alert.actorId,
        requestId: alert.requestId,
        correlationId: alert.correlationId,
        source: alert.source,
        occurredAt: alert.occurredAt,
        reasonCode: alert.reasonCode,
        operation: alert.operation,
        eventCount: alert.eventCount,
        duplicateCount: alert.duplicateCount,
        rollingCount: alert.rollingCount,
        firstSeenAt: alert.firstSeenAt,
        lastSeenAt: alert.lastSeenAt
    });
}

function projectPersistedAlert(record, { documentId, tenantId }) {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        Object.getPrototypeOf(record) !== Object.prototype) {
        fail("persisted record");
    }

    const schemaVersion = requireOwnValue(record, "schemaVersion");
    if (schemaVersion !== 1) fail("schemaVersion");

    const alertId = requireAlertId(requireOwnValue(record, "alertId"));
    const dedupeKey = requireAlertId(requireOwnValue(record, "dedupeKey"));
    if (alertId !== dedupeKey || alertId !== requireAlertId(documentId)) {
        fail("document binding");
    }

    const eventType = requireOwnValue(record, "eventType");
    if (typeof eventType !== "string" || !Object.hasOwn(SECURITY_EVENT_SEVERITIES, eventType)) {
        fail("eventType");
    }
    const severity = requirePersistedAlertSeverity(
        eventType,
        requireOwnValue(record, "severity")
    );
    const persistedTenantId = requirePersistedTenantId(requireOwnValue(record, "tenantId"));
    if (persistedTenantId !== tenantId) fail("tenant scope");

    const actorId = optionalPersistedOpaqueId(requireOwnValue(record, "actorId"));
    const requestId = optionalPersistedUuid(requireOwnValue(record, "requestId"));
    const correlationId = optionalPersistedUuid(requireOwnValue(record, "correlationId"));
    if (correlationId === null) fail("correlationId");

    const source = requireOwnValue(record, "source");
    if (!SECURITY_EVENT_SOURCES.includes(source)) fail("source");
    const reasonCode = requireOwnValue(record, "reasonCode");
    if (!SECURITY_EVENT_REASON_CODES.includes(reasonCode)) fail("reasonCode");
    const operation = requireOwnValue(record, "operation");
    if (operation !== null && !SECURITY_EVENT_OPERATIONS.includes(operation)) fail("operation");

    const eventCount = requireCount(requireOwnValue(record, "eventCount"));
    const duplicateCount = requireCount(
        requireOwnValue(record, "duplicateCount"),
        { zeroAllowed: true }
    );
    const rollingCount = requireCount(requireOwnValue(record, "rollingCount"));
    if (duplicateCount !== eventCount - 1 || rollingCount > eventCount) {
        fail("aggregate count");
    }

    const occurredAt = requireCanonicalTimestamp(requireOwnValue(record, "occurredAt"));
    const firstSeenAt = requireCanonicalTimestamp(requireOwnValue(record, "firstSeenAt"));
    const lastSeenAt = requireCanonicalTimestamp(requireOwnValue(record, "lastSeenAt"));
    if (firstSeenAt > occurredAt || occurredAt > lastSeenAt) {
        fail("aggregate timestamp order");
    }

    return Object.freeze({
        schemaVersion,
        alertId,
        dedupeKey,
        eventType,
        severity,
        tenantId: persistedTenantId,
        actorId,
        requestId,
        correlationId,
        source,
        occurredAt,
        reasonCode,
        operation,
        eventCount,
        duplicateCount,
        rollingCount,
        firstSeenAt,
        lastSeenAt
    });
}

function securityAlertDocumentPath(alert) {
    if (!alert || typeof alert !== "object") fail("descriptor");
    const alertId = requireAlertId(alert.alertId);

    if (alert.tenantId === null) {
        return `${PLATFORM_SECURITY_ALERTS_COLLECTION}/${alertId}`;
    }

    if (typeof alert.tenantId !== "string") fail("tenantId");
    const tenantId = requireTenantId(alert.tenantId);
    if (tenantId !== alert.tenantId) fail("tenantId");
    return `tenants/${tenantId}/${SECURITY_ALERTS_COLLECTION}/${alertId}`;
}

function collectionPath(tenantId) {
    return tenantId === null
        ? PLATFORM_SECURITY_ALERTS_COLLECTION
        : `tenants/${tenantId}/${SECURITY_ALERTS_COLLECTION}`;
}

function authorizeList({ context, tenantId, limit }) {
    if (tenantId === undefined) fail("query scope");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail("query limit");

    if (tenantId === null) {
        if (context?.role !== "platform_admin") {
            const error = new Error("Platform security alert yetkisi gerekli.");
            error.code = "PERMISSION_DENIED";
            throw error;
        }
        return null;
    }

    if (typeof tenantId !== "string") fail("query tenant");
    const safeTenantId = requireTenantId(tenantId);
    if (safeTenantId !== tenantId) fail("query tenant");
    authorizeTenantAction({
        context,
        tenantId: safeTenantId,
        permission: "tenant.security.read"
    });
    return safeTenantId;
}

function assertSameAggregateIdentity(current, incoming) {
    for (const key of [
        "schemaVersion", "alertId", "dedupeKey", "eventType", "tenantId",
        "actorId", "correlationId", "source", "reasonCode", "operation"
    ]) {
        if (current[key] !== incoming[key]) fail("aggregate identity");
    }
}

function assertAggregateProgression(current, incoming) {
    if (Date.parse(incoming.firstSeenAt) > Date.parse(current.firstSeenAt) ||
        Date.parse(incoming.lastSeenAt) < Date.parse(current.lastSeenAt) ||
        SEVERITY_ORDER.indexOf(incoming.severity) < SEVERITY_ORDER.indexOf(current.severity)) {
        fail("aggregate progression");
    }
}

function createFirestoreSecurityAlertSink({ db }) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore security alert sink için db gerekli.");
    }

    return Object.freeze({
        async emit(alert) {
            const persisted = projectIssuedAlert(alert);
            const path = securityAlertDocumentPath(persisted);
            const ref = db.doc(path);

            return db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);

                if (snapshot.exists) {
                    let data;
                    try {
                        data = snapshot.data();
                    } catch {
                        fail("persisted record");
                    }
                    const current = projectPersistedAlert(data, {
                        documentId: persisted.alertId,
                        tenantId: persisted.tenantId
                    });
                    assertSameAggregateIdentity(current, persisted);
                    if (current.eventCount >= persisted.eventCount) return current;
                    assertAggregateProgression(current, persisted);
                }

                transaction.set(ref, persisted);
                return persisted;
            });
        },

        async list({ context, tenantId, limit = 20 }) {
            const safeTenantId = authorizeList({ context, tenantId, limit });
            let snapshot;
            try {
                snapshot = await db.collection(collectionPath(safeTenantId))
                    .orderBy("lastSeenAt", "desc")
                    .limit(limit)
                    .get();
            } catch {
                const error = new Error("Firestore security alert sorgusu başarısız.");
                error.code = "SECURITY_ALERT_READ_FAILED";
                throw error;
            }

            if (!snapshot || !Array.isArray(snapshot.docs)) fail("query result");
            const alerts = snapshot.docs.map(document => {
                if (!document || typeof document.data !== "function") fail("document");
                let data;
                try {
                    data = document.data();
                } catch {
                    fail("persisted record");
                }
                return projectPersistedAlert(data, {
                    documentId: document.id,
                    tenantId: safeTenantId
                });
            });

            alerts.sort((left, right) =>
                right.lastSeenAt.localeCompare(left.lastSeenAt) ||
                left.alertId.localeCompare(right.alertId)
            );
            return Object.freeze(alerts);
        }
    });
}

module.exports = {
    PLATFORM_SECURITY_ALERTS_COLLECTION,
    SECURITY_ALERTS_COLLECTION,
    createFirestoreSecurityAlertSink,
    securityAlertDocumentPath
};
