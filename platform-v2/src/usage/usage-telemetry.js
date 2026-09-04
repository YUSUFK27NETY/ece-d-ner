const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const AGGREGATION_PERIODS = new Set(["daily", "monthly"]);
const OPERATION_CLASSES = new Set([
    "public",
    "admin",
    "read",
    "write",
    "backup",
    "restore",
    "system"
]);

function normalizeDate(value, label = "Telemetry timestamp") {
    const date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return date;
}

function normalizeCounter(value, label) {
    const number = Number(value ?? 0);

    if (!Number.isInteger(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return number;
}

function normalizeMetric(value, label) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return number;
}

function normalizeOperation(value) {
    const operation = String(value ?? "").trim();

    if (!/^[a-z0-9][a-z0-9_.:-]{1,119}$/i.test(operation)) {
        throw new TypeError("Telemetry operation geçersiz.");
    }

    return operation;
}

function normalizeOperationClass(value) {
    const operationClass = String(value ?? "").trim().toLowerCase();

    if (!OPERATION_CLASSES.has(operationClass)) {
        throw new TypeError("Telemetry operationClass geçersiz.");
    }

    return operationClass;
}

function normalizeBackupMetadata(input) {
    if (input === undefined || input === null) {
        return null;
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Telemetry backup metadata nesne olmalı.");
    }

    const allowed = new Set([
        "sizeBytes",
        "objectCount",
        "verifiedAt",
        "restoreDrillAt",
        "restoreDrillStatus"
    ]);

    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) {
            throw new TypeError("Telemetry backup metadata bilinmeyen alan içeriyor.");
        }
    }

    const status = input.restoreDrillStatus === undefined || input.restoreDrillStatus === null
        ? null
        : String(input.restoreDrillStatus).trim().toLowerCase();

    if (status !== null && !new Set(["passed", "failed", "dry_run", "unknown"]).has(status)) {
        throw new TypeError("Telemetry restore drill status geçersiz.");
    }

    const output = {};
    if (input.sizeBytes !== undefined) {
        output.sizeBytes = normalizeCounter(input.sizeBytes, "Telemetry backup sizeBytes");
    }
    if (input.objectCount !== undefined) {
        output.objectCount = normalizeCounter(input.objectCount, "Telemetry backup objectCount");
    }
    if (input.verifiedAt !== undefined) {
        output.verifiedAt = input.verifiedAt
            ? normalizeDate(input.verifiedAt, "Telemetry backup verifiedAt").toISOString()
            : null;
    }
    if (input.restoreDrillAt !== undefined) {
        output.restoreDrillAt = input.restoreDrillAt
            ? normalizeDate(input.restoreDrillAt, "Telemetry restoreDrillAt").toISOString()
            : null;
    }
    if (input.restoreDrillStatus !== undefined) {
        output.restoreDrillStatus = status;
    }

    return Object.freeze(output);
}

function createUsageDelta({
    tenantId,
    operation,
    operationClass,
    timestamp = new Date(),
    requestCount = 1,
    errorCount = null,
    statusCode = null,
    latencyMs = 0,
    firestoreReads = 0,
    firestoreWrites = 0,
    renderComputeMs = 0,
    r2StorageByteHours = 0,
    r2BandwidthBytes = 0,
    backupStorageByteHours = 0,
    backup = null
}) {
    const occurredAt = normalizeDate(timestamp);
    const safeStatusCode = statusCode === null || statusCode === undefined
        ? null
        : normalizeCounter(statusCode, "Telemetry statusCode");
    if (safeStatusCode !== null && (safeStatusCode < 100 || safeStatusCode > 599)) {
        throw new TypeError("Telemetry statusCode geçersiz.");
    }
    const safeRequestCount = normalizeCounter(requestCount, "Telemetry requestCount");
    const safeErrorCount = errorCount === null || errorCount === undefined
        ? (safeStatusCode !== null && safeStatusCode >= 400 ? safeRequestCount : 0)
        : normalizeCounter(errorCount, "Telemetry errorCount");

    if (safeErrorCount > safeRequestCount) {
        throw new TypeError("Telemetry errorCount requestCount değerini aşamaz.");
    }

    return Object.freeze({
        tenantId: requireTenantId(tenantId),
        operation: normalizeOperation(operation),
        operationClass: normalizeOperationClass(operationClass),
        timestamp: occurredAt.toISOString(),
        requestCount: safeRequestCount,
        errorCount: safeErrorCount,
        statusCode: safeStatusCode,
        latencyMs: normalizeMetric(latencyMs, "Telemetry latencyMs"),
        providerUsage: Object.freeze({
            firestoreReads: normalizeCounter(firestoreReads, "Telemetry firestoreReads"),
            firestoreWrites: normalizeCounter(firestoreWrites, "Telemetry firestoreWrites"),
            renderComputeMs: normalizeMetric(renderComputeMs, "Telemetry renderComputeMs"),
            r2StorageByteHours: normalizeMetric(r2StorageByteHours, "Telemetry r2StorageByteHours"),
            r2BandwidthBytes: normalizeMetric(r2BandwidthBytes, "Telemetry r2BandwidthBytes"),
            backupStorageByteHours: normalizeMetric(backupStorageByteHours, "Telemetry backupStorageByteHours")
        }),
        backup: normalizeBackupMetadata(backup)
    });
}

function getAggregationPeriod(period, at = new Date()) {
    const safePeriod = String(period ?? "").trim().toLowerCase();

    if (!AGGREGATION_PERIODS.has(safePeriod)) {
        throw new TypeError("Telemetry aggregation period geçersiz.");
    }

    const date = normalizeDate(at, "Telemetry aggregation tarihi");
    const day = date.toISOString().slice(0, 10);
    const start = safePeriod === "daily" ? day : day.slice(0, 7);

    return Object.freeze({
        period: safePeriod,
        periodStart: start,
        key: `${safePeriod}_${start}`
    });
}

function emptyUsageAggregate(tenantId, descriptor) {
    return {
        schemaVersion: 1,
        tenantId: requireTenantId(tenantId),
        period: descriptor.period,
        periodStart: descriptor.periodStart,
        requestCount: 0,
        errorCount: 0,
        latencyTotalMs: 0,
        latencyMaxMs: 0,
        operationCounts: {},
        operationClassCounts: {},
        providerUsage: {
            firestoreReads: 0,
            firestoreWrites: 0,
            renderComputeMs: 0,
            r2StorageByteHours: 0,
            r2BandwidthBytes: 0,
            backupStorageByteHours: 0
        },
        backup: null,
        lastError: null,
        updatedAt: null
    };
}

function mergeUsageAggregate(current, delta, descriptor) {
    const defaults = emptyUsageAggregate(delta.tenantId, descriptor);
    const stored = current ? JSON.parse(JSON.stringify(current)) : {};
    const aggregate = {
        ...defaults,
        ...stored,
        operationCounts: {
            ...defaults.operationCounts,
            ...(stored.operationCounts || {})
        },
        operationClassCounts: {
            ...defaults.operationClassCounts,
            ...(stored.operationClassCounts || {})
        },
        providerUsage: {
            ...defaults.providerUsage,
            ...(stored.providerUsage || {})
        }
    };

    if (
        requireTenantId(aggregate.tenantId) !== delta.tenantId ||
        aggregate.period !== descriptor.period ||
        aggregate.periodStart !== descriptor.periodStart
    ) {
        const error = new Error("Telemetry aggregate tenant veya dönem sınırı uyuşmuyor.");
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }

    aggregate.requestCount += delta.requestCount;
    aggregate.errorCount += delta.errorCount;
    aggregate.latencyTotalMs += delta.latencyMs;
    aggregate.latencyMaxMs = Math.max(aggregate.latencyMaxMs, delta.latencyMs);
    const currentOperationCount = Number.isFinite(aggregate.operationCounts[delta.operation])
        ? aggregate.operationCounts[delta.operation]
        : 0;
    aggregate.operationCounts[delta.operation] = currentOperationCount + delta.requestCount;
    aggregate.operationClassCounts[delta.operationClass] =
        (aggregate.operationClassCounts[delta.operationClass] || 0) + delta.requestCount;

    for (const [key, value] of Object.entries(delta.providerUsage)) {
        aggregate.providerUsage[key] = (aggregate.providerUsage[key] || 0) + value;
    }

    if (delta.backup) {
        aggregate.backup = {
            ...(aggregate.backup || {}),
            ...delta.backup
        };
    }

    if (delta.errorCount > 0) {
        aggregate.lastError = {
            occurredAt: delta.timestamp,
            operation: delta.operation,
            statusCode: delta.statusCode
        };
    }

    aggregate.updatedAt = delta.timestamp;
    return aggregate;
}

function presentUsageAggregate(aggregate) {
    if (!aggregate) {
        return null;
    }

    const output = JSON.parse(JSON.stringify(aggregate));
    output.latencyAverageMs = output.requestCount > 0
        ? output.latencyTotalMs / output.requestCount
        : 0;
    return Object.freeze(output);
}

function assertUsageStore(store) {
    for (const method of ["increment", "get"]) {
        if (!store || typeof store[method] !== "function") {
            throw new TypeError(`Usage telemetry store ${method} metodunu uygulamalı.`);
        }
    }

    return store;
}

function createUsageTelemetryService({ store }) {
    const telemetryStore = assertUsageStore(store);

    return Object.freeze({
        async record(input) {
            const delta = createUsageDelta(input);
            const descriptors = [
                getAggregationPeriod("daily", delta.timestamp),
                getAggregationPeriod("monthly", delta.timestamp)
            ];

            await Promise.all(descriptors.map(descriptor => telemetryStore.increment({
                tenantId: delta.tenantId,
                descriptor,
                delta
            })));

            return delta;
        },

        async getAggregate({ context, tenantId, period, at = new Date() }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "tenant.telemetry.read"
            });
            const descriptor = getAggregationPeriod(period, at);
            const aggregate = await telemetryStore.get({
                tenantId: safeTenantId,
                descriptor
            });

            return presentUsageAggregate(
                aggregate || emptyUsageAggregate(safeTenantId, descriptor)
            );
        }
    });
}

module.exports = {
    AGGREGATION_PERIODS,
    OPERATION_CLASSES,
    createUsageDelta,
    createUsageTelemetryService,
    emptyUsageAggregate,
    getAggregationPeriod,
    mergeUsageAggregate,
    normalizeBackupMetadata,
    presentUsageAggregate
};
