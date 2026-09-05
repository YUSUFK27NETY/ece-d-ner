const {
    securityEventFromAuthFailure,
    securityEventFromTenantBoundary
} = require("./security-alert-adapters");
const { assertFlatSecurityInput } = require("./security-alert-model");
const { requireTenantId } = require("../tenant/tenant-id");

const AUTH_FAILURE_INPUT_FIELDS = new Set(["statusCode", "actorId", "requestId"]);
const TENANT_BOUNDARY_INPUT_FIELDS = new Set([
    "context", "errorCode", "operation", "requestId", "targetTenantId"
]);
const TENANT_BOUNDARY_CONTEXT_FIELDS = new Set(["tenantId", "actorId"]);

function assertAllowedFields(input, allowed, label) {
    for (const key of Reflect.ownKeys(input)) {
        if (!allowed.has(key)) {
            throw new TypeError(`${label} input alanı geçersiz.`);
        }
    }
}

function assertAuthFailureInput(input) {
    assertFlatSecurityInput(input);
    assertAllowedFields(input, AUTH_FAILURE_INPUT_FIELDS, "Security auth failure");

    if (![401, 403].includes(input.statusCode)) {
        throw new TypeError("Security auth failure yalnız 401/403 kabul eder.");
    }
    if (!Object.hasOwn(input, "requestId") || input.requestId === null ||
        input.requestId === undefined) {
        throw new TypeError("Security auth failure requestId gerekli.");
    }
    if (input.statusCode === 401 && input.actorId !== null && input.actorId !== undefined) {
        throw new TypeError("401 security auth failure actor içeremez.");
    }
    if (input.statusCode === 403 && (input.actorId === null || input.actorId === undefined)) {
        throw new TypeError("403 security auth failure verified actor gerekli.");
    }
}

function assertTenantBoundaryInput(input) {
    assertFlatSecurityInput(input, "context");
    assertAllowedFields(input, TENANT_BOUNDARY_INPUT_FIELDS, "Tenant boundary");

    if (!input.context || typeof input.context !== "object") {
        throw new TypeError("Tenant boundary trusted context gerekli.");
    }
    assertAllowedFields(
        input.context,
        TENANT_BOUNDARY_CONTEXT_FIELDS,
        "Tenant boundary trusted context"
    );
    if (!["TENANT_SCOPE_MISMATCH", "TENANT_BOUNDARY_VIOLATION"].includes(input.errorCode)) {
        throw new TypeError("Tenant boundary reason code geçersiz.");
    }
    if (!Object.hasOwn(input, "operation") || input.operation === null ||
        input.operation === undefined) {
        throw new TypeError("Tenant boundary operation gerekli.");
    }
    if (!Object.hasOwn(input, "requestId") || input.requestId === null ||
        input.requestId === undefined) {
        throw new TypeError("Tenant boundary requestId gerekli.");
    }
    if (input.targetTenantId !== undefined && input.targetTenantId !== null) {
        if (typeof input.targetTenantId !== "string" ||
            requireTenantId(input.targetTenantId) !== input.targetTenantId) {
            throw new TypeError("Tenant boundary target tenantId geçersiz.");
        }
    }
}

function createSecurityOperationsBridge({ alertService }) {
    if (!alertService || typeof alertService.record !== "function") {
        throw new TypeError("Central security alert service gerekli.");
    }

    return Object.freeze({
        async recordAuthFailure(input) {
            assertAuthFailureInput(input);
            const event = securityEventFromAuthFailure({
                statusCode: input.statusCode,
                actorId: input.statusCode === 401 ? null : input.actorId,
                requestId: input.requestId,
                tenantId: null,
                operation: "platform.admin.auth"
            });

            return alertService.record(event);
        },

        async recordTenantBoundaryViolation(input) {
            assertTenantBoundaryInput(input);
            const event = securityEventFromTenantBoundary({
                context: {
                    tenantId: input.context.tenantId,
                    actorId: input.context.actorId
                },
                errorCode: input.errorCode,
                operation: input.operation,
                requestId: input.requestId
            });

            return alertService.record(event);
        }
    });
}

module.exports = {
    createSecurityOperationsBridge
};
