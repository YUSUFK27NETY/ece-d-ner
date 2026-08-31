const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

function normalizeTenantId(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase();
}

function isValidTenantId(value) {
    const tenantId = normalizeTenantId(value);

    return tenantId.length >= 3 &&
        tenantId.length <= 63 &&
        TENANT_ID_PATTERN.test(tenantId);
}

function requireTenantId(value) {
    const tenantId = normalizeTenantId(value);

    if (!isValidTenantId(tenantId)) {
        throw new TypeError(
            "Geçerli bir tenantId gerekli: 3-63 karakter, küçük harf/rakam ve iç konumlarda tire."
        );
    }

    return tenantId;
}

module.exports = {
    normalizeTenantId,
    isValidTenantId,
    requireTenantId
};
