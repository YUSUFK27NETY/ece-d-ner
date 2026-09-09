const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const { tenantCollection, TENANT_COLLECTIONS } = require("./tenant-paths");

const DEFAULT_TENANT_REGISTRY_COLLECTION = "platformTenants";
const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeListLimit(value = 100) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Tenant liste limiti 1-200 arasında olmalı.");
    }

    return limit;
}

function stateChanged() {
    const error = new Error("Tenant lifecycle durumu değişti; işlem yeniden değerlendirilmeli.");
    error.code = "TENANT_LIFECYCLE_STATE_CHANGED";
    return error;
}

function requireLifecycleTenant(record, tenantId, label) {
    if (!record || typeof record !== "object" || Array.isArray(record) ||
        record.tenantId !== tenantId ||
        requireTenantId(record.tenantId) !== tenantId) {
        throw new TypeError(`${label} tenant kaydı geçersiz.`);
    }
    return record;
}

function requireLifecycleAuditEvent(event, tenantId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId ||
        requireTenantId(event.tenantId) !== tenantId ||
        typeof event.eventId !== "string" ||
        !AUDIT_EVENT_ID_PATTERN.test(event.eventId) ||
        typeof event.action !== "string" ||
        !event.action.startsWith("tenant.lifecycle.")) {
        throw new TypeError("Lifecycle audit event geçersiz.");
    }
    return event;
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
        },

        async commitLifecycleTransition({
            tenantId: rawTenantId,
            expectedTenant,
            nextTenant,
            auditEvent
        } = {}) {
            const tenantId = requireTenantId(rawTenantId);
            if (tenantId !== rawTenantId) {
                throw new TypeError("Lifecycle tenant kimliği canonical olmalı.");
            }
            requireLifecycleTenant(expectedTenant, tenantId, "Expected lifecycle");
            requireLifecycleTenant(nextTenant, tenantId, "Next lifecycle");
            requireLifecycleAuditEvent(auditEvent, tenantId);

            if (typeof db.runTransaction !== "function" ||
                typeof db.doc !== "function") {
                throw new TypeError("Atomic lifecycle persistence kullanılamıyor.");
            }

            const tenantRef = collection.doc(tenantId);
            const auditPath = tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.audit
            );
            const auditRef = db.doc(`${auditPath}/${auditEvent.eventId}`);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Atomic lifecycle transaction geçersiz.");
                }

                const snapshot = await transaction.get(tenantRef);
                if (!snapshot || snapshot.exists !== true ||
                    typeof snapshot.data !== "function") {
                    throw stateChanged();
                }

                const persisted = {
                    id: snapshot.id,
                    ...snapshot.data()
                };

                if (!isDeepStrictEqual(persisted, expectedTenant)) {
                    throw stateChanged();
                }

                transaction.update(tenantRef, { ...nextTenant });
                transaction.create(auditRef, { ...auditEvent });
                return nextTenant;
            });
        }
    });
}

module.exports = {
    DEFAULT_TENANT_REGISTRY_COLLECTION,
    normalizeListLimit,
    createFirestoreTenantRegistry
};
