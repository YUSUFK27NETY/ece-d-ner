const crypto = require("node:crypto");

const TENANT_MEMBER_ROLES = Object.freeze([
    "tenant_owner",
    "tenant_admin",
    "staff",
    "viewer"
]);

function requireFirebaseUid(value) {
    if (typeof value !== "string" || value !== value.trim() ||
        value.length < 1 || value.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(value)) {
        throw new TypeError("Firebase kullanıcı kimliği geçersiz.");
    }

    return value;
}

function deriveFirebaseSubjectRef(uid) {
    const safeUid = requireFirebaseUid(uid);
    return `firebase:${crypto.createHash("sha256").update(safeUid, "utf8").digest("hex")}`;
}

function requireTenantMemberRole(role) {
    if (typeof role !== "string" || !TENANT_MEMBER_ROLES.includes(role)) {
        throw new TypeError("Tenant member rolü geçersiz.");
    }

    return role;
}

module.exports = {
    TENANT_MEMBER_ROLES,
    deriveFirebaseSubjectRef,
    requireFirebaseUid,
    requireTenantMemberRole
};
