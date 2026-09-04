const { requireTenantId } = require("../tenant/tenant-id");

const SECURITY_SIGNALS_COLLECTION = "securitySignals";
const PLATFORM_SECURITY_SIGNALS_COLLECTION = "platformSecuritySignals";

function securitySignalDocumentPath(signal) {
    if (!signal || !/^[a-f0-9-]{36}$/i.test(String(signal.signalId ?? ""))) {
        throw new TypeError("Security signalId geçersiz.");
    }

    return signal.tenantId
        ? `tenants/${requireTenantId(signal.tenantId)}/${SECURITY_SIGNALS_COLLECTION}/${signal.signalId}`
        : `${PLATFORM_SECURITY_SIGNALS_COLLECTION}/${signal.signalId}`;
}

function createFirestoreSecuritySignalStore({ db }) {
    if (!db || typeof db.doc !== "function" || typeof db.collection !== "function") {
        throw new TypeError("Firestore security signal store için db gerekli.");
    }

    return Object.freeze({
        async write(signal) {
            await db.doc(securitySignalDocumentPath(signal)).create({ ...signal });
            return signal;
        },

        async listTenant({ tenantId, limit }) {
            const safeTenantId = requireTenantId(tenantId);
            const snapshot = await db.collection(
                `tenants/${safeTenantId}/${SECURITY_SIGNALS_COLLECTION}`
            ).orderBy("createdAt", "desc").limit(limit).get();

            return snapshot.docs.map(doc => ({
                ...doc.data(),
                signalId: doc.id
            }));
        }
    });
}

module.exports = {
    PLATFORM_SECURITY_SIGNALS_COLLECTION,
    SECURITY_SIGNALS_COLLECTION,
    createFirestoreSecuritySignalStore,
    securitySignalDocumentPath
};
