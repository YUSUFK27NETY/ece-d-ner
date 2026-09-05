const { buildStepUpAuditMetadata } = require("../auth/platform-admin-step-up");
const {
    assertFlatSecurityInput, normalizeSecurityEvent, optionalTenantId, SECURITY_EVENT_OPERATIONS
} = require("./security-alert-model");

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

module.exports = { securityEventFromStepUpDenial, securityEventFromTenantBoundary, securityEventFromAuthFailure };
