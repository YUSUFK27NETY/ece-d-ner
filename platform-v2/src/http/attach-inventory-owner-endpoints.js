const { sendPlatformError } = require("./create-platform-app");

const BASE = "/api/tenant/tenants/:tenantId/owner";

function context(req) {
    return Object.freeze({
        role: req.tenantActor?.role,
        actorId: req.tenantActor?.actorId,
        tenantId: req.tenantActor?.tenantId
    });
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Inventory endpoint sorgu parametresi kabul etmez.");
    }
}

function sendError(res, error) {
    if (new Set(["TENANT_NOT_FOUND", "PRODUCT_NOT_FOUND"]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Kayıt bulunamadı." });
    }
    if (new Set([
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED",
        "ENTITLEMENT_DENIED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "İşlem mevcut işletme veya modül durumuyla uyumlu değil."
        });
    }
    if (error?.code === "INVENTORY_UNAVAILABLE") {
        return res.status(503).json({ success: false, message: "Stok bilgisi şu anda alınamıyor." });
    }
    return sendPlatformError(res, error);
}

function attachInventoryOwnerEndpoints({ app, inventoryDeliveryService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Inventory owner endpoint app geçersiz.");
    }
    if (!inventoryDeliveryService ||
        typeof inventoryDeliveryService.listInventoryAdmin !== "function" ||
        typeof inventoryDeliveryService.setInventoryAdmin !== "function" ||
        typeof inventoryDeliveryService.getFulfillmentAdmin !== "function" ||
        typeof inventoryDeliveryService.updateFulfillmentAdmin !== "function") {
        throw new TypeError("Inventory owner service geçersiz.");
    }

    app.get(`${BASE}/inventory`, async (req, res) => {
        try {
            noQuery(req);
            const inventory = await inventoryDeliveryService.listInventoryAdmin({
                context: context(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, inventory });
        } catch (error) {
            return sendError(res, error);
        }
    });

    app.patch(`${BASE}/inventory/:productId`, async (req, res) => {
        try {
            noQuery(req);
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            const inventory = await inventoryDeliveryService.setInventoryAdmin({
                context: context(req),
                tenantId: req.params.tenantId,
                productId: req.params.productId,
                input: req.body,
                requestId: req.requestId || null
            });
            return res.json({ success: true, inventory });
        } catch (error) {
            return sendError(res, error);
        }
    });

    app.get(`${BASE}/fulfillment`, async (req, res) => {
        try {
            noQuery(req);
            const fulfillment = await inventoryDeliveryService.getFulfillmentAdmin({
                context: context(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, fulfillment });
        } catch (error) {
            return sendError(res, error);
        }
    });

    app.patch(`${BASE}/fulfillment`, async (req, res) => {
        try {
            noQuery(req);
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            const fulfillment = await inventoryDeliveryService.updateFulfillmentAdmin({
                context: context(req),
                tenantId: req.params.tenantId,
                input: req.body,
                requestId: req.requestId || null
            });
            return res.json({ success: true, fulfillment });
        } catch (error) {
            return sendError(res, error);
        }
    });

    return app;
}

module.exports = { INVENTORY_OWNER_BASE: BASE, attachInventoryOwnerEndpoints };
