const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { assertTrustedTenantResolution } = require("./trusted-tenant-resolution");
const {
    applyOrderStatus,
    createCanonicalRequestHash,
    createOrderRecord,
    createTenantBoundOrderId,
    normalizeIdempotencyKey,
    normalizeOrderRequest,
    priceOrderItems,
    projectAdminOrder,
    projectCustomerOrder,
    requireOrderId
} = require("./order-model");

const ORDERS_FEATURE = "orders";
const ORDERS_PERMISSION = "orders.manage";

function failDependency(label) {
    throw new TypeError(`Order service ${label} geçersiz.`);
}

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Order tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Order tenantId geçersiz.");
    return tenantId;
}

function requireOpaqueIdentifier(value, label, { optional = false } = {}) {
    if ((value === undefined || value === null) && optional) return null;
    if (typeof value !== "string" || value !== value.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ||
        /^\d{7,15}$/.test(value)) {
        throw new TypeError(`Order ${label} geçersiz.`);
    }
    return value;
}

function requireClockNow(clock) {
    let now;
    try {
        now = clock();
    } catch {
        throw new TypeError("Order clock geçersiz.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Order clock geçersiz.");
    }
    return now;
}

function assertTenantRegistry(value) {
    if (!value || typeof value.getById !== "function") failDependency("tenant registry");
    return value;
}

function assertProductRepository(value) {
    if (!value || typeof value.getById !== "function") failDependency("product repository");
    return value;
}

function assertOrderRepository(value) {
    if (!value || typeof value.getById !== "function" ||
        typeof value.listByTenant !== "function" ||
        typeof value.commitCreate !== "function" ||
        typeof value.commitStatusUpdate !== "function") {
        failDependency("order repository");
    }
    return value;
}

function assertEntitlementService(value) {
    if (!value || typeof value.evaluate !== "function" ||
        typeof value.assertFeatureAccess !== "function") {
        failDependency("entitlement service");
    }
    return value;
}

function requireTenantRecord(tenant, tenantId) {
    if (!isPlainRecord(tenant) || tenant.tenantId !== tenantId ||
        requireTenantId(tenant.tenantId) !== tenantId) {
        throw safeError("TENANT_RECORD_INVALID", "Tenant kaydı doğrulanamadı.");
    }
    return tenant;
}

function assertKnownOrdersEntitlement(result) {
    if (!result || typeof result !== "object" ||
        result.feature !== ORDERS_FEATURE || result.featureEnabled !== true) {
        throw safeError("ENTITLEMENT_DENIED", "Orders erişimi kullanılamıyor.");
    }
    if (result.usedDefaultPlanPolicy === true) {
        throw safeError(
            "ENTITLEMENT_PLAN_UNRESOLVED",
            "Tenant planı orders erişimi için doğrulanamadı."
        );
    }
    return result;
}

function createOrderService({
    tenantRegistry,
    productRepository,
    orderRepository,
    entitlementService,
    clock = () => new Date()
}) {
    const tenants = assertTenantRegistry(tenantRegistry);
    const products = assertProductRepository(productRepository);
    const orders = assertOrderRepository(orderRepository);
    const entitlements = assertEntitlementService(entitlementService);
    if (typeof clock !== "function") failDependency("clock");

    async function loadTenant(tenantId) {
        const tenant = await tenants.getById(tenantId);
        if (!tenant) throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        return requireTenantRecord(tenant, tenantId);
    }

    function assertCustomerEntitlement(tenant) {
        return assertKnownOrdersEntitlement(entitlements.evaluate({
            tenant,
            feature: ORDERS_FEATURE
        }));
    }

    async function authorizeAdmin(context, rawTenantId) {
        if (!isPlainRecord(context)) throw new TypeError("Order context geçersiz.");
        const tenantId = requireCanonicalTenantId(rawTenantId);
        authorizeTenantAction({
            context,
            tenantId,
            permission: ORDERS_PERMISSION
        });
        const tenant = await loadTenant(tenantId);
        const entitlement = entitlements.assertFeatureAccess({
            context,
            tenant,
            permission: ORDERS_PERMISSION,
            feature: ORDERS_FEATURE
        });
        assertKnownOrdersEntitlement(entitlement);
        return { context, tenantId, tenant };
    }

    function requireAdminActor(context) {
        return requireOpaqueIdentifier(context.actorId, "actorId");
    }

    function requireRequestId(value) {
        return requireOpaqueIdentifier(value, "requestId", { optional: true });
    }

    return Object.freeze({
        async createCustomerOrder({
            resolution,
            request,
            idempotencyKey,
            requestId = null
        } = {}) {
            const trusted = assertTrustedTenantResolution(resolution);
            const tenantId = trusted.tenantId;
            const tenant = await loadTenant(tenantId);
            if (tenant.status !== "active") {
                throw safeError("TENANT_NOT_ACTIVE", "Tenant sipariş almaya açık değil.");
            }
            assertCustomerEntitlement(tenant);

            const normalizedRequest = normalizeOrderRequest(request);
            const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
            const orderId = createTenantBoundOrderId(tenantId, safeIdempotencyKey);
            const requestHash = createCanonicalRequestHash(normalizedRequest);
            const existing = await orders.getById(tenantId, orderId);
            if (existing) {
                if (existing.requestHash !== requestHash) {
                    throw safeError(
                        "ORDER_IDEMPOTENCY_CONFLICT",
                        "Idempotent sipariş isteği önceki istekle uyuşmuyor."
                    );
                }
                return projectCustomerOrder(existing);
            }

            const productsById = new Map();
            for (const item of normalizedRequest.items) {
                const product = await products.getById(tenantId, item.productId);
                if (!product) {
                    throw safeError("ORDER_PRODUCT_UNAVAILABLE", "Siparişteki ürün kullanılamıyor.");
                }
                productsById.set(item.productId, product);
            }
            const priced = priceOrderItems({
                tenantId,
                requestedItems: normalizedRequest.items,
                productsById
            });
            const now = requireClockNow(clock);
            const order = createOrderRecord({
                tenantId,
                orderId,
                requestHash,
                normalizedRequest,
                priced,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId,
                action: "order.created",
                actorId: null,
                requestId: requireRequestId(requestId),
                metadata: { orderId },
                now
            });
            const committed = await orders.commitCreate({ order, auditEvent });
            if (!committed || typeof committed !== "object" || !committed.order) {
                throw safeError("ORDER_UNAVAILABLE", "Sipariş oluşturulamadı.");
            }
            if (committed.order.requestHash !== requestHash) {
                throw safeError(
                    "ORDER_IDEMPOTENCY_CONFLICT",
                    "Idempotent sipariş isteği önceki istekle uyuşmuyor."
                );
            }
            return projectCustomerOrder(committed.order);
        },

        async listAdmin({ context, tenantId, limit = 100 } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            const records = await orders.listByTenant(authorized.tenantId, { limit });
            if (!Array.isArray(records)) {
                throw safeError("ORDER_UNAVAILABLE", "Sipariş listesi alınamadı.");
            }
            return Object.freeze(records.map(projectAdminOrder));
        },

        async getAdmin({ context, tenantId, orderId } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            const safeOrderId = requireOrderId(orderId);
            const order = await orders.getById(authorized.tenantId, safeOrderId);
            if (!order) throw safeError("ORDER_NOT_FOUND", "Sipariş bulunamadı.");
            return projectAdminOrder(order);
        },

        async updateStatus({
            context,
            tenantId,
            orderId,
            status,
            requestId = null
        } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") {
                throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant sipariş değiştiremez.");
            }
            const safeOrderId = requireOrderId(orderId);
            const current = await orders.getById(authorized.tenantId, safeOrderId);
            if (!current) throw safeError("ORDER_NOT_FOUND", "Sipariş bulunamadı.");
            const now = requireClockNow(clock);
            const next = applyOrderStatus(current, status, now);
            if (next === current) return projectAdminOrder(current);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "order.status.updated",
                actorId: requireAdminActor(authorized.context),
                requestId: requireRequestId(requestId),
                metadata: {
                    orderId: safeOrderId,
                    fromStatus: current.status,
                    toStatus: next.status
                },
                now
            });
            await orders.commitStatusUpdate({
                expectedOrder: current,
                nextOrder: next,
                auditEvent
            });
            return projectAdminOrder(next);
        }
    });
}

module.exports = {
    ORDERS_FEATURE,
    ORDERS_PERMISSION,
    createOrderService
};
