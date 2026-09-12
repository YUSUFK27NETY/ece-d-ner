const { requireTenantId } = require("../tenant/tenant-id");
const { requireProductId } = require("../catalog/product-model");
const { TENANT_COLLECTIONS, tenantCollection, tenantDocument, tenantSettingsDocument } = require("./tenant-paths");
const {
    FULFILLMENT_SETTING_ID,
    normalizePersistedFulfillment,
    normalizePersistedInventory
} = require("../inventory/inventory-delivery-model");

const AUDIT_ID = /^[0-9a-f-]{36}$/i;
const AUDIT_ACTIONS = new Set(["inventory.stock.updated", "fulfillment.config.updated"]);

function canonicalTenant(value) {
    if (typeof value !== "string") throw new TypeError("Inventory repository tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Inventory repository tenantId geçersiz.");
    return tenantId;
}

function requireAudit(event, tenantId, action) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId || !AUDIT_ACTIONS.has(event.action) ||
        event.action !== action || typeof event.eventId !== "string" || !AUDIT_ID.test(event.eventId)) {
        throw new TypeError("Inventory audit event geçersiz.");
    }
    return event;
}

function createFirestoreInventoryDeliveryRepository({ db }) {
    if (!db || typeof db.collection !== "function" || typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore inventory repository için db gerekli.");
    }

    function inventoryRef(tenantId, productId) {
        return db.doc(tenantDocument(tenantId, TENANT_COLLECTIONS.inventory, productId));
    }

    function auditRef(tenantId, eventId) {
        return db.doc(`${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`);
    }

    return Object.freeze({
        async listInventory(rawTenantId) {
            const tenantId = canonicalTenant(rawTenantId);
            const snapshot = await db.collection(tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.inventory
            )).get();
            if (!snapshot || !Array.isArray(snapshot.docs)) {
                throw new TypeError("Inventory snapshot geçersiz.");
            }
            return snapshot.docs.map(doc => normalizePersistedInventory({
                tenantId,
                productId: requireProductId(doc.id),
                data: doc.data()
            }));
        },

        async getInventory(rawTenantId, rawProductId) {
            const tenantId = canonicalTenant(rawTenantId);
            const productId = requireProductId(rawProductId);
            const snapshot = await inventoryRef(tenantId, productId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            return normalizePersistedInventory({ tenantId, productId, data: snapshot.data() });
        },

        async commitInventory({ record, auditEvent } = {}) {
            const tenantId = canonicalTenant(record?.tenantId);
            const safe = normalizePersistedInventory({
                tenantId,
                productId: record?.productId,
                data: record
            });
            const audit = requireAudit(auditEvent, tenantId, "inventory.stock.updated");
            const target = inventoryRef(tenantId, safe.productId);
            await db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.set !== "function" || typeof transaction.create !== "function") {
                    throw new TypeError("Inventory transaction geçersiz.");
                }
                await transaction.get(target);
                transaction.set(target, { ...safe });
                transaction.create(auditRef(tenantId, audit.eventId), { ...audit });
            });
            return safe;
        },

        async getFulfillment(rawTenantId) {
            const tenantId = canonicalTenant(rawTenantId);
            const snapshot = await db.doc(tenantSettingsDocument(
                tenantId,
                FULFILLMENT_SETTING_ID
            )).get();
            if (!snapshot || snapshot.exists !== true) return null;
            return normalizePersistedFulfillment({ tenantId, data: snapshot.data() });
        },

        async commitFulfillment({ record, auditEvent } = {}) {
            const tenantId = canonicalTenant(record?.tenantId);
            const safe = normalizePersistedFulfillment({ tenantId, data: record });
            const audit = requireAudit(auditEvent, tenantId, "fulfillment.config.updated");
            const target = db.doc(tenantSettingsDocument(tenantId, FULFILLMENT_SETTING_ID));
            await db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.set !== "function" || typeof transaction.create !== "function") {
                    throw new TypeError("Fulfillment transaction geçersiz.");
                }
                await transaction.get(target);
                transaction.set(target, { ...safe });
                transaction.create(auditRef(tenantId, audit.eventId), { ...audit });
            });
            return safe;
        }
    });
}

module.exports = { createFirestoreInventoryDeliveryRepository };
