const { requireTenantId } = require("../tenant/tenant-id");

const DEFAULT_TENANT_REGISTRY_COLLECTION = "platformTenants";

function normalizeListLimit(value = 100) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Tenant liste limiti 1-200 arasında olmalı.");
    }

    return limit;
}

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

        async list({ limit = 100 } = {}) {
            const safeLimit = normalizeListLimit(limit);
            const snapshot = await collection
                .orderBy("createdAt", "desc")
                .limit(safeLimit)
                .get();

            return snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        },

        async create(tenant) {
            const tenantId = requireTenantId(tenant?.tenantId);
            await collection.doc(tenantId).create({ ...tenant });
            return tenant;
        },

        async update(rawTenantId, tenant) {
            const tenantId = requireTenantId(rawTenantId);

            if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
                throw new TypeError("Güncellenecek tenant nesnesi gerekli.");
            }

            if (requireTenantId(tenant.tenantId) !== tenantId) {
                throw new TypeError("Tenant kimliği güncelleme sırasında değiştirilemez.");
            }

            await collection.doc(tenantId).update({ ...tenant });
            return tenant;
        }
    });
}

module.exports = {
    DEFAULT_TENANT_REGISTRY_COLLECTION,
    normalizeListLimit,
    createFirestoreTenantRegistry
};
