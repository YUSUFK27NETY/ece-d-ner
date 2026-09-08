const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { assertSecurityAlert } = require("./security-alert-model");

function createInMemorySecurityAlertSink({ maxAlerts = 5000 } = {}) {
    if (!Number.isSafeInteger(maxAlerts) || maxAlerts < 1 || maxAlerts > 100_000) {
        throw new TypeError("Security alert sink kapasitesi geçersiz.");
    }
    const alerts = new Map();
    return Object.freeze({
        // Upsert the same immutable aggregate by alertId; retrying emit must be idempotent.
        async emit(alert) {
            assertSecurityAlert(alert);
            if (!alerts.has(alert.alertId) && alerts.size >= maxAlerts) {
                throw new Error("Security alert sink kapasitesi dolu.");
            }
            const current = alerts.get(alert.alertId);
            if (current && alert.eventCount < current.eventCount) return current;
            alerts.set(alert.alertId, alert);
            return alert;
        },
        async list({ context, tenantId, limit = 20 }) {
            if (tenantId === undefined) throw new TypeError("Security alert query scope gerekli.");
            if (tenantId === null) {
                if (context?.role !== "platform_admin") {
                    const error = new Error("Platform security alert yetkisi gerekli.");
                    error.code = "PERMISSION_DENIED";
                    throw error;
                }
            } else {
                const safeTenantId = requireTenantId(tenantId);
                if (safeTenantId !== tenantId) throw new TypeError("Security alert query tenant geçersiz.");
                authorizeTenantAction({ context, tenantId: safeTenantId, permission: "tenant.security.read" });
            }
            if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
                throw new TypeError("Security alert query limit geçersiz.");
            }
            return [...alerts.values()].filter(alert => alert.tenantId === tenantId)
                .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt) || a.alertId.localeCompare(b.alertId))
                .slice(0, limit);
        }
    });
}

module.exports = { createInMemorySecurityAlertSink };
