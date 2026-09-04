const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

function createTenantAccessGuard({ abuseMonitor }) {
    if (!abuseMonitor || typeof abuseMonitor.recordTenantBoundaryViolation !== "function") {
        throw new TypeError("Tenant access guard abuse monitor gerekli.");
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
                if (error?.code === "TENANT_SCOPE_MISMATCH" && context?.tenantId) {
                    await abuseMonitor.recordTenantBoundaryViolation({
                        tenantId: requireTenantId(context.tenantId),
                        requestId,
                        operation
                    });
                }
                throw error;
            }
        }
    });
}

module.exports = {
    createTenantAccessGuard
};
