const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    TENANT_COLLECTIONS,
    tenantCollection,
    tenantDocument
} = require("./tenant-paths");
const {
    normalizePersistedProduct,
    requireProductId
} = require("../catalog/product-model");

const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stateChanged() {
    const error = new Error("Catalog product durumu değişti; işlem yeniden değerlendirilmeli.");
    error.code = "CATALOG_PRODUCT_STATE_CHANGED";
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Product repository tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Product repository tenantId geçersiz.");
    }
    return tenantId;
}

function normalizeLimit(value = 100) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Product repository list limit 1-200 arasında olmalı.");
    }
    return limit;
}

function requireCatalogAuditEvent(event, tenantId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId ||
        requireTenantId(event.tenantId) !== tenantId ||
        typeof event.eventId !== "string" ||
        !AUDIT_EVENT_ID_PATTERN.test(event.eventId) ||
        typeof event.action !== "string" ||
        !event.action.startsWith("catalog.product.")) {
        throw new TypeError("Catalog audit event geçersiz.");
    }
    return event;
}

function requireProductForTenant(product, tenantId) {
    return normalizePersistedProduct({
        tenantId,
        productId: product?.productId,
        data: product
    });
}

function createFirestoreProductRepository({ db }) {
    if (!db || typeof db.collection !== "function" ||
        typeof db.doc !== "function" || typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore product repository için db gerekli.");
    }

    return Object.freeze({
        async listByTenant(rawTenantId, { limit = 100 } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const safeLimit = normalizeLimit(limit);
            const path = tenantCollection(tenantId, TENANT_COLLECTIONS.products);
            const collection = db.collection(path);
            if (!collection || typeof collection.orderBy !== "function") {
                throw new TypeError("Product collection geçersiz.");
            }
            const ordered = collection.orderBy("createdAt", "asc");
            if (!ordered || typeof ordered.limit !== "function") {
                throw new TypeError("Product query geçersiz.");
            }
            const limited = ordered.limit(safeLimit);
            if (!limited || typeof limited.get !== "function") {
                throw new TypeError("Product query geçersiz.");
            }
            const snapshot = await limited.get();
            if (!snapshot || !Array.isArray(snapshot.docs)) {
                throw new TypeError("Product snapshot geçersiz.");
            }
            return snapshot.docs.map(document => {
                if (!document || typeof document.id !== "string" ||
                    typeof document.data !== "function") {
                    throw new TypeError("Product document geçersiz.");
                }
                return normalizePersistedProduct({
                    tenantId,
                    productId: requireProductId(document.id),
                    data: document.data()
                });
            });
        },

        async getById(rawTenantId, rawProductId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const productId = requireProductId(rawProductId);
            const ref = db.doc(tenantDocument(
                tenantId,
                TENANT_COLLECTIONS.products,
                productId
            ));
            const snapshot = await ref.get();
            if (!snapshot || snapshot.exists !== true) {
                return null;
            }
            if (typeof snapshot.data !== "function") {
                throw new TypeError("Product document geçersiz.");
            }
            return normalizePersistedProduct({
                tenantId,
                productId,
                data: snapshot.data()
            });
        },

        async commitCreate({ product, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(product?.tenantId);
            const safeProduct = requireProductForTenant(product, tenantId);
            const safeAudit = requireCatalogAuditEvent(auditEvent, tenantId);
            const productRef = db.doc(tenantDocument(
                tenantId,
                TENANT_COLLECTIONS.products,
                safeProduct.productId
            ));
            const auditRef = db.doc(`${tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.audit
            )}/${safeAudit.eventId}`);

            await db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.create !== "function") {
                    throw new TypeError("Catalog create transaction geçersiz.");
                }
                transaction.create(productRef, { ...safeProduct });
                transaction.create(auditRef, { ...safeAudit });
            });
            return safeProduct;
        },

        async commitUpdate({ expectedProduct, nextProduct, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(expectedProduct?.tenantId);
            const expected = requireProductForTenant(expectedProduct, tenantId);
            const next = requireProductForTenant(nextProduct, tenantId);
            if (expected.productId !== next.productId) {
                throw new TypeError("Catalog productId güncellemede değiştirilemez.");
            }
            const safeAudit = requireCatalogAuditEvent(auditEvent, tenantId);
            const productRef = db.doc(tenantDocument(
                tenantId,
                TENANT_COLLECTIONS.products,
                expected.productId
            ));
            const auditRef = db.doc(`${tenantCollection(
                tenantId,
                TENANT_COLLECTIONS.audit
            )}/${safeAudit.eventId}`);

            await db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Catalog update transaction geçersiz.");
                }
                const snapshot = await transaction.get(productRef);
                if (!snapshot || snapshot.exists !== true ||
                    typeof snapshot.data !== "function") {
                    throw stateChanged();
                }
                const persisted = normalizePersistedProduct({
                    tenantId,
                    productId: expected.productId,
                    data: snapshot.data()
                });
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw stateChanged();
                }
                transaction.update(productRef, { ...next });
                transaction.create(auditRef, { ...safeAudit });
            });
            return next;
        }
    });
}

module.exports = {
    normalizeLimit,
    createFirestoreProductRepository
};
