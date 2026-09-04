const { requireTenantId } = require("../tenant/tenant-id");

const ROLE_PERMISSIONS = Object.freeze({
    platform_admin: Object.freeze(["*"]),
    tenant_owner: Object.freeze([
        "tenant.read",
        "tenant.update",
        "catalog.manage",
        "orders.manage",
        "members.manage",
        "settings.manage",
        "audit.read",
        "tenant.telemetry.read",
        "tenant.cost.read",
        "tenant.security.read",
        "tenant.operations.read"
    ]),
    tenant_admin: Object.freeze([
        "tenant.read",
        "tenant.update",
        "catalog.manage",
        "orders.manage",
        "settings.manage",
        "audit.read",
        "tenant.telemetry.read",
        "tenant.cost.read",
        "tenant.security.read",
        "tenant.operations.read"
    ]),
    staff: Object.freeze([
        "tenant.read",
        "catalog.read",
        "orders.manage"
    ]),
    viewer: Object.freeze([
        "tenant.read",
        "catalog.read",
        "orders.read"
    ])
});

function hasPermission(role, permission) {
    const permissions = ROLE_PERMISSIONS[role];

    if (!permissions) {
        return false;
    }

    return permissions.includes("*") || permissions.includes(permission);
}

function authorizeTenantAction({ context, tenantId, permission }) {
    if (!context || typeof context !== "object") {
        throw new TypeError("Tenant context gerekli.");
    }

    const targetTenantId = requireTenantId(tenantId);
    const normalizedPermission = String(permission ?? "").trim();

    if (!normalizedPermission) {
        throw new TypeError("Permission gerekli.");
    }

    if (context.role !== "platform_admin") {
        const contextTenantId = requireTenantId(context.tenantId);

        if (contextTenantId !== targetTenantId) {
            const error = new Error("Tenant sınırı ihlali.");
            error.code = "TENANT_SCOPE_MISMATCH";
            throw error;
        }
    }

    if (!hasPermission(context.role, normalizedPermission)) {
        const error = new Error("Bu işlem için yetki yok.");
        error.code = "PERMISSION_DENIED";
        throw error;
    }

    return true;
}

module.exports = {
    ROLE_PERMISSIONS,
    hasPermission,
    authorizeTenantAction
};
