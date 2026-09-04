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

function createTenantOperationsService({
    tenantRegistry,
    usageTelemetry,
    entitlementService,
    finOpsService,
    securitySignals,
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

            const [dailyUsage, monthlyUsage, cost, signals, readiness] = await Promise.all([
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
                backup: monthlyUsage.backup || Object.freeze({
                    sizeBytes: 0,
                    objectCount: 0,
                    verifiedAt: null,
                    restoreDrillAt: null,
                    restoreDrillStatus: "unknown"
                }),
                security: summarizeSignals(signals)
            });
        }
    });
}

module.exports = {
    createTenantOperationsService,
    summarizeSignals
};
