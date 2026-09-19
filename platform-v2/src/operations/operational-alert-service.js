const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");

const OPERATIONAL_ALERT_SEVERITIES = Object.freeze(["high", "critical"]);
const DEFAULT_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_CRITICAL_THRESHOLD = 3;

function normalizePositiveInteger(value, label, min, max) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return number;
}

function requireCanonicalTimestamp(value, label = "Operational alert zamanı") {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0 ||
        new Date(timestamp).toISOString() !== value) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return timestamp;
}

function normalizeOperation(value) {
    const operation = String(value ?? "").trim();
    if (!/^[a-z0-9][a-z0-9_.:-]{1,119}$/i.test(operation)) {
        throw new TypeError("Operational alert operation geçersiz.");
    }
    return operation;
}

function operationalAlertId({ tenantId, operation, statusCode }) {
    return crypto.createHash("sha256")
        .update(JSON.stringify([1, tenantId, operation, statusCode]))
        .digest("hex");
}

function createOperationalAlertService({
    store,
    dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
    criticalThreshold = DEFAULT_CRITICAL_THRESHOLD
}) {
    if (!store || typeof store.record !== "function" || typeof store.listTenant !== "function") {
        throw new TypeError("Operational alert store geçersiz.");
    }
    const safeWindowMs = normalizePositiveInteger(
        dedupeWindowMs,
        "Operational alert dedupe window",
        60_000,
        24 * 60 * 60 * 1000
    );
    const safeCriticalThreshold = normalizePositiveInteger(
        criticalThreshold,
        "Operational alert critical threshold",
        2,
        1000
    );

    return Object.freeze({
        async record({
            tenantId,
            operation,
            statusCode,
            occurredAt = new Date().toISOString()
        }) {
            const safeTenantId = requireTenantId(tenantId);
            if (safeTenantId !== tenantId) {
                throw new TypeError("Operational alert tenantId canonical olmalı.");
            }
            const safeOperation = normalizeOperation(operation);
            const safeStatusCode = normalizePositiveInteger(
                statusCode,
                "Operational alert statusCode",
                500,
                599
            );
            const occurredAtMs = requireCanonicalTimestamp(occurredAt);
            const windowStartedAtMs = Math.floor(occurredAtMs / safeWindowMs) * safeWindowMs;
            const windowStartedAt = new Date(windowStartedAtMs).toISOString();
            const alertId = operationalAlertId({
                tenantId: safeTenantId,
                operation: safeOperation,
                statusCode: safeStatusCode
            });

            return store.record(Object.freeze({
                schemaVersion: 1,
                alertId,
                tenantId: safeTenantId,
                type: "server_error",
                operation: safeOperation,
                statusCode: safeStatusCode,
                occurredAt,
                windowStartedAt,
                criticalThreshold: safeCriticalThreshold
            }));
        },

        async listTenant({ context, tenantId, limit = 20 }) {
            const safeTenantId = requireTenantId(tenantId);
            if (safeTenantId !== tenantId) {
                throw new TypeError("Operational alert tenantId canonical olmalı.");
            }
            const safeLimit = normalizePositiveInteger(
                limit,
                "Operational alert list limit",
                1,
                200
            );
            return store.listTenant({
                context,
                tenantId: safeTenantId,
                limit: safeLimit
            });
        }
    });
}

module.exports = {
    DEFAULT_CRITICAL_THRESHOLD,
    DEFAULT_DEDUPE_WINDOW_MS,
    OPERATIONAL_ALERT_SEVERITIES,
    createOperationalAlertService,
    normalizeOperation,
    operationalAlertId,
    requireCanonicalTimestamp
};
