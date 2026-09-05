const CAPACITY_METRICS = Object.freeze([
    "requestRate",
    "latencyP95Ms",
    "latencyP99Ms",
    "errorRate",
    "operationLoad",
    "queueBacklog",
    "workerUtilization",
    "storageBytes",
    "bandwidthBytes",
    "infraRevenueRatio"
]);

function threshold(warning, critical, dedicatedReview) {
    return Object.freeze({ warning, critical, dedicatedReview });
}

const DEFAULT_PLATFORM_SCALABILITY_CONFIG = Object.freeze({
    capacity: Object.freeze({
        slo: Object.freeze({
            availabilityTarget: 0.995,
            p95LatencyMs: 500,
            p99LatencyMs: 1000,
            errorRate: 0.01
        }),
        thresholds: Object.freeze({
            requestRate: threshold(25, 75, 150),
            latencyP95Ms: threshold(500, 1000, 2000),
            latencyP99Ms: threshold(1000, 2000, 4000),
            errorRate: threshold(0.01, 0.05, 0.10),
            operationLoad: threshold(10_000, 50_000, 100_000),
            queueBacklog: threshold(50, 200, 500),
            workerUtilization: threshold(0.70, 0.90, 0.98),
            storageBytes: threshold(10_000_000_000, 50_000_000_000, 100_000_000_000),
            bandwidthBytes: threshold(10_000_000_000, 50_000_000_000, 100_000_000_000),
            infraRevenueRatio: threshold(0.10, 0.15, 0.25)
        })
    }),
    routing: Object.freeze({ cacheTtlMs: 30_000 }),
    queue: Object.freeze({
        perTenantConcurrency: 2,
        maxQueuedPerTenant: 1000,
        burstWindowMs: 10_000,
        burstMax: 50,
        sustainedWindowMs: 60_000,
        sustainedMax: 200,
        maxAttempts: 5,
        baseBackoffMs: 1000,
        maxBackoffMs: 60_000
    }),
    cache: Object.freeze({
        publicTtlSeconds: 300,
        staleWhileRevalidateSeconds: 60,
        maxEntriesPerTenant: 1000
    }),
    resilience: Object.freeze({
        timeoutMs: 3000,
        maxAttempts: 3,
        baseBackoffMs: 100,
        maxBackoffMs: 2000,
        failureThreshold: 3,
        recoveryMs: 30_000
    })
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function assertKeys(value, allowed, label) {
    if (!isPlainObject(value)) throw new TypeError(`${label} nesne olmalı.`);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new TypeError(`${label} bilinmeyen alan içeriyor.`);
    }
}

function mergeConfig(base, override) {
    if (override === undefined) return base;
    if (!isPlainObject(override)) return override;
    const output = { ...(isPlainObject(base) ? base : {}) };
    for (const [key, value] of Object.entries(override)) {
        if (new Set(["__proto__", "prototype", "constructor"]).has(key)) {
            throw new TypeError("Platform scalability config güvenli olmayan alan içeriyor.");
        }
        output[key] = isPlainObject(value) ? mergeConfig(output[key], value) : value;
    }
    return output;
}

function requireNumber(value, label, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return number;
}

function requireInteger(value, label, min, max) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return number;
}

function normalizeThresholds(input) {
    assertKeys(input, new Set(CAPACITY_METRICS), "Capacity thresholds");
    const output = {};

    for (const metric of CAPACITY_METRICS) {
        const value = input[metric];
        assertKeys(value, new Set(["warning", "critical", "dedicatedReview"]), `Capacity ${metric}`);
        const warning = requireNumber(value.warning, `${metric} warning`, 0, Number.MAX_SAFE_INTEGER);
        const critical = requireNumber(value.critical, `${metric} critical`, 0, Number.MAX_SAFE_INTEGER);
        const dedicatedReview = requireNumber(
            value.dedicatedReview,
            `${metric} dedicatedReview`,
            0,
            Number.MAX_SAFE_INTEGER
        );
        if (warning > critical || critical > dedicatedReview) {
            throw new TypeError(`Capacity ${metric} threshold sırası geçersiz.`);
        }
        output[metric] = Object.freeze({ warning, critical, dedicatedReview });
    }
    return Object.freeze(output);
}

function normalizePlatformScalabilityConfig(input) {
    assertKeys(input, new Set(["capacity", "routing", "queue", "cache", "resilience"]), "Platform scalability config");
    assertKeys(input.capacity, new Set(["slo", "thresholds"]), "Capacity config");
    assertKeys(input.capacity.slo, new Set([
        "availabilityTarget", "p95LatencyMs", "p99LatencyMs", "errorRate"
    ]), "Capacity SLO config");
    assertKeys(input.routing, new Set(["cacheTtlMs"]), "Routing config");
    assertKeys(input.queue, new Set([
        "perTenantConcurrency", "maxQueuedPerTenant", "burstWindowMs", "burstMax",
        "sustainedWindowMs", "sustainedMax", "maxAttempts", "baseBackoffMs", "maxBackoffMs"
    ]), "Queue config");
    assertKeys(input.cache, new Set([
        "publicTtlSeconds", "staleWhileRevalidateSeconds", "maxEntriesPerTenant"
    ]), "Cache config");
    assertKeys(input.resilience, new Set([
        "timeoutMs", "maxAttempts", "baseBackoffMs", "maxBackoffMs",
        "failureThreshold", "recoveryMs"
    ]), "Resilience config");

    const slo = {
        availabilityTarget: requireNumber(input.capacity.slo.availabilityTarget, "SLO availabilityTarget", 0.5, 1),
        p95LatencyMs: requireNumber(input.capacity.slo.p95LatencyMs, "SLO p95LatencyMs", 1, 300_000),
        p99LatencyMs: requireNumber(input.capacity.slo.p99LatencyMs, "SLO p99LatencyMs", 1, 300_000),
        errorRate: requireNumber(input.capacity.slo.errorRate, "SLO errorRate", 0, 1)
    };
    if (slo.p95LatencyMs > slo.p99LatencyMs) {
        throw new TypeError("SLO latency threshold sırası geçersiz.");
    }

    const queue = {
        perTenantConcurrency: requireInteger(input.queue.perTenantConcurrency, "Queue perTenantConcurrency", 1, 1000),
        maxQueuedPerTenant: requireInteger(input.queue.maxQueuedPerTenant, "Queue maxQueuedPerTenant", 1, 1_000_000),
        burstWindowMs: requireInteger(input.queue.burstWindowMs, "Queue burstWindowMs", 100, 3_600_000),
        burstMax: requireInteger(input.queue.burstMax, "Queue burstMax", 1, 1_000_000),
        sustainedWindowMs: requireInteger(input.queue.sustainedWindowMs, "Queue sustainedWindowMs", 1000, 86_400_000),
        sustainedMax: requireInteger(input.queue.sustainedMax, "Queue sustainedMax", 1, 10_000_000),
        maxAttempts: requireInteger(input.queue.maxAttempts, "Queue maxAttempts", 1, 100),
        baseBackoffMs: requireInteger(input.queue.baseBackoffMs, "Queue baseBackoffMs", 1, 86_400_000),
        maxBackoffMs: requireInteger(input.queue.maxBackoffMs, "Queue maxBackoffMs", 1, 604_800_000)
    };
    if (queue.burstWindowMs > queue.sustainedWindowMs || queue.baseBackoffMs > queue.maxBackoffMs) {
        throw new TypeError("Queue config sıra ilişkisi geçersiz.");
    }

    const resilience = {
        timeoutMs: requireInteger(input.resilience.timeoutMs, "Resilience timeoutMs", 10, 30_000),
        maxAttempts: requireInteger(input.resilience.maxAttempts, "Resilience maxAttempts", 1, 10),
        baseBackoffMs: requireInteger(input.resilience.baseBackoffMs, "Resilience baseBackoffMs", 0, 60_000),
        maxBackoffMs: requireInteger(input.resilience.maxBackoffMs, "Resilience maxBackoffMs", 0, 300_000),
        failureThreshold: requireInteger(input.resilience.failureThreshold, "Resilience failureThreshold", 1, 100),
        recoveryMs: requireInteger(input.resilience.recoveryMs, "Resilience recoveryMs", 100, 3_600_000)
    };
    if (resilience.baseBackoffMs > resilience.maxBackoffMs) {
        throw new TypeError("Resilience backoff sırası geçersiz.");
    }

    return Object.freeze({
        capacity: Object.freeze({
            slo: Object.freeze(slo),
            thresholds: normalizeThresholds(input.capacity.thresholds)
        }),
        routing: Object.freeze({
            cacheTtlMs: requireInteger(input.routing.cacheTtlMs, "Routing cacheTtlMs", 100, 3_600_000)
        }),
        queue: Object.freeze(queue),
        cache: Object.freeze({
            publicTtlSeconds: requireInteger(input.cache.publicTtlSeconds, "Cache publicTtlSeconds", 1, 604_800),
            staleWhileRevalidateSeconds: requireInteger(
                input.cache.staleWhileRevalidateSeconds,
                "Cache staleWhileRevalidateSeconds",
                0,
                604_800
            ),
            maxEntriesPerTenant: requireInteger(input.cache.maxEntriesPerTenant, "Cache maxEntriesPerTenant", 1, 1_000_000)
        }),
        resilience: Object.freeze(resilience)
    });
}

function loadPlatformScalabilityConfig(raw = process.env.PLATFORM_SCALABILITY_CONFIG_JSON) {
    let override = {};
    if (raw !== undefined && raw !== null && String(raw).trim()) {
        try {
            override = JSON.parse(String(raw));
        } catch {
            throw new TypeError("PLATFORM_SCALABILITY_CONFIG_JSON geçerli JSON olmalı.");
        }
        if (!isPlainObject(override)) {
            throw new TypeError("PLATFORM_SCALABILITY_CONFIG_JSON nesne olmalı.");
        }
    }
    return normalizePlatformScalabilityConfig(
        mergeConfig(DEFAULT_PLATFORM_SCALABILITY_CONFIG, override)
    );
}

module.exports = {
    CAPACITY_METRICS,
    DEFAULT_PLATFORM_SCALABILITY_CONFIG,
    loadPlatformScalabilityConfig,
    normalizePlatformScalabilityConfig
};
