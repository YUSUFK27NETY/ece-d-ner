const { requireTenantId } = require("../tenant/tenant-id");
const { TENANT_COLLECTIONS } = require("./tenant-paths");
const { assertTenantPathBelongsTo } = require("../tenant/tenant-boundary");
const { encodeFirestoreValue, decodeFirestoreValue } = require("./firestore-value-codec");

const SNAPSHOT_VERSION = 1;
const DEFAULT_REGISTRY_COLLECTION = "platformTenants";

function assertDocumentId(value) {
    const id = String(value ?? "").trim();
    if (!id || id.includes("/") || id.length > 1500) throw new TypeError("Snapshot document id geçersiz.");
    return id;
}

function createFirestoreTenantSnapshotProvider({
    db,
    registryCollection = DEFAULT_REGISTRY_COLLECTION,
    collections = Object.values(TENANT_COLLECTIONS),
    batchSize = 400,
    now = () => new Date()
}) {
    if (!db || typeof db.collection !== "function" || typeof db.batch !== "function") {
        throw new TypeError("Firestore snapshot provider için db gerekli.");
    }

    const safeRegistryCollection = String(registryCollection ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeRegistryCollection)) throw new TypeError("Registry collection adı geçersiz.");

    const safeCollections = [...new Set(collections.map(value => String(value ?? "").trim()))];
    const allowedCollections = new Set(Object.values(TENANT_COLLECTIONS));
    if (safeCollections.length === 0 || safeCollections.some(name => !allowedCollections.has(name))) {
        throw new TypeError("Snapshot collection listesi geçersiz.");
    }

    const safeBatchSize = Number(batchSize);
    if (!Number.isInteger(safeBatchSize) || safeBatchSize < 1 || safeBatchSize > 450) throw new TypeError("Snapshot batchSize 1-450 arasında olmalı.");

    async function validateTenantSnapshot({ tenantId: rawTenantId, snapshot, schemaVersion }) {
        const tenantId = requireTenantId(rawTenantId);
        if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return false;
        if (snapshot.snapshotVersion !== SNAPSHOT_VERSION || requireTenantId(snapshot.tenantId) !== tenantId) return false;
        if (!Number.isInteger(Number(schemaVersion)) || Number(schemaVersion) < 1) return false;
        if (!snapshot.registry || typeof snapshot.registry !== "object" || Array.isArray(snapshot.registry)) return false;
        if (!snapshot.collections || typeof snapshot.collections !== "object" || Array.isArray(snapshot.collections)) return false;
        if (snapshot.registry.tenantId !== undefined && requireTenantId(snapshot.registry.tenantId) !== tenantId) return false;
        const snapshotCollectionNames = Object.keys(snapshot.collections).sort();
        const requiredCollectionNames = [...safeCollections].sort();
        if (snapshotCollectionNames.length !== requiredCollectionNames.length ||
            snapshotCollectionNames.some((name, index) => name !== requiredCollectionNames[index])) return false;

        for (const [collectionName, docs] of Object.entries(snapshot.collections)) {
            if (!allowedCollections.has(collectionName) || !safeCollections.includes(collectionName) || !Array.isArray(docs)) return false;
            const ids = new Set();
            for (const doc of docs) {
                if (!doc || typeof doc !== "object" || Array.isArray(doc)) return false;
                const id = assertDocumentId(doc.id);
                if (ids.has(id) || !doc.data || typeof doc.data !== "object" || Array.isArray(doc.data)) return false;
                ids.add(id);
                assertTenantPathBelongsTo(tenantId, `tenants/${tenantId}/${collectionName}/${id}`);
            }
        }

        return true;
    }

    return Object.freeze({
        async exportTenant({ tenantId: rawTenantId }) {
            const tenantId = requireTenantId(rawTenantId);
            const registrySnapshot = await db.collection(safeRegistryCollection).doc(tenantId).get();
            if (!registrySnapshot.exists) {
                const error = new Error("Tenant registry kaydı bulunamadı.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }

            const exportedAt = now();
            if (!(exportedAt instanceof Date) || Number.isNaN(exportedAt.getTime())) throw new TypeError("Snapshot clock geçersiz.");

            const snapshot = {
                snapshotVersion: SNAPSHOT_VERSION,
                tenantId,
                exportedAt: exportedAt.toISOString(),
                registry: encodeFirestoreValue(registrySnapshot.data(), { tenantId }),
                collections: {}
            };

            for (const collectionName of safeCollections) {
                const collectionPath = assertTenantPathBelongsTo(tenantId, `tenants/${tenantId}/${collectionName}`);
                const collectionSnapshot = await db.collection(collectionPath).get();
                snapshot.collections[collectionName] = collectionSnapshot.docs.map(doc => ({
                    id: assertDocumentId(doc.id),
                    data: encodeFirestoreValue(doc.data(), { tenantId })
                }));
            }

            return snapshot;
        },

        validateTenantSnapshot,

        async restoreTenant({ tenantId: rawTenantId, snapshot, schemaVersion, mode = "merge" }) {
            const tenantId = requireTenantId(rawTenantId);
            if (mode !== "merge") {
                const error = new Error("Firestore snapshot provider yalnız güvenli merge restore uygular.");
                error.code = "UNSAFE_RESTORE_MODE";
                throw error;
            }

            if (await validateTenantSnapshot({ tenantId, snapshot, schemaVersion }) !== true) {
                throw new Error("Restore snapshot doğrulaması başarısız.");
            }

            const writes = [];
            const registryRef = db.collection(safeRegistryCollection).doc(tenantId);
            const registryData = decodeFirestoreValue(snapshot.registry, { db, tenantId });
            writes.push({
                ref: registryRef,
                data: { ...registryData, tenantId }
            });

            for (const collectionName of safeCollections) {
                const docs = snapshot.collections[collectionName] || [];
                for (const doc of docs) {
                    const id = assertDocumentId(doc.id);
                    const path = assertTenantPathBelongsTo(tenantId, `tenants/${tenantId}/${collectionName}/${id}`);
                    writes.push({
                        ref: db.doc(path),
                        data: decodeFirestoreValue(doc.data, { db, tenantId })
                    });
                }
            }

            let committed = 0;
            for (let offset = 0; offset < writes.length; offset += safeBatchSize) {
                const batch = db.batch();
                const chunk = writes.slice(offset, offset + safeBatchSize);
                for (const write of chunk) batch.set(write.ref, write.data, { merge: true });
                await batch.commit();
                committed += chunk.length;
            }

            return { writes: committed, mode: "merge" };
        }
    });
}

module.exports = {
    SNAPSHOT_VERSION,
    DEFAULT_REGISTRY_COLLECTION,
    createFirestoreTenantSnapshotProvider
};
