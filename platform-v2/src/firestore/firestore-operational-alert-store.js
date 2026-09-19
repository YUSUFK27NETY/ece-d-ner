const { requireTenantId } = require("../tenant/tenant-id");
const {
    OPERATIONAL_ALERT_SEVERITIES,
    requireCanonicalTimestamp
} = require("../operations/operational-alert-service");

const OPERATIONAL_ALERTS_COLLECTION = "operationalAlerts";
const ALERT_ID_PATTERN = /^[a-f0-9]{64}$/;

function fail(label) {
    throw new TypeError(`Firestore operational alert ${label} geçersiz.`);
}

function requireAlertId(value) {
    if (typeof value !== "string" || !ALERT_ID_PATTERN.test(value)) fail("alertId");
    return value;
}

function requireOwn(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) fail("persisted record");
    return descriptor.value;
}

function requireStatusCode(value) {
    if (!Number.isSafeInteger(value) || value < 500 || value > 599) fail("statusCode");
    return value;
}

function requireCount(value) {
    if (!Number.isSafeInteger(value) || value < 1) fail("eventCount");
    return value;
}

function requireOperation(value) {
    if (typeof value !== "string" || !/^[a-z0-9][a-z0-9_.:-]{1,119}$/i.test(value)) {
        fail("operation");
    }
    return value;
}

function projectPersistedAlert(record, { documentId, tenantId }) {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        Object.getPrototypeOf(record) !== Object.prototype) {
        fail("persisted record");
    }

    const alertId = requireAlertId(requireOwn(record, "alertId"));
    if (alertId !== requireAlertId(documentId)) fail("document binding");

    const persistedTenantId = requireOwn(record, "tenantId");
    if (typeof persistedTenantId !== "string" ||
        requireTenantId(persistedTenantId) !== persistedTenantId ||
        persistedTenantId !== tenantId) {
        fail("tenant scope");
    }

    const schemaVersion = requireOwn(record, "schemaVersion");
    if (schemaVersion !== 1) fail("schemaVersion");
    const type = requireOwn(record, "type");
    if (type !== "server_error") fail("type");
    const severity = requireOwn(record, "severity");
    if (!OPERATIONAL_ALERT_SEVERITIES.includes(severity)) fail("severity");
    const operation = requireOperation(requireOwn(record, "operation"));
    const statusCode = requireStatusCode(requireOwn(record, "statusCode"));
    const eventCount = requireCount(requireOwn(record, "eventCount"));
    const firstSeenAt = requireOwn(record, "firstSeenAt");
    const lastSeenAt = requireOwn(record, "lastSeenAt");
    const windowStartedAt = requireOwn(record, "windowStartedAt");
    requireCanonicalTimestamp(firstSeenAt);
    requireCanonicalTimestamp(lastSeenAt);
    requireCanonicalTimestamp(windowStartedAt);
    if (firstSeenAt > lastSeenAt || windowStartedAt > firstSeenAt) fail("timestamp order");

    return Object.freeze({
        schemaVersion,
        alertId,
        tenantId: persistedTenantId,
        type,
        severity,
        operation,
        statusCode,
        eventCount,
        firstSeenAt,
        lastSeenAt,
        windowStartedAt
    });
}

function createFirestoreOperationalAlertStore({ db }) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore operational alert store için db gerekli.");
    }

    return Object.freeze({
        async record(input) {
            if (!input || typeof input !== "object" || Array.isArray(input)) fail("input");
            const tenantId = requireTenantId(input.tenantId);
            if (tenantId !== input.tenantId) fail("tenantId");
            const alertId = requireAlertId(input.alertId);
            if (input.schemaVersion !== 1 || input.type !== "server_error") fail("contract");
            const operation = requireOperation(input.operation);
            const statusCode = requireStatusCode(input.statusCode);
            requireCanonicalTimestamp(input.occurredAt);
            requireCanonicalTimestamp(input.windowStartedAt);
            const criticalThreshold = Number(input.criticalThreshold);
            if (!Number.isSafeInteger(criticalThreshold) || criticalThreshold < 2 ||
                criticalThreshold > 1000) {
                fail("criticalThreshold");
            }

            const path = `tenants/${tenantId}/${OPERATIONAL_ALERTS_COLLECTION}/${alertId}`;
            const ref = db.doc(path);

            return db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                let next;

                if (snapshot.exists) {
                    const current = projectPersistedAlert(snapshot.data(), {
                        documentId: alertId,
                        tenantId
                    });
                    if (current.operation !== operation ||
                        current.statusCode !== statusCode) {
                        fail("aggregate identity");
                    }

                    if (current.windowStartedAt !== input.windowStartedAt) {
                        next = Object.freeze({
                            schemaVersion: 1,
                            alertId,
                            tenantId,
                            type: "server_error",
                            severity: "high",
                            operation,
                            statusCode,
                            eventCount: 1,
                            firstSeenAt: input.occurredAt,
                            lastSeenAt: input.occurredAt,
                            windowStartedAt: input.windowStartedAt
                        });
                    } else {
                        const eventCount = current.eventCount + 1;
                        next = Object.freeze({
                            ...current,
                            severity: eventCount >= criticalThreshold ? "critical" : current.severity,
                            eventCount,
                            firstSeenAt: current.firstSeenAt < input.occurredAt
                                ? current.firstSeenAt
                                : input.occurredAt,
                            lastSeenAt: current.lastSeenAt > input.occurredAt
                                ? current.lastSeenAt
                                : input.occurredAt
                        });
                    }
                } else {
                    next = Object.freeze({
                        schemaVersion: 1,
                        alertId,
                        tenantId,
                        type: "server_error",
                        severity: "high",
                        operation,
                        statusCode,
                        eventCount: 1,
                        firstSeenAt: input.occurredAt,
                        lastSeenAt: input.occurredAt,
                        windowStartedAt: input.windowStartedAt
                    });
                }

                transaction.set(ref, next);
                return next;
            });
        },

        async listTenant({ context, tenantId, limit = 20 }) {
            if (context?.role !== "platform_admin") {
                const error = new Error("Operational alert okuma yetkisi gerekli.");
                error.code = "PERMISSION_DENIED";
                throw error;
            }
            const safeTenantId = requireTenantId(tenantId);
            if (safeTenantId !== tenantId) fail("tenantId");
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail("limit");

            let snapshot;
            try {
                snapshot = await db.collection(
                    `tenants/${safeTenantId}/${OPERATIONAL_ALERTS_COLLECTION}`
                )
                    .orderBy("lastSeenAt", "desc")
                    .limit(limit)
                    .get();
            } catch {
                const error = new Error("Operational alert sorgusu başarısız.");
                error.code = "OPERATIONAL_ALERT_READ_FAILED";
                throw error;
            }

            if (!snapshot || !Array.isArray(snapshot.docs)) fail("query result");
            return Object.freeze(snapshot.docs.map(document =>
                projectPersistedAlert(document.data(), {
                    documentId: document.id,
                    tenantId: safeTenantId
                })
            ));
        }
    });
}

module.exports = {
    OPERATIONAL_ALERTS_COLLECTION,
    createFirestoreOperationalAlertStore,
    projectPersistedAlert
};
