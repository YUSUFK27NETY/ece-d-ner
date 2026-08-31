const { requireTenantId } = require("./tenant-id");

const ALLOWED_ROLES = new Set([
    "platform_admin",
    "tenant_owner",
    "tenant_admin",
    "staff",
    "viewer"
]);

function createTenantContext({ tenantId, actorId = null, role = "viewer" }) {
    const normalizedTenantId = requireTenantId(tenantId);
    const normalizedRole = String(role ?? "").trim();

    if (!ALLOWED_ROLES.has(normalizedRole)) {
        throw new TypeError("Geçersiz tenant rolü.");
    }

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
