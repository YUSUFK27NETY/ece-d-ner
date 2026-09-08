const {
    buildStepUpAuditMetadata,
    PLATFORM_ADMIN_OPERATION_RISKS
} = require("../auth/platform-admin-step-up");
const { consumeAuthAnomalyObservation } = require("./abuse-monitor");
const {
    assertFlatSecurityInput, normalizeSecurityEvent, optionalOpaqueId, optionalTenantId,
    SECURITY_EVENT_OPERATIONS
} = require("./security-alert-model");

const PRIVILEGE_CHANGE_OPERATIONS = Object.freeze([
    "platform_admin.claim.grant",
    "platform_admin.claim.revoke",
    "platform_admin.provision"
]);
const privilegeChangeOperations = new Set(PRIVILEGE_CHANGE_OPERATIONS);
const DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS = Object.freeze(
    Object.entries(PLATFORM_ADMIN_OPERATION_RISKS)
        .filter(([operation, riskLevel]) =>
            riskLevel === "high" && !privilegeChangeOperations.has(operation))
        .map(([operation]) => operation)
);
const destructiveOperationAttemptOperations = new Set(
    DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS
);

function securityEventFromStepUpDenial(result, context = {}, options) {
    const decision = buildStepUpAuditMetadata(result);
    if (decision.decision !== "deny") throw new TypeError("Step-up deny kararı gerekli.");
    assertFlatSecurityInput(context);
    return normalizeSecurityEvent({
        eventType: "step_up_denied",
        source: "platform.admin.step_up",
        tenantId: context.tenantId,
        actorId: decision.actorId,
        requestId: context.requestId,
        correlationId: context.correlationId,
        occurredAt: context.occurredAt,
        reasonCode: decision.reasonCode,
        operation: SECURITY_EVENT_OPERATIONS.includes(decision.operation) ? decision.operation : null
    }, options);
}

function securityEventFromTenantBoundary(input, options) {
    assertFlatSecurityInput(input, "context");
    const { context, errorCode, operation = "tenant.access", requestId, correlationId, occurredAt } = input;
    assertFlatSecurityInput(context);
    if (!["TENANT_SCOPE_MISMATCH", "TENANT_BOUNDARY_VIOLATION"].includes(errorCode)) {
        throw new TypeError("Tenant boundary reason code geçersiz.");
    }
    const tenantId = optionalTenantId(context.tenantId);
    if (!tenantId) throw new TypeError("Tenant boundary kaynak tenant context gerekli.");
    return normalizeSecurityEvent({
        eventType: "tenant_boundary_violation",
        source: "tenant.authorization",
        tenantId,
        actorId: context.actorId,
        requestId, correlationId, occurredAt, operation,
        reasonCode: errorCode
    }, options);
}

// One verified server observation per call, not an already aggregated Phase 6 signal count.
function securityEventFromAuthFailure(input, options) {
    assertFlatSecurityInput(input);
    if (input.statusCode !== 401 && input.statusCode !== 403) {
        throw new TypeError("Security auth failure yalnız 401/403 kabul eder.");
    }
    return normalizeSecurityEvent({
        eventType: input.statusCode === 401 ? "repeated_401" : "repeated_403",
        source: "platform.admin.auth",
        tenantId: input.tenantId,
        actorId: input.actorId,
        requestId: input.requestId,
        correlationId: input.correlationId,
        occurredAt: input.occurredAt,
        operation: input.operation === undefined ? "platform.admin.auth" : input.operation,
        reasonCode: input.statusCode === 401 ? "AUTHENTICATION_FAILED" : "PERMISSION_DENIED"
    }, options);
}

function securityEventFromAuthAnomaly(observation, options) {
    const issued = consumeAuthAnomalyObservation(observation);
    return normalizeSecurityEvent({
        eventType: "auth_anomaly",
        source: "security.monitor",
        tenantId: null,
        actorId: null,
        requestId: issued.requestId,
        occurredAt: issued.occurredAt,
        operation: "platform.admin.auth",
        reasonCode: "AUTH_ANOMALY"
    }, options);
}

function requireTrustedActor(context, label) {
    assertFlatSecurityInput(context);
    const actorId = optionalOpaqueId(context.actorId);
    if (!actorId) throw new TypeError(`${label} trusted actor gerekli.`);
    return actorId;
}

function securityEventFromPrivilegeChange(input, options) {
    assertFlatSecurityInput(input, "context");
    const { context, operation, requestId } = input;
    if (!privilegeChangeOperations.has(operation)) {
        throw new TypeError("Privilege change operation geçersiz.");
    }
    return normalizeSecurityEvent({
        eventType: "privilege_change",
        source: "platform.audit",
        tenantId: null,
        actorId: requireTrustedActor(context, "Privilege change"),
        requestId,
        operation,
        reasonCode: "PRIVILEGE_CHANGED"
    }, options);
}

function securityEventFromDestructiveOperationAttempt(input, options) {
    assertFlatSecurityInput(input, "context");
    const { context, operation, requestId } = input;
    if (!destructiveOperationAttemptOperations.has(operation)) {
        throw new TypeError("Destructive operation geçersiz.");
    }
    const actorId = requireTrustedActor(context, "Destructive operation");
    return normalizeSecurityEvent({
        eventType: "destructive_operation_attempt",
        source: "platform.audit",
        tenantId: optionalTenantId(context.tenantId),
        actorId,
        requestId,
        operation,
        reasonCode: "DESTRUCTIVE_OPERATION_ATTEMPT"
    }, options);
}

module.exports = {
    PRIVILEGE_CHANGE_OPERATIONS,
    DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS,
    securityEventFromStepUpDenial,
    securityEventFromTenantBoundary,
    securityEventFromAuthFailure,
    securityEventFromAuthAnomaly,
    securityEventFromPrivilegeChange,
    securityEventFromDestructiveOperationAttempt
};
