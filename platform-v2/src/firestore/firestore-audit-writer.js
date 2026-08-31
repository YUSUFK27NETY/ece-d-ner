const { createAuditEvent } = require("../audit/audit-event");
const { tenantCollection, TENANT_COLLECTIONS } = require("./tenant-paths");

function createFirestoreAuditWriter({ db }) {
    if (!db || typeof db.doc !== "function") {
        throw new TypeError("Firestore db instance gerekli.");
    }

    return Object.freeze({
        async write(input) {
            const event = input?.eventId ? input : createAuditEvent(input);
            const auditCollectionPath = tenantCollection(
                event.tenantId,
                TENANT_COLLECTIONS.audit
            );
            const ref = db.doc(`${auditCollectionPath}/${event.eventId}`);

            await ref.create({ ...event });
            return event;
        }
    });
}

module.exports = {
    createFirestoreAuditWriter
};
