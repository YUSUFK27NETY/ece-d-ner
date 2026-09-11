const express = require("express");
const path = require("node:path");
const { FEATURE_CATALOG, createFeatureFlags } = require("../tenant/feature-catalog");
const { createTenantProfile } = require("../tenant/tenant-profile");
const { sendPlatformError } = require("./create-platform-app");
const {
    normalizeCatalogLimit,
    normalizeIncludeArchived
} = require("./attach-catalog-admin-endpoints");
const { normalizeOrderListLimit } = require("./attach-order-admin-endpoints");

const OWNER_API_BASE = "/api/tenant/tenants/:tenantId/owner";
const OWNER_CSP = [
    "default-src 'self'",
    "script-src 'self' https://www.gstatic.com",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self' https://*.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com",
    "frame-src https://*.firebaseapp.com https://*.web.app",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
].join("; ");

const OWNER_ROLES = new Set(["tenant_owner", "tenant_admin"]);

function requireOwnerRole(req, res, next) {
    if (!req.tenantActor || !OWNER_ROLES.has(req.tenantActor.role)) {
        return res.status(403).json({
            success: false,
            message: "İşletme sahibi veya yönetici yetkisi gerekli."
        });
    }
    return next();
}

function actorContext(req) {
    return Object.freeze({
        role: req.tenantActor.role,
        actorId: req.tenantActor.actorId,
        tenantId: req.tenantActor.tenantId
    });
}

function assertListQuery(query, allowed) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Liste sorgusu geçersiz.");
    }
    const keys = Reflect.ownKeys(query);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key))) {
        throw new TypeError("Liste sorgusu geçersiz.");
    }
}

function hasCallerInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        contentLength !== undefined && contentLength !== "0" ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function requireStatusBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype) {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 1 || keys[0] !== "status") {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(body, "status");
    if (!descriptor || !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string") {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    return descriptor.value;
}

function projectOwnerTenant(tenant) {
    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
        throw new TypeError("Tenant kaydı geçersiz.");
    }

    const features = createFeatureFlags(tenant.features || {});
    const profile = createTenantProfile(tenant.profile || {});
    const projectedFeatures = {};
    for (const key of Object.keys(FEATURE_CATALOG)) {
        projectedFeatures[key] = features[key] === true;
    }

    return Object.freeze({
        tenantId: String(tenant.tenantId || ""),
        displayName: String(tenant.displayName || ""),
        sector: String(tenant.sector || ""),
        status: String(tenant.status || ""),
        plan: String(tenant.plan || ""),
        features: Object.freeze(projectedFeatures),
        profile
    });
}

function sendOwnerBusinessError(res, error) {
    if (new Set(["PRODUCT_NOT_FOUND", "ORDER_NOT_FOUND", "TENANT_NOT_FOUND"]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Kayıt bulunamadı." });
    }
    if (new Set([
        "PRODUCT_ARCHIVED",
        "CATALOG_PRODUCT_STATE_CHANGED",
        "ORDER_STATUS_INVALID_TRANSITION",
        "ORDER_STATE_CHANGED",
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "İşlem mevcut işletme/kayıt durumuyla uyumlu değil."
        });
    }
    if (new Set(["CATALOG_UNAVAILABLE", "ORDER_UNAVAILABLE"]).has(error?.code)) {
        return res.status(503).json({
            success: false,
            message: "İşletme verileri şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function attachTenantOwnerRuntime({
    app,
    webConfig = null,
    tenantRegistry,
    catalogService,
    orderService
}) {
    if (!app || typeof app.use !== "function" || typeof app.get !== "function" ||
        typeof app.post !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Tenant owner runtime app geçersiz.");
    }
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Tenant owner runtime registry geçersiz.");
    }
    if (!catalogService || typeof catalogService.list !== "function" ||
        typeof catalogService.create !== "function" ||
        typeof catalogService.update !== "function" ||
        typeof catalogService.archive !== "function") {
        throw new TypeError("Tenant owner runtime catalog service geçersiz.");
    }
    if (!orderService || typeof orderService.listAdmin !== "function" ||
        typeof orderService.getAdmin !== "function" ||
        typeof orderService.updateStatus !== "function") {
        throw new TypeError("Tenant owner runtime order service geçersiz.");
    }

    const ownerPublicDir = path.join(__dirname, "../../public/owner");

    app.use("/owner", (req, res, next) => {
        res.set("Content-Security-Policy", OWNER_CSP);
        next();
    });
    app.get("/owner/config.js", (req, res) => {
        res.type("application/javascript");
        res.send(`window.OWNER_BOOTSTRAP = ${JSON.stringify({ firebase: webConfig })};`);
    });
    app.use("/owner", express.static(ownerPublicDir, {
        index: "index.html",
        etag: true,
        maxAge: "5m"
    }));

    app.use(OWNER_API_BASE, requireOwnerRole);

    app.get(`${OWNER_API_BASE}/overview`, async (req, res) => {
        try {
            const tenant = await tenantRegistry.getById(req.params.tenantId);
            if (!tenant || tenant.tenantId !== req.tenantActor.tenantId) {
                return res.status(404).json({
                    success: false,
                    message: "İşletme bulunamadı."
                });
            }
            return res.json({
                success: true,
                tenant: projectOwnerTenant(tenant),
                session: Object.freeze({
                    role: req.tenantActor.role,
                    tenantId: req.tenantActor.tenantId
                })
            });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    const catalogBase = `${OWNER_API_BASE}/catalog/products`;
    app.get(catalogBase, async (req, res) => {
        try {
            assertListQuery(req.query, ["limit", "includeArchived"]);
            const products = await catalogService.list({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                limit: normalizeCatalogLimit(req.query.limit === undefined ? 100 : req.query.limit),
                includeArchived: normalizeIncludeArchived(req.query.includeArchived)
            });
            return res.json({ success: true, products });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    app.post(catalogBase, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Catalog create sorgu parametresi kabul etmez.");
            }
            const product = await catalogService.create({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                product: req.body,
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, product });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    app.patch(`${catalogBase}/:productId`, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Catalog update sorgu parametresi kabul etmez.");
            }
            const product = await catalogService.update({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                productId: req.params.productId,
                patch: req.body,
                requestId: req.requestId
            });
            return res.json({ success: true, product });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    app.post(`${catalogBase}/:productId/archive`, async (req, res) => {
        try {
            if (hasCallerInput(req)) {
                throw new TypeError("Catalog archive isteği gövde veya sorgu kabul etmez.");
            }
            const product = await catalogService.archive({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                productId: req.params.productId,
                requestId: req.requestId
            });
            return res.json({ success: true, product });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    const orderBase = `${OWNER_API_BASE}/orders`;
    app.get(orderBase, async (req, res) => {
        try {
            assertListQuery(req.query, ["limit"]);
            const orders = await orderService.listAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                limit: normalizeOrderListLimit(req.query.limit === undefined ? 100 : req.query.limit)
            });
            return res.json({ success: true, orders });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    app.get(`${orderBase}/:orderId`, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Sipariş detay sorgusu parametre kabul etmez.");
            }
            const order = await orderService.getAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                orderId: req.params.orderId
            });
            return res.json({ success: true, order });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    app.patch(`${orderBase}/:orderId/status`, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Sipariş durum isteği sorgu parametresi kabul etmez.");
            }
            const order = await orderService.updateStatus({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                orderId: req.params.orderId,
                status: requireStatusBody(req.body),
                requestId: req.requestId
            });
            return res.json({ success: true, order });
        } catch (error) {
            return sendOwnerBusinessError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_API_BASE,
    OWNER_CSP,
    OWNER_ROLES,
    attachTenantOwnerRuntime,
    projectOwnerTenant,
    requireOwnerRole
};
