const { requireTenantId } = require("../tenant/tenant-id");

const PLAN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function fail(label) {
    throw new TypeError(`Customer readiness ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readOwn(record, key) {
    if (!record || typeof record !== "object") {
        return Object.freeze({ exists: false, safe: false, value: undefined });
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return Object.freeze({ exists: false, safe: true, value: undefined });
    }

    return Object.hasOwn(descriptor, "value")
        ? Object.freeze({ exists: true, safe: true, value: descriptor.value })
        : Object.freeze({ exists: true, safe: false, value: undefined });
}

function canonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 &&
        new Date(timestamp).toISOString() === value
        ? value
        : null;
}

function readinessResult({ tenantId, status, code, observedAt }) {
    return Object.freeze({
        source: "plan",
        tenantId,
        status,
        code,
        observedAt
    });
}

function requireAdapterTenantId(input) {
    if (!isPlainRecord(input)) {
        fail("plan adapter request");
    }

    const field = readOwn(input, "tenantId");
    if (!field.exists || !field.safe || typeof field.value !== "string") {
        fail("plan tenantId");
    }

    const tenantId = requireTenantId(field.value);
    if (tenantId !== field.value) {
        fail("plan tenantId");
    }

    return tenantId;
}

function requireTenant(input, tenantId) {
    const field = readOwn(input, "tenant");
    if (!field.exists || !field.safe || !isPlainRecord(field.value)) {
        fail("plan tenant");
    }

    const recordTenantId = readOwn(field.value, "tenantId");
    if (!recordTenantId.exists || !recordTenantId.safe ||
        typeof recordTenantId.value !== "string") {
        fail("plan tenant scope");
    }

    const canonicalTenantId = requireTenantId(recordTenantId.value);
    if (canonicalTenantId !== recordTenantId.value ||
        canonicalTenantId !== tenantId) {
        fail("plan tenant scope");
    }

    return field.value;
}

function requireDependencies(guardrailsConfig, entitlementService) {
    if (!isPlainRecord(guardrailsConfig)) {
        fail("plan config");
    }

    const plans = readOwn(guardrailsConfig, "plans");
    if (!plans.exists || !plans.safe || !isPlainRecord(plans.value)) {
        fail("plan config");
    }

    if (!isPlainRecord(entitlementService)) {
        fail("plan entitlement service");
    }
    const resolvePolicy = readOwn(entitlementService, "resolvePolicy");
    if (!resolvePolicy.exists || !resolvePolicy.safe ||
        typeof resolvePolicy.value !== "function") {
        fail("plan entitlement service");
    }

    return Object.freeze({
        plans: plans.value,
        resolvePolicy: resolvePolicy.value
    });
}

function createPlanReadinessAdapter({
    guardrailsConfig = null,
    entitlementService = null
} = {}) {
    return Object.freeze({
        evaluate(input) {
            const tenantId = requireAdapterTenantId(input);
            const tenant = requireTenant(input, tenantId);
            const dependencies = requireDependencies(
                guardrailsConfig,
                entitlementService
            );
            const updatedAt = readOwn(tenant, "updatedAt");
            const observedAt = updatedAt.exists && updatedAt.safe
                ? canonicalTimestamp(updatedAt.value)
                : null;
            const planField = readOwn(tenant, "plan");

            if (!planField.exists || (planField.safe &&
                (planField.value === undefined ||
                    planField.value === null ||
                    planField.value === ""))) {
                return readinessResult({
                    tenantId,
                    status: "pending",
                    code: "PLAN_NOT_CONFIGURED",
                    observedAt
                });
            }

            if (!planField.safe || typeof planField.value !== "string" ||
                !PLAN_ID_PATTERN.test(planField.value)) {
                return readinessResult({
                    tenantId,
                    status: "blocked",
                    code: "PLAN_UNSUPPORTED",
                    observedAt
                });
            }

            const plan = planField.value;
            const catalogEntry = readOwn(dependencies.plans, plan);
            if (!catalogEntry.exists) {
                return readinessResult({
                    tenantId,
                    status: "blocked",
                    code: "PLAN_UNSUPPORTED",
                    observedAt
                });
            }
            if (!catalogEntry.safe || !isPlainRecord(catalogEntry.value)) {
                fail("plan catalog");
            }

            const policy = dependencies.resolvePolicy.call(
                entitlementService,
                Object.freeze({
                    tenant: Object.freeze({ tenantId, plan })
                })
            );
            if (!isPlainRecord(policy)) {
                fail("plan entitlement policy");
            }

            const resolvedPlan = readOwn(policy, "plan");
            const usedDefaultPlanPolicy = readOwn(
                policy,
                "usedDefaultPlanPolicy"
            );
            if (!resolvedPlan.exists || !resolvedPlan.safe ||
                typeof resolvedPlan.value !== "string" ||
                !usedDefaultPlanPolicy.exists ||
                !usedDefaultPlanPolicy.safe ||
                typeof usedDefaultPlanPolicy.value !== "boolean" ||
                resolvedPlan.value !== plan ||
                usedDefaultPlanPolicy.value !== false) {
                fail("plan entitlement policy");
            }

            return readinessResult({
                tenantId,
                status: "ready",
                code: null,
                observedAt
            });
        }
    });
}

module.exports = {
    createPlanReadinessAdapter
};
