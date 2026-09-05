const { requireTenantId } = require("../tenant/tenant-id");
const { createTenantPlacement, assertPlacementTenant } = require("../routing/tenant-placement");

const DEFAULT_PLACEMENT_COLLECTION = "platformTenantPlacements";

function createFirestorePlacementRegistry({ db, collectionName = DEFAULT_PLACEMENT_COLLECTION }) {
    if (!db || typeof db.collection !== "function") {
        throw new TypeError("Firestore placement registry db gerekli.");
    }
    const safeCollection = String(collectionName ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeCollection)) {
        throw new TypeError("Placement registry collection adı geçersiz.");
    }
    const collection = db.collection(safeCollection);

    return Object.freeze({
        async get(rawTenantId) {
            const tenantId = requireTenantId(rawTenantId);
            const snapshot = await collection.doc(tenantId).get();
            if (!snapshot.exists) return null;
            return assertPlacementTenant(snapshot.data(), tenantId);
        },
        async set(input) {
            const placement = createTenantPlacement(input);
            await collection.doc(placement.tenantId).set({ ...placement });
            return placement;
        }
    });
}

module.exports = {
    DEFAULT_PLACEMENT_COLLECTION,
    createFirestorePlacementRegistry
};
