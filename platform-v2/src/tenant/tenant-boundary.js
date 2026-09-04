const { requireTenantId } = require("./tenant-id");

function assertTenantMatch(expectedTenantId, actualTenantId, label = "resource") {
    const expected = requireTenantId(expectedTenantId);
    const actual = requireTenantId(actualTenantId);

    if (expected !== actual) {
        const error = new Error(`${label} farklı tenant kimliğine ait.`);
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }

    return expected;
}

function assertTenantPathBelongsTo(tenantId, rawPath) {
    const expected = requireTenantId(tenantId);
    const path = String(rawPath ?? "").trim();
    const root = `tenants/${expected}`;

    if (!path || path.startsWith("/") || path.endsWith("/") || path.includes("//") ||
        path.split("/").some(segment => segment === "." || segment === "..") ||
        !(path === root || path.startsWith(`${root}/`))) {
        const error = new Error("Firestore yolu tenant sınırı dışında.");
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }

    return path;
}

module.exports = {
    assertTenantMatch,
    assertTenantPathBelongsTo
};
