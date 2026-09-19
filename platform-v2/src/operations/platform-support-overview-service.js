const { requireTenantId } = require("../tenant/tenant-id");

const HEALTH_STATES = Object.freeze(["healthy", "attention", "critical", "unknown"]);
const HEALTH_RANK = Object.freeze({ critical: 0, attention: 1, unknown: 2, healthy: 3 });
const SECURITY_RANK = Object.freeze({ none: 0, info: 1, warning: 2, critical: 3 });

function requirePlatformAdmin(context) {
    if (!context || context.role !== "platform_admin") {
        const error = new Error("Destek merkezi Platform Admin gerektirir.");
        error.code = "PERMISSION_DENIED";
        throw error;
    }
    return context;
}

function normalizeLimit(value = 200) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Destek merkezi tenant limiti 1-200 arasında olmalı.");
    }
    return limit;
}

function normalizeConcurrency(value = 8) {
    const concurrency = Number(value);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 20) {
        throw new TypeError("Destek merkezi concurrency değeri 1-20 arasında olmalı.");
    }
    return concurrency;
}

function safeCounter(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function projectLastError(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;

    const occurredAt = typeof value.occurredAt === "string" ? value.occurredAt : null;
    const operation = typeof value.operation === "string" && value.operation.length <= 120
        ? value.operation
        : null;
    const statusCode = Number.isInteger(value.statusCode) &&
        value.statusCode >= 100 && value.statusCode <= 599
        ? value.statusCode
        : null;

    if (!occurredAt && !operation && statusCode === null) return null;
    return Object.freeze({ occurredAt, operation, statusCode });
}

function summarizeSecurity(signals) {
    if (!Array.isArray(signals)) {
        throw new TypeError("Destek merkezi security sinyalleri geçersiz.");
    }

    let total = 0;
    let highestSeverity = "none";
    let latestAt = null;

    for (const signal of signals) {
        if (!signal || typeof signal !== "object" || Array.isArray(signal)) continue;
        const severity = Object.hasOwn(SECURITY_RANK, signal.severity)
            ? signal.severity
            : "none";
        const count = safeCounter(signal.count);
        total += count;

        if (SECURITY_RANK[severity] > SECURITY_RANK[highestSeverity]) {
            highestSeverity = severity;
        }

        if (typeof signal.createdAt === "string" &&
            (!latestAt || signal.createdAt > latestAt)) {
            latestAt = signal.createdAt;
        }
    }

    return Object.freeze({ total, highestSeverity, latestAt });
}

function deriveHealth({ tenant, usage, security, usageAvailable, securityAvailable }) {
    if (tenant.status === "archived" || tenant.status === "suspended") {
        return "attention";
    }

    if (!usageAvailable || !securityAvailable) return "unknown";
    if (security.highestSeverity === "critical") return "critical";
    if (tenant.status === "provisioning" ||
        safeCounter(usage.errorCount) > 0 ||
        SECURITY_RANK[security.highestSeverity] >= SECURITY_RANK.warning) {
        return "attention";
    }

    return tenant.status === "active" ? "healthy" : "unknown";
}

async function mapWithConcurrency(items, concurrency, worker) {
    const output = new Array(items.length);
    let cursor = 0;

    async function consume() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            output[index] = await worker(items[index], index);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(concurrency, Math.max(1, items.length)) },
            () => consume()
        )
    );
    return output;
}

function createPlatformSupportOverviewService({
    tenantRegistry,
    usageTelemetry,
    securitySignals,
    concurrency = 8
}) {
    if (!tenantRegistry || typeof tenantRegistry.list !== "function") {
        throw new TypeError("Destek merkezi tenant registry gerekli.");
    }
    if (!usageTelemetry || typeof usageTelemetry.getAggregate !== "function") {
        throw new TypeError("Destek merkezi usage telemetry gerekli.");
    }
    if (!securitySignals || typeof securitySignals.listTenant !== "function") {
        throw new TypeError("Destek merkezi security signals gerekli.");
    }

    const safeConcurrency = normalizeConcurrency(concurrency);

    return Object.freeze({
        async getOverview({ context, limit = 200, at = new Date() } = {}) {
            requirePlatformAdmin(context);
            const safeLimit = normalizeLimit(limit);
            const observedAt = at instanceof Date ? at : new Date(at);
            if (Number.isNaN(observedAt.getTime())) {
                throw new TypeError("Destek merkezi tarihi geçersiz.");
            }

            const tenants = await tenantRegistry.list({ limit: safeLimit });
            if (!Array.isArray(tenants)) {
                throw new TypeError("Destek merkezi tenant listesi geçersiz.");
            }

            const rows = await mapWithConcurrency(
                tenants,
                safeConcurrency,
                async tenant => {
                    const tenantId = requireTenantId(tenant?.tenantId);
                    if (tenantId !== tenant.tenantId) {
                        throw new TypeError("Destek merkezi tenant kimliği canonical olmalı.");
                    }
                    const [usageResult, securityResult] = await Promise.allSettled([
                        usageTelemetry.getAggregate({
                            context,
                            tenantId,
                            period: "daily",
                            at: observedAt
                        }),
                        securitySignals.listTenant({
                            context,
                            tenantId,
                            limit: 10
                        })
                    ]);

                    const usageAvailable = usageResult.status === "fulfilled" &&
                        usageResult.value && typeof usageResult.value === "object";
                    const securityAvailable = securityResult.status === "fulfilled" &&
                        Array.isArray(securityResult.value);
                    const usage = usageAvailable ? usageResult.value : {};
                    const security = securityAvailable
                        ? summarizeSecurity(securityResult.value)
                        : Object.freeze({
                            total: 0,
                            highestSeverity: "none",
                            latestAt: null
                        });
                    const health = deriveHealth({
                        tenant,
                        usage,
                        security,
                        usageAvailable,
                        securityAvailable
                    });

                    return Object.freeze({
                        tenantId,
                        displayName: String(tenant?.displayName || tenantId),
                        sector: String(tenant?.sector || ""),
                        plan: String(tenant?.plan || ""),
                        lifecycleStatus: String(tenant?.status || "unknown"),
                        health,
                        requestsToday: safeCounter(usage.requestCount),
                        errorsToday: safeCounter(usage.errorCount),
                        lastError: projectLastError(usage.lastError),
                        security,
                        telemetryUpdatedAt: typeof usage.updatedAt === "string"
                            ? usage.updatedAt
                            : null,
                        sources: Object.freeze({
                            usage: usageAvailable,
                            security: securityAvailable
                        })
                    });
                }
            );

            rows.sort((left, right) => {
                const healthCompare = HEALTH_RANK[left.health] - HEALTH_RANK[right.health];
                if (healthCompare !== 0) return healthCompare;
                return left.displayName.localeCompare(right.displayName, "tr");
            });

            const totals = {
                total: rows.length,
                healthy: 0,
                attention: 0,
                critical: 0,
                unknown: 0
            };
            for (const row of rows) {
                if (HEALTH_STATES.includes(row.health)) totals[row.health] += 1;
            }

            return Object.freeze({
                schemaVersion: 1,
                generatedAt: observedAt.toISOString(),
                totals: Object.freeze(totals),
                tenants: Object.freeze(rows)
            });
        }
    });
}

module.exports = {
    HEALTH_STATES,
    createPlatformSupportOverviewService,
    deriveHealth,
    mapWithConcurrency,
    normalizeConcurrency,
    normalizeLimit,
    projectLastError,
    summarizeSecurity
};
