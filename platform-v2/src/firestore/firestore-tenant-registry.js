const { requireTenantId } = require("../tenant/tenant-id");

const DEFAULT_TENANT_REGISTRY_COLLECTION = "platformTenants";

function createFirestoreTenantRegistry({
    db,
    collectionName = DEFAULT_TENANT_REGISTRY_COLLECTION
}) {
    if (!db || typeof db.collection !== "function") {
        throw new TypeError("Firestore db instance gerekli.");
    }

    const safeCollectionName = String(collectionName ?? "").trim();

    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeCollectionName)) {
        throw new TypeError("Geçersiz tenant registry collection adı.");
    }

    const collection = db.collection(safeCollectionName);

    return Object.freeze({
        async getById(rawTenantId) {
            const tenantId = requireTenantId(rawTenantId);
            const snapshot = await collection.doc(tenantId).get();

            if (!snapshot.exists) {
                return null;
            }

            return {
                id: snapshot.id,
                ...snapshot.data()
            };
        },

        async create(tenant) {
            const tenantId = requireTenantId(tenant?.tenantId);
            await collection.doc(tenantId).create({ ...tenant });
            return tenant;
        }
    });
}

module.exports = {
    DEFAULT_TENANT_REGISTRY_COLLECTION,
    createFirestoreTenantRegistry
};
