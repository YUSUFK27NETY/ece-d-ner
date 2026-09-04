const { requireTenantId } = require("../tenant/tenant-id");
const { mergeUsageAggregate } = require("../usage/usage-telemetry");

const TELEMETRY_COLLECTION = "telemetry";

function telemetryDocumentPath(tenantId, descriptor) {
    const safeTenantId = requireTenantId(tenantId);

    if (!descriptor || !/^(daily|monthly)_\d{4}-\d{2}(?:-\d{2})?$/.test(descriptor.key)) {
        throw new TypeError("Telemetry document period key geçersiz.");
    }

    return `tenants/${safeTenantId}/${TELEMETRY_COLLECTION}/${descriptor.key}`;
}

function createFirestoreUsageStore({ db }) {
    if (!db || typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore usage store için db gerekli.");
    }

    return Object.freeze({
        async increment({ tenantId, descriptor, delta }) {
            const ref = db.doc(telemetryDocumentPath(tenantId, descriptor));

            return db.runTransaction(async transaction => {
                const snapshot = await transaction.get(ref);
                const current = snapshot.exists ? snapshot.data() : null;
                const next = mergeUsageAggregate(current, delta, descriptor);
                transaction.set(ref, next);
                return next;
            });
        },

        async get({ tenantId, descriptor }) {
            const snapshot = await db.doc(
                telemetryDocumentPath(tenantId, descriptor)
            ).get();

            return snapshot.exists ? snapshot.data() : null;
        }
    });
}

module.exports = {
    TELEMETRY_COLLECTION,
    createFirestoreUsageStore,
    telemetryDocumentPath
};
