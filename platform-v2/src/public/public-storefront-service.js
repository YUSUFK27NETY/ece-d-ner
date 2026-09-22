const { FEATURE_CATALOG, createFeatureFlags } = require("../tenant/feature-catalog");
const { createTenantProfile, normalizeDomain } = require("../tenant/tenant-profile");
const { requireTenantId } = require("../tenant/tenant-id");
const { projectProduct } = require("../catalog/product-model");
const {
    createStorefrontPresentationManifest
} = require("../presentation/storefront-presentation-service");

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Storefront tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Storefront tenantId geçersiz.");
    }
    return tenantId;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") {
        throw new TypeError("Storefront domain geçersiz.");
    }
    const domain = normalizeDomain(value);
    if (!domain || domain !== value) {
        throw new TypeError("Storefront domain geçersiz.");
    }
    return domain;
}

function requireDependency(value, methods, label) {
    if (!value || typeof value !== "object" ||
        methods.some(method => typeof value[method] !== "function")) {
        throw new TypeError(`Storefront ${label} geçersiz.`);
    }
    return value;
}

function projectEffectiveFeatures({ tenant, entitlementService }) {
    const stored = createFeatureFlags(tenant.features || {});
    const effective = {};

    for (const feature of Object.keys(FEATURE_CATALOG)) {
        if (stored[feature] !== true) {
            effective[feature] = false;
            continue;
        }
        const entitlement = entitlementService.evaluate({ tenant, feature });
        effective[feature] = entitlement?.featureEnabled === true &&
            entitlement?.usedDefaultPlanPolicy !== true;
    }

    return Object.freeze(effective);
}

function projectPublicProduct(product, { includeImage = true } = {}) {
    if (typeof includeImage !== "boolean") {
        throw new TypeError("Storefront product image projection geçersiz.");
    }
    const safe = projectProduct(product);
    return Object.freeze({
        productId: safe.productId,
        name: safe.name,
        category: safe.category,
        price: safe.price,
        description: safe.description,
        imageUrl: includeImage ? safe.imageUrl : ""
    });
}

function projectPublicTenant(tenant, effectiveFeatures) {
    const profile = createTenantProfile(tenant.profile || {});
    return Object.freeze({
        tenantId: tenant.tenantId,
        displayName: String(tenant.displayName || "").trim(),
        sector: String(tenant.sector || "").trim(),
        features: effectiveFeatures,
        profile: Object.freeze({
            brandName: profile.brandName,
            phone: profile.phone,
            whatsapp: profile.whatsapp,
            email: profile.email,
            website: profile.website,
            logoUrl: profile.logoUrl,
            primaryColor: profile.primaryColor,
            address: profile.address,
            timezone: profile.timezone
        })
    });
}

function createPublicStorefrontService({
    tenantRegistry,
    productRepository,
    entitlementService,
    productLimit = 200
}) {
    const tenants = requireDependency(tenantRegistry, ["getById"], "tenant registry");
    const products = requireDependency(productRepository, ["listByTenant"], "product repository");
    const entitlements = requireDependency(entitlementService, ["evaluate"], "entitlement service");
    if (!Number.isSafeInteger(productLimit) || productLimit < 1 || productLimit > 200) {
        throw new TypeError("Storefront ürün limiti geçersiz.");
    }

    async function loadActiveTenant({ tenantId, expectedDomain = null }) {
        const tenant = await tenants.getById(tenantId);

        if (!tenant || tenant.tenantId !== tenantId || tenant.status !== "active") {
            throw safeError("STOREFRONT_NOT_AVAILABLE", "Storefront kullanılamıyor.");
        }

        if (expectedDomain !== null) {
            const profile = createTenantProfile(tenant.profile || {});
            if (profile.customDomain !== expectedDomain) {
                throw safeError("STOREFRONT_NOT_AVAILABLE", "Storefront kullanılamıyor.");
            }
        }

        return tenant;
    }

    async function projectStorefront({ tenantId, expectedDomain = null }) {
        const tenant = await loadActiveTenant({ tenantId, expectedDomain });

        const effectiveFeatures = projectEffectiveFeatures({
            tenant,
            entitlementService: entitlements
        });
        const presentation = createStorefrontPresentationManifest({
            tenant,
            effectiveFeatures
        });
        let publicProducts = [];

        if (effectiveFeatures.catalog) {
            const records = await products.listByTenant(tenantId, { limit: productLimit });
            if (!Array.isArray(records)) {
                throw safeError("STOREFRONT_UNAVAILABLE", "Storefront catalog alınamadı.");
            }
            publicProducts = records
                .filter(product => product && product.archived !== true && product.available === true)
                .map(product => projectPublicProduct(product, {
                    includeImage: effectiveFeatures.gallery === true
                }));
        }

        return Object.freeze({
            tenant: projectPublicTenant(tenant, effectiveFeatures),
            products: Object.freeze(publicProducts),
            presentation
        });
    }

    return Object.freeze({
        async get({ tenantId: rawTenantId } = {}) {
            return projectStorefront({
                tenantId: requireCanonicalTenantId(rawTenantId)
            });
        },

        async verifyDomainRoute({ tenantId: rawTenantId, domain: rawDomain } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const domain = requireCanonicalDomain(rawDomain);
            await loadActiveTenant({
                tenantId,
                expectedDomain: domain
            });
            return Object.freeze({ tenantId, domain });
        },

        async getByDomain({ tenantId: rawTenantId, domain: rawDomain } = {}) {
            return projectStorefront({
                tenantId: requireCanonicalTenantId(rawTenantId),
                expectedDomain: requireCanonicalDomain(rawDomain)
            });
        }
    });
}

module.exports = {
    createPublicStorefrontService,
    projectEffectiveFeatures,
    projectPublicProduct,
    projectPublicTenant
};
