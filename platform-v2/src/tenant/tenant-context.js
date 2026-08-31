const { requireTenantId } = require("./tenant-id");

const ALLOWED_ROLES = new Set([
    "platform_admin",
    "tenant_owner",
    "tenant_admin",
    "staff",
    "viewer"
]);

function createTenantContext({ tenantId = null, actorId = null, role = "viewer" }) {
    const normalizedRole = String(role ?? "").trim();

    if (!ALLOWED_ROLES.has(normalizedRole)) {
        throw new TypeError("Geçersiz tenant rolü.");
    }

    const normalizedTenantId =
        normalizedRole === "platform_admin" && !tenantId
            ? null
            : requireTenantId(tenantId);

    return Object.freeze({
        tenantId: normalizedTenantId,
        actorId: actorId ? String(actorId) : null,
        role: normalizedRole
    });
}

module.exports = {
    ALLOWED_ROLES,
    createTenantContext
};
