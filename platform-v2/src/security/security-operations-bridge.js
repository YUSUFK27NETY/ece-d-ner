const {
    securityEventFromAuthAnomaly,
    securityEventFromAuthFailure,
    securityEventFromDestructiveOperationAttempt,
    securityEventFromPrivilegeChange,
    securityEventFromTenantBoundary,
    securityEventFromStepUpDenial
} = require("./security-alert-adapters");
const { assertFlatSecurityInput } = require("./security-alert-model");
const { requireTenantId } = require("../tenant/tenant-id");

const AUTH_FAILURE_INPUT_FIELDS = new Set(["statusCode", "actorId", "requestId"]);
const TENANT_BOUNDARY_INPUT_FIELDS = new Set([
    "context", "errorCode", "operation", "requestId", "targetTenantId"
]);
const TENANT_BOUNDARY_CONTEXT_FIELDS = new Set(["tenantId", "actorId"]);
const STEP_UP_DENIAL_INPUT_FIELDS = new Set(["result", "tenantId", "requestId"]);
const PRIVILEGE_CHANGE_INPUT_FIELDS = new Set(["context", "operation", "requestId"]);
const PRIVILEGE_CHANGE_CONTEXT_FIELDS = new Set(["actorId"]);
const DESTRUCTIVE_OPERATION_INPUT_FIELDS = new Set(["context", "operation", "requestId"]);
const DESTRUCTIVE_OPERATION_CONTEXT_FIELDS = new Set(["tenantId", "actorId"]);

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

function assertStepUpDenialInput(input) {
    assertFlatSecurityInput(input, "result");
    assertAllowedFields(input, STEP_UP_DENIAL_INPUT_FIELDS, "Step-up denial");

    if (!Object.hasOwn(input, "result") || !input.result ||
        typeof input.result !== "object") {
        throw new TypeError("Step-up denial issued decision gerekli.");
    }
    if (!Object.hasOwn(input, "requestId") || input.requestId === null ||
        input.requestId === undefined) {
        throw new TypeError("Step-up denial requestId gerekli.");
    }
    if (input.tenantId !== undefined && input.tenantId !== null) {
        if (typeof input.tenantId !== "string" ||
            requireTenantId(input.tenantId) !== input.tenantId) {
            throw new TypeError("Step-up denial tenantId geçersiz.");
        }
    }
}

function assertOperationInput(input, inputFields, contextFields, label) {
    assertFlatSecurityInput(input, "context");
    assertAllowedFields(input, inputFields, label);
    if (!input.context || typeof input.context !== "object") {
        throw new TypeError(`${label} trusted context gerekli.`);
    }
    assertAllowedFields(input.context, contextFields, `${label} trusted context`);
    if (!Object.hasOwn(input, "operation") || typeof input.operation !== "string") {
        throw new TypeError(`${label} operation gerekli.`);
    }
    if (!Object.hasOwn(input, "requestId") || input.requestId === null ||
        input.requestId === undefined) {
        throw new TypeError(`${label} requestId gerekli.`);
    }
}

function createSecurityOperationsBridge({ alertService }) {
    if (!alertService || typeof alertService.record !== "function") {
        throw new TypeError("Central security alert service gerekli.");
    }

    return Object.freeze({
        async recordAuthAnomaly(observation) {
            const event = securityEventFromAuthAnomaly(observation);
            return alertService.record(event);
        },

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
        },

        async recordStepUpDenial(input) {
            assertStepUpDenialInput(input);
            const event = securityEventFromStepUpDenial(input.result, {
                tenantId: input.tenantId ?? null,
                requestId: input.requestId
            });

            return alertService.record(event);
        },

        async recordPrivilegeChange(input) {
            assertOperationInput(
                input,
                PRIVILEGE_CHANGE_INPUT_FIELDS,
                PRIVILEGE_CHANGE_CONTEXT_FIELDS,
                "Privilege change"
            );
            const event = securityEventFromPrivilegeChange({
                context: { actorId: input.context.actorId },
                operation: input.operation,
                requestId: input.requestId
            });

            return alertService.record(event);
        },

        async recordDestructiveOperationAttempt(input) {
            assertOperationInput(
                input,
                DESTRUCTIVE_OPERATION_INPUT_FIELDS,
                DESTRUCTIVE_OPERATION_CONTEXT_FIELDS,
                "Destructive operation"
            );
            const event = securityEventFromDestructiveOperationAttempt({
                context: {
                    tenantId: input.context.tenantId ?? null,
                    actorId: input.context.actorId
                },
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
