const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { createFeatureFlags, FEATURE_CATALOG } = require("../tenant/feature-catalog");
const { requireTenantId } = require("../tenant/tenant-id");

const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const PLAN_PREVIEW_CHANGES = Object.freeze([
    "gained",
    "lost",
    "unchanged"
]);
const LIMIT_PREVIEW_CHANGES = Object.freeze([
    "increased",
    "decreased",
    "unchanged"
]);
const issuedCatalogs = new WeakSet();
const issuedPreviews = new WeakSet();

function fail(label) {
    throw new TypeError(`Commercial plan preview ${label} geçersiz.`);
}

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function readOwn(record, key, label) {
    if (!record || typeof record !== "object") {
        fail(label);
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail(label);
    }

    return descriptor.value;
}

function assertExactInput(input) {
    if (!isPlainRecord(input)) {
        fail("request");
    }

    const allowed = ["context", "tenantId", "tenant", "targetPlan"];
    const keys = Reflect.ownKeys(input);
    if (keys.length !== allowed.length || keys.some(key =>
        typeof key !== "string" || !allowed.includes(key))) {
        fail("request");
    }

    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail("request");
        }
    }

    return input;
}

function requireCanonicalTenantId(value, label = "tenantId") {
    if (typeof value !== "string") {
        fail(label);
    }

    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail(label);
    }

    return tenantId;
}

function requirePlatformAdminContext(value, tenantId = null) {
    if (!isPlainRecord(value)) {
        fail("context");
    }

    const roleDescriptor = Object.getOwnPropertyDescriptor(value, "role");
    if (!roleDescriptor || !Object.hasOwn(roleDescriptor, "value") ||
        roleDescriptor.value !== "platform_admin") {
        throw safeError(
            "PERMISSION_DENIED",
            "Commercial plan preview için Platform Admin yetkisi gerekli."
        );
    }

    const context = Object.freeze({
        role: "platform_admin",
        tenantId: null
    });
    if (tenantId !== null) {
        authorizeTenantAction({
            context,
            tenantId,
            permission: "tenant.read"
        });
    }

    return context;
}

function configuredPlanIds(config) {
    if (!isPlainRecord(config)) {
        fail("config");
    }
    const plans = readOwn(config, "plans", "config plans");
    if (!isPlainRecord(plans)) {
        fail("config plans");
    }

    const ids = Reflect.ownKeys(plans);
    if (ids.length === 0 || ids.some(planId =>
        typeof planId !== "string" || !PLAN_ID_PATTERN.test(planId))) {
        fail("config plans");
    }
    for (const planId of ids) {
        const descriptor = Object.getOwnPropertyDescriptor(plans, planId);
        if (!descriptor || !Object.hasOwn(descriptor, "value") ||
            !isPlainRecord(descriptor.value)) {
            fail("config plan");
        }
    }

    return Object.freeze([...ids].sort());
}

function normalizeFeatureFlags(value) {
    if (!isPlainRecord(value)) {
        fail("tenant features");
    }

    const overrides = {};
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !Object.hasOwn(FEATURE_CATALOG, key)) {
            fail("tenant features");
        }
        const feature = readOwn(value, key, "tenant feature");
        if (typeof feature !== "boolean") {
            fail("tenant feature");
        }
        overrides[key] = feature;
    }

    return createFeatureFlags(overrides);
}

function normalizeTenant(value, expectedTenantId) {
    if (!isPlainRecord(value)) {
        fail("tenant");
    }

    const tenantId = requireCanonicalTenantId(
        readOwn(value, "tenantId", "tenant tenantId"),
        "tenant tenantId"
    );
    if (tenantId !== expectedTenantId) {
        throw safeError(
            "TENANT_SCOPE_MISMATCH",
            "Commercial plan preview tenant kapsamı eşleşmiyor."
        );
    }

    const plan = readOwn(value, "plan", "tenant plan");
    if (typeof plan !== "string" || !PLAN_ID_PATTERN.test(plan)) {
        fail("tenant plan");
    }
    const features = normalizeFeatureFlags(
        readOwn(value, "features", "tenant features")
    );

    return Object.freeze({ tenantId, plan, features });
}

function requireTargetPlan(value, planIds) {
    if (typeof value !== "string" || !PLAN_ID_PATTERN.test(value)) {
        throw safeError(
            "TARGET_PLAN_NOT_CONFIGURED",
            "Hedef plan yapılandırılmamış."
        );
    }
    if (!planIds.includes(value)) {
        throw safeError(
            "TARGET_PLAN_NOT_CONFIGURED",
            "Hedef plan yapılandırılmamış."
        );
    }

    return value;
}

function projectPolicy(policy, expectedPlan, expectedFallback) {
    if (!isPlainRecord(policy) ||
        readOwn(policy, "plan", "policy plan") !== expectedPlan ||
        readOwn(policy, "usedDefaultPlanPolicy", "policy fallback") !==
            expectedFallback) {
        fail("entitlement policy");
    }

    const softRequestLimit = readOwn(
        policy,
        "softRequestLimit",
        "policy softRequestLimit"
    );
    const warningThreshold = readOwn(
        policy,
        "warningThreshold",
        "policy warningThreshold"
    );
    const dedicatedReviewThreshold = readOwn(
        policy,
        "dedicatedReviewThreshold",
        "policy dedicatedReviewThreshold"
    );
    if (softRequestLimit !== null &&
        (!Number.isSafeInteger(softRequestLimit) || softRequestLimit < 1)) {
        fail("policy softRequestLimit");
    }
    if (!Number.isFinite(warningThreshold) || warningThreshold <= 0 ||
        !Number.isFinite(dedicatedReviewThreshold) ||
        dedicatedReviewThreshold < 1) {
        fail("policy thresholds");
    }

    return Object.freeze({
        softRequestLimit,
        warningThreshold,
        dedicatedReviewThreshold
    });
}

function projectEntitlement(result, {
    tenantId,
    plan,
    feature,
    tenantEnabled,
    usedDefaultPlanPolicy
}) {
    if (!isPlainRecord(result) ||
        readOwn(result, "tenantId", "entitlement tenantId") !== tenantId ||
        readOwn(result, "plan", "entitlement plan") !== plan ||
        readOwn(result, "feature", "entitlement feature") !== feature ||
        readOwn(result, "usedDefaultPlanPolicy", "entitlement fallback") !==
            usedDefaultPlanPolicy) {
        fail("entitlement result");
    }

    const planAllowed = readOwn(
        result,
        "planAllowsFeature",
        "entitlement plan allowance"
    );
    const projectedTenantEnabled = readOwn(
        result,
        "tenantFeatureEnabled",
        "entitlement tenant feature"
    );
    const effective = readOwn(
        result,
        "featureEnabled",
        "entitlement effective feature"
    );
    if ([planAllowed, projectedTenantEnabled, effective]
        .some(value => typeof value !== "boolean") ||
        projectedTenantEnabled !== tenantEnabled ||
        effective !== (tenantEnabled && planAllowed)) {
        fail("entitlement booleans");
    }

    return Object.freeze({ planAllowed, effective });
}

function featureChange(currentEffective, targetEffective) {
    if (!currentEffective && targetEffective) return "gained";
    if (currentEffective && !targetEffective) return "lost";
    return "unchanged";
}

function limitChange(current, target) {
    const currentValue = current === null ? Number.POSITIVE_INFINITY : current;
    const targetValue = target === null ? Number.POSITIVE_INFINITY : target;
    if (targetValue > currentValue) return "increased";
    if (targetValue < currentValue) return "decreased";
    return "unchanged";
}

function projectLimit(current, target) {
    return Object.freeze({
        current,
        target,
        change: limitChange(current, target)
    });
}

function assertCommercialPlanCatalog(catalog) {
    if (!catalog || typeof catalog !== "object" ||
        !issuedCatalogs.has(catalog)) {
        fail("catalog read model");
    }
    return catalog;
}

function assertCommercialPlanPreview(preview) {
    if (!preview || typeof preview !== "object" ||
        !issuedPreviews.has(preview)) {
        fail("preview read model");
    }
    return preview;
}

function createCommercialPlanPreviewService({ config, entitlementService }) {
    const planIds = configuredPlanIds(config);
    if (!entitlementService ||
        typeof entitlementService.evaluate !== "function" ||
        typeof entitlementService.resolvePolicy !== "function") {
        fail("entitlement service");
    }

    const catalog = Object.freeze({
        schemaVersion: 1,
        planIds
    });
    issuedCatalogs.add(catalog);

    return Object.freeze({
        getCatalog({ context }) {
            requirePlatformAdminContext(context);
            return catalog;
        },

        preview(input) {
            const request = assertExactInput(input);
            const tenantId = requireCanonicalTenantId(
                readOwn(request, "tenantId", "tenantId")
            );
            requirePlatformAdminContext(
                readOwn(request, "context", "context"),
                tenantId
            );
            const targetPlan = requireTargetPlan(
                readOwn(request, "targetPlan", "targetPlan"),
                planIds
            );
            const tenant = normalizeTenant(
                readOwn(request, "tenant", "tenant"),
                tenantId
            );
            const currentPlanConfigured = planIds.includes(tenant.plan);
            const currentUsesDefaultPolicyFallback = !currentPlanConfigured;
            const targetTenant = Object.freeze({
                tenantId,
                plan: targetPlan,
                features: tenant.features
            });
            const currentPolicy = projectPolicy(
                entitlementService.resolvePolicy({ tenant }),
                tenant.plan,
                currentUsesDefaultPolicyFallback
            );
            const targetPolicy = projectPolicy(
                entitlementService.resolvePolicy({ tenant: targetTenant }),
                targetPlan,
                false
            );
            const features = Object.freeze(
                Object.keys(FEATURE_CATALOG).map(feature => {
                    const tenantEnabled = tenant.features[feature];
                    const current = projectEntitlement(
                        entitlementService.evaluate({ tenant, feature }),
                        {
                            tenantId,
                            plan: tenant.plan,
                            feature,
                            tenantEnabled,
                            usedDefaultPlanPolicy:
                                currentUsesDefaultPolicyFallback
                        }
                    );
                    const target = projectEntitlement(
                        entitlementService.evaluate({
                            tenant: targetTenant,
                            feature
                        }),
                        {
                            tenantId,
                            plan: targetPlan,
                            feature,
                            tenantEnabled,
                            usedDefaultPlanPolicy: false
                        }
                    );

                    return Object.freeze({
                        feature,
                        tenantEnabled,
                        currentPlanAllowed: current.planAllowed,
                        targetPlanAllowed: target.planAllowed,
                        currentEffective: current.effective,
                        targetEffective: target.effective,
                        change: featureChange(
                            current.effective,
                            target.effective
                        )
                    });
                })
            );
            const limits = Object.freeze({
                softRequestLimit: projectLimit(
                    currentPolicy.softRequestLimit,
                    targetPolicy.softRequestLimit
                ),
                warningThreshold: projectLimit(
                    currentPolicy.warningThreshold,
                    targetPolicy.warningThreshold
                ),
                dedicatedReviewThreshold: projectLimit(
                    currentPolicy.dedicatedReviewThreshold,
                    targetPolicy.dedicatedReviewThreshold
                )
            });
            const preview = Object.freeze({
                schemaVersion: 1,
                tenantId,
                currentPlan: tenant.plan,
                targetPlan,
                currentPlanConfigured,
                currentUsesDefaultPolicyFallback,
                automaticApply: false,
                features,
                limits
            });
            issuedPreviews.add(preview);
            return preview;
        }
    });
}

module.exports = {
    LIMIT_PREVIEW_CHANGES,
    PLAN_PREVIEW_CHANGES,
    assertCommercialPlanCatalog,
    assertCommercialPlanPreview,
    createCommercialPlanPreviewService
};
