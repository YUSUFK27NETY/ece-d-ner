const crypto = require("node:crypto");
const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    applyProductPatch,
    archiveProductRecord,
    createProductRecord,
    projectProduct,
    requireProductId
} = require("./product-model");

const CATALOG_PERMISSION = "catalog.manage";
const CATALOG_FEATURE = "catalog";

function failDependency(label) {
    throw new TypeError(`Catalog service ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownDataValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Catalog tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Catalog tenantId geçersiz.");
    }
    return tenantId;
}

function requireOpaqueIdentifier(value, label, { optional = false } = {}) {
    if ((value === undefined || value === null) && optional) {
        return null;
    }
    if (typeof value !== "string" || value !== value.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ||
        /^\d{7,15}$/.test(value)) {
        throw new TypeError(`Catalog ${label} geçersiz.`);
    }
    return value;
}

function requireContext(context) {
    if (!isPlainRecord(context)) {
        throw new TypeError("Catalog context geçersiz.");
    }
    return context;
}

function requireNow(clock) {
    let now;
    try {
        now = clock();
    } catch {
        throw new TypeError("Catalog clock geçersiz.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Catalog clock geçersiz.");
    }
    return now;
}

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertTenantRegistry(value) {
    if (!value || typeof value.getById !== "function") {
        failDependency("tenant registry");
    }
    return value;
}

function assertProductRepository(value) {
    if (!value || typeof value.listByTenant !== "function" ||
        typeof value.getById !== "function" ||
        typeof value.commitCreate !== "function" ||
        typeof value.commitUpdate !== "function") {
        failDependency("product repository");
    }
    return value;
}

function assertEntitlementService(value) {
    if (!value || typeof value.assertFeatureAccess !== "function") {
        failDependency("entitlement service");
    }
    return value;
}

function assertKnownCatalogEntitlement(entitlement) {
    if (!entitlement || typeof entitlement !== "object" ||
        entitlement.feature !== CATALOG_FEATURE ||
        entitlement.featureEnabled !== true) {
        throw safeError("ENTITLEMENT_DENIED", "Catalog erişimi kullanılamıyor.");
    }
    if (entitlement.usedDefaultPlanPolicy === true) {
        throw safeError(
            "ENTITLEMENT_PLAN_UNRESOLVED",
            "Tenant planı catalog erişimi için doğrulanamadı."
        );
    }
    return entitlement;
}

function createCatalogService({
    tenantRegistry,
    productRepository,
    entitlementService,
    clock = () => new Date(),
    idFactory = () => crypto.randomUUID()
}) {
    const tenants = assertTenantRegistry(tenantRegistry);
    const products = assertProductRepository(productRepository);
    const entitlements = assertEntitlementService(entitlementService);
    if (typeof clock !== "function" || typeof idFactory !== "function") {
        failDependency("clock/idFactory");
    }

    async function authorizeAndLoad(contextValue, rawTenantId) {
        const context = requireContext(contextValue);
        const tenantId = requireCanonicalTenantId(rawTenantId);

        authorizeTenantAction({
            context,
            tenantId,
            permission: CATALOG_PERMISSION
        });

        const tenant = await tenants.getById(tenantId);
        if (!tenant) {
            throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        }
        if (!isPlainRecord(tenant) || tenant.tenantId !== tenantId ||
            requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_RECORD_INVALID", "Tenant kaydı doğrulanamadı.");
        }

        const entitlement = entitlements.assertFeatureAccess({
            context,
            tenant,
            permission: CATALOG_PERMISSION,
            feature: CATALOG_FEATURE
        });
        assertKnownCatalogEntitlement(entitlement);
        return { context, tenantId, tenant };
    }

    function requireMutationActor(context) {
        return requireOpaqueIdentifier(
            ownDataValue(context, "actorId"),
            "actorId"
        );
    }

    function requireRequestId(value) {
        return requireOpaqueIdentifier(value, "requestId", { optional: true });
    }

    function assertTenantMutable(tenant) {
        if (tenant.status === "archived") {
            throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant catalog değiştiremez.");
        }
    }

    return Object.freeze({
        async list({ context, tenantId, includeArchived = false, limit = 100 } = {}) {
            if (typeof includeArchived !== "boolean") {
                throw new TypeError("Catalog includeArchived geçersiz.");
            }
            const authorized = await authorizeAndLoad(context, tenantId);
            const records = await products.listByTenant(authorized.tenantId, { limit });
            if (!Array.isArray(records)) {
                throw safeError("CATALOG_UNAVAILABLE", "Catalog listesi alınamadı.");
            }
            return Object.freeze(records
                .filter(product => includeArchived || product.archived !== true)
                .map(projectProduct));
        },

        async create({ context, tenantId, product, requestId = null } = {}) {
            const authorized = await authorizeAndLoad(context, tenantId);
            assertTenantMutable(authorized.tenant);
            const actorId = requireMutationActor(authorized.context);
            const safeRequestId = requireRequestId(requestId);
            const productId = requireProductId(idFactory());
            const now = requireNow(clock);
            const record = createProductRecord({
                tenantId: authorized.tenantId,
                productId,
                draft: product,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "catalog.product.created",
                actorId,
                requestId: safeRequestId,
                metadata: { productId },
                now
            });
            await products.commitCreate({ product: record, auditEvent });
            return projectProduct(record);
        },

        async update({ context, tenantId, productId, patch, requestId = null } = {}) {
            const authorized = await authorizeAndLoad(context, tenantId);
            assertTenantMutable(authorized.tenant);
            const safeProductId = requireProductId(productId);
            const current = await products.getById(authorized.tenantId, safeProductId);
            if (!current) {
                throw safeError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
            }
            const now = requireNow(clock);
            const next = applyProductPatch(current, patch, now);
            const actorId = requireMutationActor(authorized.context);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "catalog.product.updated",
                actorId,
                requestId: requireRequestId(requestId),
                metadata: { productId: safeProductId },
                now
            });
            await products.commitUpdate({
                expectedProduct: current,
                nextProduct: next,
                auditEvent
            });
            return projectProduct(next);
        },

        async archive({ context, tenantId, productId, requestId = null } = {}) {
            const authorized = await authorizeAndLoad(context, tenantId);
            assertTenantMutable(authorized.tenant);
            const safeProductId = requireProductId(productId);
            const current = await products.getById(authorized.tenantId, safeProductId);
            if (!current) {
                throw safeError("PRODUCT_NOT_FOUND", "Ürün bulunamadı.");
            }
            if (current.archived === true) {
                return projectProduct(current);
            }
            const now = requireNow(clock);
            const next = archiveProductRecord(current, now);
            const actorId = requireMutationActor(authorized.context);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "catalog.product.archived",
                actorId,
                requestId: requireRequestId(requestId),
                metadata: { productId: safeProductId },
                now
            });
            await products.commitUpdate({
                expectedProduct: current,
                nextProduct: next,
                auditEvent
            });
            return projectProduct(next);
        }
    });
}

module.exports = {
    CATALOG_FEATURE,
    CATALOG_PERMISSION,
    createCatalogService
};
