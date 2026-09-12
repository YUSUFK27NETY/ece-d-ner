const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { requireProductId } = require("../catalog/product-model");
const {
    createFulfillmentRecord,
    createInventoryRecord,
    defaultFulfillmentConfig,
    fulfillmentAllows,
    projectFulfillment,
    projectInventory,
    stockStatus
} = require("./inventory-delivery-model");

const INVENTORY_FEATURE = "inventory";
const ORDERS_FEATURE = "orders";
const INVENTORY_PERMISSION = "settings.manage";
const FULFILLMENT_PERMISSION = "settings.manage";

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function canonicalTenant(value) {
    if (typeof value !== "string") throw new TypeError("Inventory tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Inventory tenantId geçersiz.");
    return tenantId;
}

function nowFrom(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Inventory clock geçersiz.");
    }
    return now;
}

function requireActor(context) {
    if (typeof context?.actorId !== "string" || !context.actorId.trim()) {
        throw new TypeError("Inventory actorId geçersiz.");
    }
    return context.actorId;
}

function createInventoryDeliveryService({
    tenantRegistry,
    productRepository,
    repository,
    entitlementService,
    clock = () => new Date()
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Inventory tenant registry geçersiz.");
    }
    if (!productRepository || typeof productRepository.getById !== "function" ||
        typeof productRepository.listByTenant !== "function") {
        throw new TypeError("Inventory product repository geçersiz.");
    }
    if (!repository || typeof repository.listInventory !== "function" ||
        typeof repository.getInventory !== "function" ||
        typeof repository.commitInventory !== "function" ||
        typeof repository.getFulfillment !== "function" ||
        typeof repository.commitFulfillment !== "function") {
        throw new TypeError("Inventory repository geçersiz.");
    }
    if (!entitlementService || typeof entitlementService.evaluate !== "function" ||
        typeof entitlementService.assertFeatureAccess !== "function") {
        throw new TypeError("Inventory entitlement service geçersiz.");
    }
    if (typeof clock !== "function") throw new TypeError("Inventory clock geçersiz.");

    async function loadTenant(tenantId) {
        const tenant = await tenantRegistry.getById(tenantId);
        if (!tenant || tenant.tenantId !== tenantId || requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        }
        return tenant;
    }

    async function authorize(context, rawTenantId, permission, feature) {
        if (!isPlainRecord(context)) throw new TypeError("Inventory context geçersiz.");
        const tenantId = canonicalTenant(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission });
        const tenant = await loadTenant(tenantId);
        const result = entitlementService.assertFeatureAccess({
            context,
            tenant,
            permission,
            feature
        });
        if (!result || result.feature !== feature || result.featureEnabled !== true ||
            result.usedDefaultPlanPolicy === true) {
            throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "Modül erişimi doğrulanamadı.");
        }
        return { context, tenantId, tenant };
    }

    function evaluatePublicFeature(tenant, feature) {
        const result = entitlementService.evaluate({ tenant, feature });
        if (!result || result.feature !== feature) {
            throw safeError("ENTITLEMENT_DENIED", "Modül kullanılamıyor.");
        }
        if (result.featureEnabled !== true) return false;
        if (result.usedDefaultPlanPolicy === true) {
            throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "Tenant planı doğrulanamadı.");
        }
        return true;
    }

    async function fulfillmentForTenant(tenantId) {
        return await repository.getFulfillment(tenantId) || defaultFulfillmentConfig(tenantId);
    }

    return Object.freeze({
        async listInventoryAdmin({ context, tenantId } = {}) {
            const authorized = await authorize(
                context,
                tenantId,
                INVENTORY_PERMISSION,
                INVENTORY_FEATURE
            );
            const [products, records] = await Promise.all([
                productRepository.listByTenant(authorized.tenantId, { limit: 200 }),
                repository.listInventory(authorized.tenantId)
            ]);
            if (!Array.isArray(products) || !Array.isArray(records)) {
                throw safeError("INVENTORY_UNAVAILABLE", "Stok listesi alınamadı.");
            }
            const byProduct = new Map(records.map(record => [record.productId, record]));
            return Object.freeze(products
                .filter(product => product.archived !== true)
                .map(product => projectInventory(byProduct.get(product.productId) || null, product)));
        },

        async setInventoryAdmin({ context, tenantId, productId, input, requestId = null } = {}) {
            const authorized = await authorize(
                context,
                tenantId,
                INVENTORY_PERMISSION,
                INVENTORY_FEATURE
            );
            if (authorized.tenant.status === "archived") {
                throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant stok değiştiremez.");
            }
            const safeProductId = requireProductId(productId);
            const product = await productRepository.getById(authorized.tenantId, safeProductId);
            if (!product || product.archived === true) {
                throw safeError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
            }
            const now = nowFrom(clock);
            const record = createInventoryRecord({
                tenantId: authorized.tenantId,
                productId: safeProductId,
                input,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "inventory.stock.updated",
                actorId: requireActor(authorized.context),
                requestId,
                metadata: {
                    productId: safeProductId,
                    trackingEnabled: record.trackingEnabled,
                    quantity: record.quantity,
                    lowStockThreshold: record.lowStockThreshold,
                    status: stockStatus(record)
                },
                now
            });
            const saved = await repository.commitInventory({ record, auditEvent });
            return projectInventory(saved, product);
        },

        async getFulfillmentAdmin({ context, tenantId } = {}) {
            const authorized = await authorize(
                context,
                tenantId,
                FULFILLMENT_PERMISSION,
                ORDERS_FEATURE
            );
            return projectFulfillment(await fulfillmentForTenant(authorized.tenantId));
        },

        async updateFulfillmentAdmin({ context, tenantId, input, requestId = null } = {}) {
            const authorized = await authorize(
                context,
                tenantId,
                FULFILLMENT_PERMISSION,
                ORDERS_FEATURE
            );
            if (authorized.tenant.status === "archived") {
                throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant teslimat ayarı değiştiremez.");
            }
            const now = nowFrom(clock);
            const record = createFulfillmentRecord({
                tenantId: authorized.tenantId,
                input,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "fulfillment.config.updated",
                actorId: requireActor(authorized.context),
                requestId,
                metadata: {
                    deliveryEnabled: record.deliveryEnabled,
                    pickupEnabled: record.pickupEnabled,
                    takeawayEnabled: record.takeawayEnabled,
                    dineInEnabled: record.dineInEnabled
                },
                now
            });
            const saved = await repository.commitFulfillment({ record, auditEvent });
            return projectFulfillment(saved);
        },

        async getPublicFulfillment({ tenantId } = {}) {
            const safeTenantId = canonicalTenant(tenantId);
            const tenant = await loadTenant(safeTenantId);
            if (tenant.status !== "active" || !evaluatePublicFeature(tenant, ORDERS_FEATURE)) {
                throw safeError("FULFILLMENT_NOT_AVAILABLE", "Sipariş kanalları kullanılamıyor.");
            }
            return projectFulfillment(await fulfillmentForTenant(safeTenantId));
        },

        async prepareCustomerOrder({ tenant, tenantId, normalizedRequest } = {}) {
            const safeTenantId = canonicalTenant(tenantId);
            if (!tenant || tenant.tenantId !== safeTenantId || !normalizedRequest?.fulfillment ||
                !Array.isArray(normalizedRequest.items)) {
                throw new TypeError("Inventory order policy input geçersiz.");
            }
            const fulfillment = await fulfillmentForTenant(safeTenantId);
            if (!fulfillmentAllows(fulfillment, normalizedRequest.fulfillment.type)) {
                throw safeError("ORDER_FULFILLMENT_DISABLED", "Seçilen sipariş teslimat türü kapalı.");
            }

            if (!evaluatePublicFeature(tenant, INVENTORY_FEATURE)) {
                return Object.freeze({ stockAdjustments: Object.freeze([]) });
            }

            const stockAdjustments = [];
            for (const item of normalizedRequest.items) {
                const record = await repository.getInventory(safeTenantId, item.productId);
                if (!record || record.trackingEnabled !== true) continue;
                if (record.quantity < item.quantity) {
                    throw safeError("ORDER_OUT_OF_STOCK", "Siparişteki ürünün stoğu yetersiz.");
                }
                stockAdjustments.push(Object.freeze({
                    productId: item.productId,
                    quantity: item.quantity
                }));
            }
            return Object.freeze({ stockAdjustments: Object.freeze(stockAdjustments) });
        }
    });
}

module.exports = {
    FULFILLMENT_PERMISSION,
    INVENTORY_FEATURE,
    INVENTORY_PERMISSION,
    ORDERS_FEATURE,
    createInventoryDeliveryService
};
