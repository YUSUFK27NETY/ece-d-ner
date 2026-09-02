function createFirestoreReadinessCheck({ db, collectionName = "platformTenants" }) {
    if (!db || typeof db.collection !== "function") {
        throw new TypeError("Firestore readiness için db gerekli.");
    }

    const safeCollectionName = String(collectionName ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeCollectionName)) {
        throw new TypeError("Readiness collection adı geçersiz.");
    }

    return async function firestoreReadinessCheck() {
        await db.collection(safeCollectionName).limit(1).get();
        return true;
    };
}

module.exports = {
    createFirestoreReadinessCheck
};
