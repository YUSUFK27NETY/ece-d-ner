const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    TENANT_COLLECTIONS,
    tenantCollection,
    tenantDocument
} = require("./tenant-paths");
const {
    ORDER_STATUSES,
    normalizePersistedOrder,
    requireOrderId
} = require("../orders/order-model");

const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER_AUDIT_ACTIONS = Object.freeze([
    "order.created",
    "order.status.updated"
]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Order repository tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Order repository tenantId geçersiz.");
    return tenantId;
}

function normalizeLimit(value = 100) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Order repository list limit 1-200 arasında olmalı.");
    }
    return limit;
}

function ownValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function requireAuditMetadata(event, action, orderId) {
    const metadata = event.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(metadata))) {
        throw new TypeError("Order audit metadata geçersiz.");
    }
    const keys = Reflect.ownKeys(metadata);
    const expectedKeys = action === "order.created"
        ? ["orderId"]
        : ["orderId", "fromStatus", "toStatus"];
    if (keys.length !== expectedKeys.length ||
        keys.some(key => typeof key !== "string" || !expectedKeys.includes(key)) ||
        ownValue(metadata, "orderId") !== orderId) {
        throw new TypeError("Order audit metadata geçersiz.");
    }
    if (action === "order.status.updated") {
        const fromStatus = ownValue(metadata, "fromStatus");
        const toStatus = ownValue(metadata, "toStatus");
        if (!ORDER_STATUSES.includes(fromStatus) || !ORDER_STATUSES.includes(toStatus) ||
            fromStatus === toStatus) {
            throw new TypeError("Order audit status metadata geçersiz.");
        }
    }
}

function requireOrderAuditEvent(event, tenantId, orderId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId || requireTenantId(event.tenantId) !== tenantId ||
        typeof event.eventId !== "string" || !AUDIT_EVENT_ID_PATTERN.test(event.eventId) ||
        !ORDER_AUDIT_ACTIONS.includes(event.action)) {
        throw new TypeError("Order audit event geçersiz.");
    }
    requireAuditMetadata(event, event.action, orderId);
    return event;
}

function createFirestoreOrderRepository({ db }) {
    if (!db || typeof db.collection !== "function" ||
        typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore order repository için db gerekli.");
    }

    function orderRef(tenantId, orderId) {
        return db.doc(tenantDocument(
            tenantId,
            TENANT_COLLECTIONS.orders,
            orderId
        ));
    }

    function auditRef(tenantId, eventId) {
        return db.doc(`${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`);
    }

    return Object.freeze({
        async listByTenant(rawTenantId, { limit = 100 } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const safeLimit = normalizeLimit(limit);
            const collection = db.collection(tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.orders
            ));
            if (!collection || typeof collection.orderBy !== "function") {
                throw new TypeError("Order collection geçersiz.");
            }
            const ordered = collection.orderBy("createdAt", "desc");
            if (!ordered || typeof ordered.limit !== "function") {
                throw new TypeError("Order query geçersiz.");
            }
            const limited = ordered.limit(safeLimit);
            if (!limited || typeof limited.get !== "function") {
                throw new TypeError("Order query geçersiz.");
            }
            const snapshot = await limited.get();
            if (!snapshot || !Array.isArray(snapshot.docs)) {
                throw new TypeError("Order snapshot geçersiz.");
            }
            return snapshot.docs.map(document => {
                if (!document || typeof document.id !== "string" ||
                    typeof document.data !== "function") {
                    throw new TypeError("Order document geçersiz.");
                }
                const orderId = requireOrderId(document.id);
                return normalizePersistedOrder({
                    tenantId,
                    orderId,
                    data: document.data()
                });
            });
        },

        async getById(rawTenantId, rawOrderId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const orderId = requireOrderId(rawOrderId);
            const snapshot = await orderRef(tenantId, orderId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (typeof snapshot.data !== "function") {
                throw new TypeError("Order document geçersiz.");
            }
            return normalizePersistedOrder({
                tenantId,
                orderId,
                data: snapshot.data()
            });
        },

        async commitCreate({ order, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(order?.tenantId);
            const safeOrder = normalizePersistedOrder({
                tenantId,
                orderId: order?.orderId,
                data: order
            });
            const safeAudit = requireOrderAuditEvent(
                auditEvent,
                tenantId,
                safeOrder.orderId
            );
            if (safeAudit.action !== "order.created") {
                throw new TypeError("Order create audit action geçersiz.");
            }
            const targetRef = orderRef(tenantId, safeOrder.orderId);
            const eventRef = auditRef(tenantId, safeAudit.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Order create transaction geçersiz.");
                }
                const snapshot = await transaction.get(targetRef);
                if (snapshot && snapshot.exists === true) {
                    if (typeof snapshot.data !== "function") {
                        throw new TypeError("Order document geçersiz.");
                    }
                    const existing = normalizePersistedOrder({
                        tenantId,
                        orderId: safeOrder.orderId,
                        data: snapshot.data()
                    });
                    if (existing.requestHash !== safeOrder.requestHash) {
                        throw safeError(
                            "ORDER_IDEMPOTENCY_CONFLICT",
                            "Idempotent sipariş isteği önceki istekle uyuşmuyor."
                        );
                    }
                    return Object.freeze({ created: false, order: existing });
                }
                transaction.create(targetRef, { ...safeOrder });
                transaction.create(eventRef, { ...safeAudit });
                return Object.freeze({ created: true, order: safeOrder });
            });
        },

        async commitStatusUpdate({
            expectedOrder,
            nextOrder,
            auditEvent
        } = {}) {
            const tenantId = requireCanonicalTenantId(expectedOrder?.tenantId);
            const expected = normalizePersistedOrder({
                tenantId,
                orderId: expectedOrder?.orderId,
                data: expectedOrder
            });
            const next = normalizePersistedOrder({
                tenantId,
                orderId: nextOrder?.orderId,
                data: nextOrder
            });
            if (expected.orderId !== next.orderId || expected.requestHash !== next.requestHash ||
                expected.createdAt !== next.createdAt) {
                throw new TypeError("Order immutable alanları değiştirilemez.");
            }
            const safeAudit = requireOrderAuditEvent(
                auditEvent,
                tenantId,
                expected.orderId
            );
            if (safeAudit.action !== "order.status.updated" ||
                safeAudit.metadata.fromStatus !== expected.status ||
                safeAudit.metadata.toStatus !== next.status) {
                throw new TypeError("Order status audit geçersiz.");
            }
            const targetRef = orderRef(tenantId, expected.orderId);
            const eventRef = auditRef(tenantId, safeAudit.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Order update transaction geçersiz.");
                }
                const snapshot = await transaction.get(targetRef);
                if (!snapshot || snapshot.exists !== true ||
                    typeof snapshot.data !== "function") {
                    throw safeError(
                        "ORDER_STATE_CHANGED",
                        "Sipariş durumu değişti; işlem yeniden değerlendirilmelidir."
                    );
                }
                const persisted = normalizePersistedOrder({
                    tenantId,
                    orderId: expected.orderId,
                    data: snapshot.data()
                });
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw safeError(
                        "ORDER_STATE_CHANGED",
                        "Sipariş durumu değişti; işlem yeniden değerlendirilmelidir."
                    );
                }
                transaction.update(targetRef, { ...next });
                transaction.create(eventRef, { ...safeAudit });
                return next;
            });
        }
    });
}

module.exports = {
    ORDER_AUDIT_ACTIONS,
    createFirestoreOrderRepository,
    normalizeLimit
};
