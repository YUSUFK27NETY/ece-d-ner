const rateLimit = require("express-rate-limit");

const PUBLIC_FULFILLMENT_PATH = "/api/public/fulfillment/:tenantId";

function createFulfillmentRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
    const safeWindowMs = Number(windowMs);
    const safeMax = Number(max);
    if (!Number.isSafeInteger(safeWindowMs) || safeWindowMs < 1_000 ||
        safeWindowMs > 3_600_000 || !Number.isSafeInteger(safeMax) ||
        safeMax < 1 || safeMax > 10_000) {
        throw new TypeError("Fulfillment rate limit geçersiz.");
    }
    return rateLimit({
        windowMs: safeWindowMs,
        max: safeMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: "Çok fazla fulfillment isteği gönderildi." }
    });
}

function sendError(res, error) {
    if (new Set([
        "FULFILLMENT_NOT_AVAILABLE",
        "TENANT_NOT_FOUND",
        "ENTITLEMENT_DENIED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Sipariş seçenekleri bulunamadı." });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({ success: false, message: "İşletme bağlantısı geçersiz." });
    }
    console.error("Public fulfillment okunamadı.", error?.code || "UNEXPECTED");
    return res.status(500).json({ success: false, message: "Sipariş seçenekleri yüklenemedi." });
}

function attachPublicFulfillmentRuntime({ app, inventoryDeliveryService, rateLimiter = null } = {}) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Public fulfillment app geçersiz.");
    }
    if (!inventoryDeliveryService || typeof inventoryDeliveryService.getPublicFulfillment !== "function") {
        throw new TypeError("Public fulfillment service geçersiz.");
    }
    const limiter = rateLimiter || createFulfillmentRateLimiter();
    if (typeof limiter !== "function") throw new TypeError("Public fulfillment limiter geçersiz.");

    app.get(PUBLIC_FULFILLMENT_PATH, limiter, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Public fulfillment query kabul etmez.");
            }
            const fulfillment = await inventoryDeliveryService.getPublicFulfillment({
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, fulfillment });
        } catch (error) {
            return sendError(res, error);
        }
    });
    return app;
}

module.exports = {
    PUBLIC_FULFILLMENT_PATH,
    attachPublicFulfillmentRuntime,
    createFulfillmentRateLimiter
};
