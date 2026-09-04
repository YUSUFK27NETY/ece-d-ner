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

function createTenantOperationsService({
    tenantRegistry,
    usageTelemetry,
    entitlementService,
    finOpsService,
    securitySignals,
    backupEvidenceProvider = null,
    checkReadiness = null,
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

            const [dailyUsage, monthlyUsage, cost, signals, readiness, backupEvidence] = await Promise.all([
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
                security: summarizeSignals(signals)
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
