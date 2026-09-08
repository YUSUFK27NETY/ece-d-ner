const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

function createTenantAccessGuard({ abuseMonitor, securityOperations = null }) {
    if (!abuseMonitor || typeof abuseMonitor.recordTenantBoundaryViolation !== "function") {
        throw new TypeError("Tenant access guard abuse monitor gerekli.");
    }
    if (securityOperations &&
        typeof securityOperations.recordTenantBoundaryViolation !== "function") {
        throw new TypeError("Tenant access guard security operations bridge geçersiz.");
    }

    async function recordPhase6Boundary({ tenantId, requestId, operation }) {
        try {
            await abuseMonitor.recordTenantBoundaryViolation({
                tenantId,
                requestId,
                operation
            });
        } catch {
            console.error("Tenant boundary security signal kaydı başarısız.");
        }
    }

    async function recordPhase8Boundary({ sourceContext, requestId, operation }) {
        if (!securityOperations) return;
        try {
            await securityOperations.recordTenantBoundaryViolation({
                context: sourceContext,
                errorCode: "TENANT_SCOPE_MISMATCH",
                operation,
                requestId
            });
        } catch {
            console.error("Central tenant-boundary security alert kaydı başarısız.");
        }
    }

    function sourceContextSnapshot(context) {
        if (!context || typeof context !== "object") return null;
        const tenantDescriptor = Object.getOwnPropertyDescriptor(context, "tenantId");
        if (!tenantDescriptor || !Object.hasOwn(tenantDescriptor, "value")) return null;
        if (typeof tenantDescriptor.value !== "string") return null;

        let tenantId;
        try {
            tenantId = requireTenantId(tenantDescriptor.value);
        } catch {
            return null;
        }
        if (tenantId !== tenantDescriptor.value) return null;
        const actorDescriptor = Object.getOwnPropertyDescriptor(context, "actorId");
        return Object.freeze({
            tenantId,
            actorId: actorDescriptor && Object.hasOwn(actorDescriptor, "value")
                ? actorDescriptor.value
                : null
        });
    }

    return Object.freeze({
        async authorize({
            context,
            tenantId,
            permission,
            requestId = null,
            operation = "tenant.access"
        }) {
            try {
                return authorizeTenantAction({ context, tenantId, permission });
            } catch (error) {
                const sourceContext = error?.code === "TENANT_SCOPE_MISMATCH"
                    ? sourceContextSnapshot(context)
                    : null;
                if (sourceContext) {
                    await Promise.all([
                        recordPhase6Boundary({
                            tenantId: sourceContext.tenantId,
                            requestId,
                            operation
                        }),
                        recordPhase8Boundary({
                            sourceContext,
                            requestId,
                            operation
                        })
                    ]);
                }
                throw error;
            }
        }
    });
}

module.exports = {
    createTenantAccessGuard
};
