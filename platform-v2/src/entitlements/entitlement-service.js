const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { createFeatureFlags, FEATURE_CATALOG } = require("../tenant/feature-catalog");
const { requireTenantId } = require("../tenant/tenant-id");

function resolveTenantPolicy({ tenant, config }) {
    const tenantId = requireTenantId(tenant?.tenantId);
    const plan = String(tenant?.plan || "default").trim().toLowerCase();
    const hasPlanPolicy = Object.prototype.hasOwnProperty.call(config.plans, plan);
    const planPolicy = hasPlanPolicy ? config.plans[plan] : config.plans.default;
    const tenantOverride = Object.prototype.hasOwnProperty.call(config.tenantOverrides, tenantId)
        ? config.tenantOverrides[tenantId]
        : {};
    const overrideOr = (key, fallback) =>
        Object.prototype.hasOwnProperty.call(tenantOverride, key)
            ? tenantOverride[key]
            : fallback;

    return Object.freeze({
        plan,
        usedDefaultPlanPolicy: !hasPlanPolicy,
        allowedFeatures: overrideOr("allowedFeatures", planPolicy.allowedFeatures),
        softRequestLimit: overrideOr("softRequestLimit", planPolicy.softRequestLimit),
        warningThreshold: overrideOr("warningThreshold", planPolicy.warningThreshold),
        dedicatedReviewThreshold:
            overrideOr("dedicatedReviewThreshold", planPolicy.dedicatedReviewThreshold),
        monthlyRevenueReference:
            overrideOr(
                "monthlyRevenueReference",
                planPolicy.monthlyRevenueReference ?? config.finops.defaultMonthlyRevenue
            )
    });
}

function evaluateUsageLimit({ usage, softLimit, warningThreshold, dedicatedReviewThreshold }) {
    const safeUsage = Number(usage ?? 0);

    if (!Number.isFinite(safeUsage) || safeUsage < 0) {
        throw new TypeError("Entitlement usage geçersiz.");
    }

    if (softLimit === null) {
        return Object.freeze({
            softLimit: null,
            usage: safeUsage,
            usageRatio: null,
            status: "unlimited",
            warning: false,
            dedicatedReview: false,
            autoDisabled: false
        });
    }

    const ratio = safeUsage / softLimit;
    const warning = ratio >= warningThreshold;
    const overLimit = ratio >= 1;

    return Object.freeze({
        softLimit,
        usage: safeUsage,
        usageRatio: ratio,
        status: overLimit ? "over_limit" : warning ? "warning" : "normal",
        warning,
        dedicatedReview: ratio >= dedicatedReviewThreshold,
        autoDisabled: false
    });
}

function evaluateTenantEntitlement({ tenant, feature, currentUsage = 0, config }) {
    const tenantId = requireTenantId(tenant?.tenantId);
    const safeFeature = String(feature ?? "").trim();

    if (!(safeFeature in FEATURE_CATALOG)) {
        throw new TypeError("Entitlement feature geçersiz.");
    }

    const policy = resolveTenantPolicy({ tenant, config });
    const flags = createFeatureFlags(tenant.features || {});
    const planAllows = policy.allowedFeatures === "*" ||
        policy.allowedFeatures.includes(safeFeature);
    const featureEnabled = flags[safeFeature] === true && planAllows;
    const limit = evaluateUsageLimit({
        usage: currentUsage,
        softLimit: policy.softRequestLimit,
        warningThreshold: policy.warningThreshold,
        dedicatedReviewThreshold: policy.dedicatedReviewThreshold
    });

    return Object.freeze({
        tenantId,
        plan: policy.plan,
        feature: safeFeature,
        featureEnabled,
        planAllowsFeature: planAllows,
        tenantFeatureEnabled: flags[safeFeature],
        limit,
        monthlyRevenueReference: policy.monthlyRevenueReference,
        usedDefaultPlanPolicy: policy.usedDefaultPlanPolicy
    });
}

function createEntitlementService({ config, securitySignals = null }) {
    if (!config?.plans?.default || !config?.finops) {
        throw new TypeError("Entitlement config gerekli.");
    }

    return Object.freeze({
        evaluate(input) {
            return evaluateTenantEntitlement({ ...input, config });
        },

        assertFeatureAccess({
            context,
            tenant,
            permission,
            feature,
            currentUsage = 0
        }) {
            authorizeTenantAction({
                context,
                tenantId: tenant?.tenantId,
                permission
            });
            const result = evaluateTenantEntitlement({
                tenant,
                feature,
                currentUsage,
                config
            });

            if (!result.featureEnabled) {
                const error = new Error("Bu özellik tenant için etkin değil.");
                error.code = "ENTITLEMENT_DENIED";
                throw error;
            }

            return result;
        },

        async evaluateAndSignal({
            tenant,
            feature,
            currentUsage = 0,
            requestId = null,
            operation = "entitlement.evaluate"
        }) {
            const result = evaluateTenantEntitlement({
                tenant,
                feature,
                currentUsage,
                config
            });

            if (securitySignals && result.limit.warning) {
                await securitySignals.emit({
                    tenantId: result.tenantId,
                    type: "quota_warning",
                    severity: result.limit.status === "over_limit" ? "critical" : "warning",
                    requestId,
                    operation,
                    metadata: {
                        usageRatio: result.limit.usageRatio,
                        threshold: result.limit.softLimit,
                        plan: result.plan
                    }
                });
            }

            if (securitySignals && result.limit.dedicatedReview) {
                await securitySignals.emit({
                    tenantId: result.tenantId,
                    type: "upper_plan_review",
                    severity: "warning",
                    requestId,
                    operation,
                    metadata: {
                        usageRatio: result.limit.usageRatio,
                        plan: result.plan
                    }
                });
            }

            return result;
        }
    });
}

module.exports = {
    createEntitlementService,
    evaluateTenantEntitlement,
    evaluateUsageLimit,
    resolveTenantPolicy
};
