const rateLimit = require("express-rate-limit");

const PUBLIC_QUOTE_PATH = "/api/public/quotes/:tenantId";

function createQuoteRateLimiter({ windowMs = 60_000, max = 30 } = {}) {
    const safeWindowMs = Number(windowMs);
    const safeMax = Number(max);
    if (!Number.isSafeInteger(safeWindowMs) || safeWindowMs < 1_000 || safeWindowMs > 3_600_000 ||
        !Number.isSafeInteger(safeMax) || safeMax < 1 || safeMax > 1_000) {
        throw new TypeError("Quote rate limit geçersiz.");
    }
    return rateLimit({
        windowMs: safeWindowMs,
        max: safeMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: "Çok fazla teklif talebi gönderildi." }
    });
}

function sendError(res, error) {
    if (new Set([
        "QUOTE_NOT_AVAILABLE",
        "TENANT_NOT_FOUND",
        "ENTITLEMENT_DENIED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Teklif formu bulunamadı." });
    }
    if (error?.code === "QUOTE_IDEMPOTENCY_CONFLICT") {
        return res.status(409).json({ success: false, message: "Teklif talebi önceki gönderimle uyuşmuyor." });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({ success: false, message: "Teklif talebi geçersiz." });
    }
    console.error("Public quote oluşturulamadı.", error?.code || "UNEXPECTED");
    return res.status(500).json({ success: false, message: "Teklif talebi kaydedilemedi." });
}

function attachPublicQuoteRuntime({ app, quoteService, rateLimiter = null } = {}) {
    if (!app || typeof app.post !== "function") throw new TypeError("Public quote app geçersiz.");
    if (!quoteService || typeof quoteService.createPublic !== "function") {
        throw new TypeError("Public quote service geçersiz.");
    }
    const limiter = rateLimiter || createQuoteRateLimiter();
    if (typeof limiter !== "function") throw new TypeError("Public quote limiter geçersiz.");

    app.post(PUBLIC_QUOTE_PATH, limiter, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) throw new TypeError("Quote query kabul etmez.");
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            const result = await quoteService.createPublic({
                tenantId: req.params.tenantId,
                input: req.body,
                idempotencyKey: req.get("Idempotency-Key")
            });
            return res.status(result.created ? 201 : 200).json({ success: true, quote: result.quote });
        } catch (error) {
            return sendError(res, error);
        }
    });
    return app;
}

module.exports = {
    PUBLIC_QUOTE_PATH,
    attachPublicQuoteRuntime,
    createQuoteRateLimiter
};
