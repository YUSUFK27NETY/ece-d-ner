const { requireTenantId } = require("../tenant/tenant-id");

const TENANT_COLLECTIONS = Object.freeze({
    products: "products",
    orders: "orders",
    settings: "settings",
    members: "members",
    audit: "audit"
});

function assertDocumentId(value, label = "documentId") {
    const id = String(value ?? "").trim();

    if (!id || id.includes("/") || id.length > 1500) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return id;
}

function tenantRoot(tenantId) {
    return `tenants/${requireTenantId(tenantId)}`;
}

function tenantCollection(tenantId, collectionName) {
    if (!Object.values(TENANT_COLLECTIONS).includes(collectionName)) {
        throw new TypeError("İzin verilmeyen tenant koleksiyonu.");
    }

    return `${tenantRoot(tenantId)}/${collectionName}`;
}

function tenantDocument(tenantId, collectionName, documentId) {
    return `${tenantCollection(tenantId, collectionName)}/${assertDocumentId(documentId)}`;
}

function tenantSettingsDocument(tenantId, settingId) {
    return tenantDocument(
        tenantId,
        TENANT_COLLECTIONS.settings,
        settingId
    );
}

module.exports = {
    TENANT_COLLECTIONS,
    tenantRoot,
    tenantCollection,
    tenantDocument,
    tenantSettingsDocument
};
