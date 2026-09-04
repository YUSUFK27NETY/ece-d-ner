const { requireTenantId } = require("../tenant/tenant-id");

const CAPACITY_STATUSES = Object.freeze(["normal", "warning", "critical", "dedicated_review"]);
const STATUS_RANK = Object.freeze({ normal: 0, warning: 1, critical: 2, dedicated_review: 3 });

function metric(value, label) {
    const number = Number(value ?? 0);
    if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
        throw new TypeError(`Capacity ${label} geçersiz.`);
    }
    return number;
}

function normalizeCapacityMetrics(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Capacity metrics nesne olmalı.");
    }
    const allowed = new Set([
        "requestRate", "latencyP95Ms", "latencyP99Ms", "errorRate",
        "firestoreOperations", "appOperations", "queueBacklog", "workerConcurrency",
        "workerCapacity", "healthyWorkers", "totalWorkers", "storageBytes",
        "bandwidthBytes", "infraRevenueRatio"
    ]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError("Capacity metrics bilinmeyen alan içeriyor.");
    }

    const output = {};
    for (const key of allowed) output[key] = metric(input[key], key);
    if (output.errorRate > 1) throw new TypeError("Capacity errorRate 0-1 arasında olmalı.");
    if (output.healthyWorkers > output.totalWorkers) {
        throw new TypeError("Capacity healthyWorkers totalWorkers değerini aşamaz.");
    }
    if (output.workerConcurrency > 0 && output.workerCapacity === 0) {
        throw new TypeError("Capacity workerCapacity gerekli.");
    }
    return Object.freeze(output);
}

function statusForValue(value, thresholds) {
    if (value >= thresholds.dedicatedReview) return "dedicated_review";
    if (value >= thresholds.critical) return "critical";
    if (value >= thresholds.warning) return "warning";
    return "normal";
}

function createCapacitySloService({ config }) {
    if (!config?.capacity?.slo || !config?.capacity?.thresholds) {
        throw new TypeError("Capacity/SLO config gerekli.");
    }
    const { slo, thresholds } = config.capacity;

    function evaluate({ scope = "tenant", tenantId = null, metrics = {} }) {
        const safeScope = String(scope ?? "").trim().toLowerCase();
        if (!new Set(["tenant", "platform"]).has(safeScope)) {
            throw new TypeError("Capacity scope geçersiz.");
        }
        const safeTenantId = safeScope === "tenant" ? requireTenantId(tenantId) : null;
        const values = normalizeCapacityMetrics(metrics);
        const derived = Object.freeze({
            requestRate: values.requestRate,
            latencyP95Ms: values.latencyP95Ms,
            latencyP99Ms: values.latencyP99Ms,
            errorRate: values.errorRate,
            operationLoad: values.firestoreOperations + values.appOperations,
            queueBacklog: values.queueBacklog,
            workerUtilization: values.workerCapacity > 0
                ? values.workerConcurrency / values.workerCapacity
                : 0,
            storageBytes: values.storageBytes,
            bandwidthBytes: values.bandwidthBytes,
            infraRevenueRatio: values.infraRevenueRatio
        });
        const metricStatuses = {};
        let status = "normal";
        for (const [name, value] of Object.entries(derived)) {
            metricStatuses[name] = statusForValue(value, thresholds[name]);
            if (STATUS_RANK[metricStatuses[name]] > STATUS_RANK[status]) status = metricStatuses[name];
        }
        const availability = 1 - values.errorRate;
        const sloMet = availability >= slo.availabilityTarget &&
            values.latencyP95Ms <= slo.p95LatencyMs &&
            values.latencyP99Ms <= slo.p99LatencyMs &&
            values.errorRate <= slo.errorRate;

        return Object.freeze({
            scope: safeScope,
            tenantId: safeTenantId,
            status,
            dedicatedReview: status === "dedicated_review",
            metrics: derived,
            metricStatuses: Object.freeze(metricStatuses),
            slo: Object.freeze({
                status: sloMet ? "met" : "violated",
                availability,
                targets: Object.freeze({ ...slo })
            }),
            workerHealth: values.totalWorkers === 0
                ? "unknown"
                : (values.healthyWorkers === values.totalWorkers ? "healthy" : "degraded")
        });
    }

    function aggregatePlatform({ tenants }) {
        if (!Array.isArray(tenants)) throw new TypeError("Platform capacity tenant listesi gerekli.");
        const normalized = tenants.map(item => ({
            tenantId: requireTenantId(item?.tenantId),
            metrics: normalizeCapacityMetrics(item?.metrics)
        }));
        const totals = {
            requestRate: 0, latencyP95Ms: 0, latencyP99Ms: 0, errorRate: 0,
            firestoreOperations: 0, appOperations: 0, queueBacklog: 0,
            workerConcurrency: 0, workerCapacity: 0, healthyWorkers: 0,
            totalWorkers: 0, storageBytes: 0, bandwidthBytes: 0, infraRevenueRatio: 0
        };
        let weightedErrors = 0;
        for (const item of normalized) {
            const value = item.metrics;
            totals.requestRate += value.requestRate;
            weightedErrors += value.errorRate * value.requestRate;
            totals.latencyP95Ms = Math.max(totals.latencyP95Ms, value.latencyP95Ms);
            totals.latencyP99Ms = Math.max(totals.latencyP99Ms, value.latencyP99Ms);
            for (const key of [
                "firestoreOperations", "appOperations", "queueBacklog", "workerConcurrency",
                "workerCapacity", "healthyWorkers", "totalWorkers", "storageBytes", "bandwidthBytes"
            ]) totals[key] += value[key];
            totals.infraRevenueRatio = Math.max(totals.infraRevenueRatio, value.infraRevenueRatio);
        }
        totals.errorRate = totals.requestRate > 0 ? weightedErrors / totals.requestRate : 0;
        return Object.freeze({
            tenantCount: normalized.length,
            ...evaluate({ scope: "platform", metrics: totals })
        });
    }

    return Object.freeze({ evaluate, aggregatePlatform });
}

module.exports = {
    CAPACITY_STATUSES,
    normalizeCapacityMetrics,
    statusForValue,
    createCapacitySloService
};
