const { securityEventFromAuthFailure } = require("./security-alert-adapters");
const { assertFlatSecurityInput } = require("./security-alert-model");

const AUTH_FAILURE_INPUT_FIELDS = new Set(["statusCode", "actorId", "requestId"]);

function assertAuthFailureInput(input) {
    assertFlatSecurityInput(input);

    for (const key of Reflect.ownKeys(input)) {
        if (!AUTH_FAILURE_INPUT_FIELDS.has(key)) {
            throw new TypeError("Security auth failure input alanı geçersiz.");
        }
    }

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
        }
    });
}

module.exports = {
    createSecurityOperationsBridge
};
