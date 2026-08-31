const { requireTenantId } = require("../tenant/tenant-id");

function pad(value) {
    return String(value).padStart(2, "0");
}

function buildBackupKey({ tenantId, date = new Date(), extension = "json.gz.enc" }) {
    const normalizedTenantId = requireTenantId(tenantId);

    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new TypeError("Geçerli bir backup tarihi gerekli.");
    }

    const safeExtension = String(extension ?? "")
        .trim()
        .replace(/^\.+/, "");

    if (!/^[a-z0-9.]+$/i.test(safeExtension)) {
        throw new TypeError("Geçersiz backup uzantısı.");
    }

    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const timestamp = date.toISOString().replace(/[:.]/g, "-");

    return `backups/${normalizedTenantId}/firestore/${year}/${month}/${day}/${timestamp}.${safeExtension}`;
}

function tenantBackupPrefix(tenantId) {
    return `backups/${requireTenantId(tenantId)}/firestore/`;
}

module.exports = {
    buildBackupKey,
    tenantBackupPrefix
};
