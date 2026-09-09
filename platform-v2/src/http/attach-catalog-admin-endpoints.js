const { sendPlatformError } = require("./create-platform-app");

const CATALOG_BASE = "/api/platform/tenants/:tenantId/catalog/products";

function normalizeCatalogLimit(value = 100) {
    const limit = typeof value === "string" && /^[1-9][0-9]{0,2}$/.test(value)
        ? Number(value)
        : value;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Catalog liste limiti geçersiz.");
    }
    return limit;
}

function normalizeIncludeArchived(value) {
    if (value === undefined) return false;
    if (value === "true") return true;
    if (value === "false") return false;
    throw new TypeError("Catalog includeArchived geçersiz.");
}

function assertQueryKeys(query, allowed) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Catalog sorgusu geçersiz.");
    }
    const keys = Reflect.ownKeys(query);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key))) {
        throw new TypeError("Catalog sorgusu geçersiz.");
    }
}

function hasCallerInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        contentLength !== undefined && contentLength !== "0" ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function actorContext(req) {
    return Object.freeze({
        role: req.platformActor.role,
        actorId: req.platformActor.uid
    });
}

function sendCatalogError(res, error) {
    if (error?.code === "PRODUCT_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "Ürün bulunamadı."
        });
    }
    if (new Set([
        "PRODUCT_ARCHIVED",
        "CATALOG_PRODUCT_STATE_CHANGED",
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Catalog işlemi mevcut tenant/ürün durumuyla uyumlu değil."
        });
    }
    if (error?.code === "CATALOG_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Catalog şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function attachCatalogAdminEndpoints({ app, catalogService }) {
    if (!app || typeof app.get !== "function" ||
        typeof app.post !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Catalog admin endpoint app geçersiz.");
    }
    if (!catalogService || typeof catalogService.list !== "function" ||
        typeof catalogService.create !== "function" ||
        typeof catalogService.update !== "function" ||
        typeof catalogService.archive !== "function") {
        throw new TypeError("Catalog service geçersiz.");
    }

    app.get(CATALOG_BASE, async (req, res) => {
        try {
            assertQueryKeys(req.query, ["limit", "includeArchived"]);
            const products = await catalogService.list({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                limit: normalizeCatalogLimit(
                    req.query.limit === undefined ? 100 : req.query.limit
                ),
                includeArchived: normalizeIncludeArchived(req.query.includeArchived)
            });
            return res.json({ success: true, products });
        } catch (error) {
            return sendCatalogError(res, error);
        }
    });

    app.post(CATALOG_BASE, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
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
            return sendCatalogError(res, error);
        }
    });

    app.patch(`${CATALOG_BASE}/:productId`, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
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
            return sendCatalogError(res, error);
        }
    });

    app.post(`${CATALOG_BASE}/:productId/archive`, async (req, res) => {
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
            return sendCatalogError(res, error);
        }
    });

    return app;
}

module.exports = {
    CATALOG_BASE,
    normalizeCatalogLimit,
    normalizeIncludeArchived,
    attachCatalogAdminEndpoints
};
