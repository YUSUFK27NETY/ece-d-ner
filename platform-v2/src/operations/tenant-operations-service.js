const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { FEATURE_CATALOG } = require("../tenant/feature-catalog");
const { requireTenantId } = require("../tenant/tenant-id");

function summarizeSignals(signals) {
    const byType = {};
    let highestSeverity = "none";
    const severityRank = { none: 0, info: 1, warning: 2, critical: 3 };

    for (const signal of signals) {
        byType[signal.type] = (byType[signal.type] || 0) + signal.count;
        if (severityRank[signal.severity] > severityRank[highestSeverity]) {
            highestSeverity = signal.severity;
        }
    }

    return Object.freeze({
        total: signals.reduce((sum, signal) => sum + signal.count, 0),
        highestSeverity,
        byType: Object.freeze(byType),
        recent: Object.freeze(signals)
    });
}

const BACKUP_DRILL_STATUSES = new Set(["passed", "failed", "dry_run", "unknown"]);

function normalizeBackupSummary(input) {
    const backup = input && typeof input === "object" && !Array.isArray(input) ? input : {};
    const sizeBytes = Number(backup.sizeBytes);
    const objectCount = Number(backup.objectCount);
    const verifiedAt = backup.verifiedAt && !Number.isNaN(new Date(backup.verifiedAt).getTime())
        ? new Date(backup.verifiedAt).toISOString()
        : null;
    const restoreDrillAt = backup.restoreDrillAt &&
        !Number.isNaN(new Date(backup.restoreDrillAt).getTime())
        ? new Date(backup.restoreDrillAt).toISOString()
        : null;
    const status = String(backup.restoreDrillStatus ?? "unknown").trim().toLowerCase();

    return Object.freeze({
        sizeBytes: Number.isInteger(sizeBytes) && sizeBytes >= 0 ? sizeBytes : 0,
        objectCount: Number.isInteger(objectCount) && objectCount >= 0 ? objectCount : 0,
        verifiedAt,
        restoreDrillAt,
        restoreDrillStatus: BACKUP_DRILL_STATUSES.has(status) ? status : "unknown"
    });
}

function mergeBackupSummaries(telemetryBackup, evidenceBackup) {
    const telemetry = normalizeBackupSummary(telemetryBackup);
    const evidence = normalizeBackupSummary(evidenceBackup);
    const verifiedAt = [telemetry.verifiedAt, evidence.verifiedAt]
        .filter(Boolean)
        .sort()
        .at(-1) || null;
    const drillCandidates = [telemetry, evidence]
        .filter(item => item.restoreDrillAt)
        .sort((a, b) => a.restoreDrillAt.localeCompare(b.restoreDrillAt));
    const latestDrill = drillCandidates.at(-1) || null;

    return Object.freeze({
        sizeBytes: evidence.objectCount > 0 ? evidence.sizeBytes : telemetry.sizeBytes,
        objectCount: evidence.objectCount > 0 ? evidence.objectCount : telemetry.objectCount,
        verifiedAt,
        restoreDrillAt: latestDrill?.restoreDrillAt || null,
        restoreDrillStatus: latestDrill?.restoreDrillStatus || "unknown"
    });
}

function optionalService(service, method, label) {
    if (service !== null && typeof service?.[method] !== "function") {
        throw new TypeError(`Tenant operations ${label} service geçersiz.`);
    }
}

function elapsedUtcDaySeconds(at) {
    const date = at instanceof Date ? at : new Date(at);
    if (Number.isNaN(date.getTime())) throw new TypeError("Tenant operations tarihi geçersiz.");
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return Math.max(1, Math.floor((date.getTime() - start) / 1000) + 1);
}

function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function createTenantOperationsService({
    tenantRegistry,
    usageTelemetry,
    entitlementService,
    finOpsService,
    securitySignals,
    backupEvidenceProvider = null,
    checkReadiness = null,
    capacityService = null,
    routingService = null,
    migrationService = null,
    jobQueue = null,
    tenantCache = null,
    rolloutService = null,
    resilienceService = null,
    signalListLimit = 20
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Tenant operations registry gerekli.");
    }
    if (!usageTelemetry || typeof usageTelemetry.getAggregate !== "function") {
        throw new TypeError("Tenant operations telemetry gerekli.");
    }
    if (!entitlementService || typeof entitlementService.evaluate !== "function") {
        throw new TypeError("Tenant operations entitlement service gerekli.");
    }
    if (!finOpsService || typeof finOpsService.getTenantEstimate !== "function") {
        throw new TypeError("Tenant operations FinOps service gerekli.");
    }
    if (!securitySignals || typeof securitySignals.listTenant !== "function") {
        throw new TypeError("Tenant operations security signal service gerekli.");
    }
    if (backupEvidenceProvider !== null &&
        typeof backupEvidenceProvider?.getStatus !== "function") {
        throw new TypeError("Tenant operations backup evidence provider geçersiz.");
    }
    optionalService(capacityService, "evaluate", "capacity");
    optionalService(routingService, "resolve", "routing");
    optionalService(migrationService, "getTenantStatus", "migration");
    optionalService(jobQueue, "getSummary", "queue");
    optionalService(tenantCache, "getSummary", "cache");
    optionalService(rolloutService, "getStatus", "rollout");
    optionalService(resilienceService, "getSummary", "resilience");

    return Object.freeze({
        async getOverview({ context, tenantId, at = new Date() }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "tenant.operations.read"
            });
            const tenant = await tenantRegistry.getById(safeTenantId);

            if (!tenant) {
                const error = new Error("İşletme bulunamadı.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }

            const [
                dailyUsage, monthlyUsage, cost, signals, readiness, backupEvidence,
                placementResult, migrationResult, queueResult, cacheResult, releaseResult
            ] = await Promise.all([
                usageTelemetry.getAggregate({ context, tenantId: safeTenantId, period: "daily", at }),
                usageTelemetry.getAggregate({ context, tenantId: safeTenantId, period: "monthly", at }),
                finOpsService.getTenantEstimate({ context, tenantId: safeTenantId, at }),
                securitySignals.listTenant({
                    context,
                    tenantId: safeTenantId,
                    limit: signalListLimit
                }),
                checkReadiness
                    ? Promise.resolve().then(checkReadiness).catch(() => ({ ready: false, checks: {} }))
                    : Promise.resolve(null),
                backupEvidenceProvider
                    ? Promise.resolve()
                        .then(() => backupEvidenceProvider.getStatus({ tenantId: safeTenantId }))
                        .catch(() => null)
                    : Promise.resolve(null),
                routingService
                    ? Promise.resolve().then(() => routingService.resolve({ context, tenantId: safeTenantId })).catch(() => null)
                    : Promise.resolve(null),
                migrationService
                    ? Promise.resolve().then(() => migrationService.getTenantStatus({ context, tenantId: safeTenantId })).catch(() => null)
                    : Promise.resolve(null),
                jobQueue
                    ? Promise.resolve().then(() => jobQueue.getSummary({ context, tenantId: safeTenantId })).catch(() => null)
                    : Promise.resolve(null),
                tenantCache
                    ? Promise.resolve().then(() => tenantCache.getSummary({ context, tenantId: safeTenantId })).catch(() => null)
                    : Promise.resolve(null),
                rolloutService
                    ? Promise.resolve().then(() => rolloutService.getStatus({ context, tenantId: safeTenantId })).catch(() => null)
                    : Promise.resolve(null)
            ]);
            const featureEntitlements = {};

            for (const feature of Object.keys(FEATURE_CATALOG)) {
                featureEntitlements[feature] = entitlementService.evaluate({
                    tenant,
                    feature,
                    currentUsage: monthlyUsage.requestCount
                }).featureEnabled;
            }

            const entitlement = entitlementService.evaluate({
                tenant,
                feature: "catalog",
                currentUsage: monthlyUsage.requestCount
            });
            const providerUsage = monthlyUsage.providerUsage || {};
            const queueBacklog = safeNumber(queueResult?.backlog);
            const capacity = capacityService
                ? capacityService.evaluate({
                    scope: "tenant",
                    tenantId: safeTenantId,
                    metrics: {
                        requestRate: safeNumber(dailyUsage.requestCount) / elapsedUtcDaySeconds(at),
                        latencyP95Ms: safeNumber(dailyUsage.latencyP95Ms, safeNumber(dailyUsage.latencyMaxMs)),
                        latencyP99Ms: safeNumber(dailyUsage.latencyP99Ms, safeNumber(dailyUsage.latencyMaxMs)),
                        errorRate: safeNumber(dailyUsage.requestCount) > 0
                            ? Math.min(1, safeNumber(dailyUsage.errorCount) / safeNumber(dailyUsage.requestCount))
                            : 0,
                        firestoreOperations: safeNumber(providerUsage.firestoreReads) + safeNumber(providerUsage.firestoreWrites),
                        appOperations: safeNumber(monthlyUsage.requestCount),
                        queueBacklog,
                        workerConcurrency: safeNumber(queueResult?.running),
                        workerCapacity: safeNumber(queueResult?.perTenantConcurrency),
                        healthyWorkers: queueResult?.workerHealth === "healthy" ? 1 : 0,
                        totalWorkers: queueResult ? 1 : 0,
                        storageBytes: safeNumber(monthlyUsage.backup?.sizeBytes),
                        bandwidthBytes: safeNumber(providerUsage.r2BandwidthBytes),
                        infraRevenueRatio: safeNumber(cost.infraRevenueRatio)
                    }
                })
                : null;
            let resilience = null;
            if (resilienceService) {
                try {
                    resilience = resilienceService.getSummary();
                } catch {
                    resilience = null;
                }
            }

            return Object.freeze({
                tenantId: safeTenantId,
                generatedAt: (at instanceof Date ? at : new Date(at)).toISOString(),
                health: Object.freeze({
                    readiness: readiness
                        ? (readiness.ready === true ? "ready" : "not_ready")
                        : "unknown",
                    readinessScope: readiness ? "shared_platform" : "unavailable",
                    latencyAverageMs: dailyUsage.latencyAverageMs,
                    latencyMaxMs: dailyUsage.latencyMaxMs,
                    lastError: dailyUsage.lastError || monthlyUsage.lastError
                }),
                usage: Object.freeze({
                    daily: dailyUsage,
                    monthly: monthlyUsage
                }),
                cost,
                plan: Object.freeze({
                    plan: entitlement.plan,
                    featureEntitlements: Object.freeze(featureEntitlements),
                    softLimit: entitlement.limit.softLimit,
                    usage: entitlement.limit.usage,
                    usageRatio: entitlement.limit.usageRatio,
                    limitStatus: entitlement.limit.status,
                    warning: entitlement.limit.warning,
                    dedicatedReview: entitlement.limit.dedicatedReview,
                    autoDisabled: false,
                    usedDefaultPlanPolicy: entitlement.usedDefaultPlanPolicy
                }),
                backup: mergeBackupSummaries(monthlyUsage.backup, backupEvidence),
                security: summarizeSignals(signals),
                placement: Object.freeze({
                    type: placementResult?.placementType || "unknown",
                    placementId: placementResult?.placementId || null,
                    region: placementResult?.region || null,
                    status: placementResult?.status || "unknown",
                    releaseChannel: placementResult?.releaseChannel || null,
                    cohort: placementResult?.cohort || null,
                    version: Number.isInteger(placementResult?.version) ? placementResult.version : null
                }),
                capacity: capacity
                    ? Object.freeze({
                        status: capacity.status,
                        dedicatedReview: capacity.dedicatedReview,
                        sloStatus: capacity.slo.status,
                        availability: capacity.slo.availability,
                        latencyP95Ms: capacity.metrics.latencyP95Ms,
                        latencyP99Ms: capacity.metrics.latencyP99Ms,
                        requestRate: capacity.metrics.requestRate,
                        operationLoad: capacity.metrics.operationLoad
                    })
                    : Object.freeze({ status: "unknown", dedicatedReview: false, sloStatus: "unknown" }),
                migration: Object.freeze({
                    state: migrationResult?.state || "idle",
                    migrationId: migrationResult?.migrationId || null,
                    sourcePlacementType: migrationResult?.sourcePlacementType || null,
                    destinationPlacementType: migrationResult?.destinationPlacementType || null,
                    updatedAt: migrationResult?.updatedAt || null
                }),
                queue: Object.freeze({
                    backlog: safeNumber(queueResult?.backlog),
                    running: safeNumber(queueResult?.running),
                    deadLetter: safeNumber(queueResult?.deadLetter),
                    workerHealth: queueResult?.workerHealth || "unknown",
                    perTenantConcurrency: safeNumber(queueResult?.perTenantConcurrency)
                }),
                cache: Object.freeze({
                    publicEntries: safeNumber(cacheResult?.publicEntries),
                    fresh: safeNumber(cacheResult?.fresh),
                    stale: safeNumber(cacheResult?.stale),
                    privateStored: 0,
                    lastInvalidatedAt: cacheResult?.lastInvalidatedAt || null,
                    invalidatedEntries: safeNumber(cacheResult?.invalidatedEntries)
                }),
                release: Object.freeze({
                    cohort: releaseResult?.cohort || placementResult?.cohort || null,
                    stage: releaseResult?.stage || placementResult?.releaseChannel || "stable",
                    health: releaseResult?.health || "unknown",
                    currentVersion: releaseResult?.currentVersion || null,
                    targetVersion: releaseResult?.targetVersion || null,
                    rollbackSignal: releaseResult?.rollbackSignal === true,
                    automaticApply: false,
                    updatedAt: releaseResult?.updatedAt || null
                }),
                resilience: Object.freeze({
                    status: resilience?.status || "unknown",
                    dependencies: Object.freeze((resilience?.dependencies || []).map(item => Object.freeze({
                        dependency: item.dependency,
                        status: item.status,
                        circuit: item.circuit,
                        consecutiveFailures: safeNumber(item.consecutiveFailures),
                        lastErrorCode: item.lastErrorCode || null
                    })))
                })
            });
        }
    });
}

module.exports = {
    createTenantOperationsService,
    summarizeSignals,
    normalizeBackupSummary,
    mergeBackupSummaries
};
