const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("node:path");
const { requireTenantId } = require("../tenant/tenant-id");

const PUBLIC_STOREFRONT_API = "/api/public/storefront/:tenantId";
const PUBLIC_STOREFRONT_CSP = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'"
].join("; ");

function createStorefrontRateLimiter({ windowMs = 60_000, max = 180 } = {}) {
    const safeWindowMs = Number(windowMs);
    const safeMax = Number(max);
    if (!Number.isSafeInteger(safeWindowMs) || safeWindowMs < 1_000 ||
        safeWindowMs > 3_600_000 || !Number.isSafeInteger(safeMax) ||
        safeMax < 1 || safeMax > 10_000) {
        throw new TypeError("Storefront rate limit geçersiz.");
    }
    return rateLimit({
        windowMs: safeWindowMs,
        max: safeMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: "Çok fazla storefront isteği gönderildi."
        }
    });
}

function canonicalTenantId(value) {
    if (typeof value !== "string") return null;
    try {
        const tenantId = requireTenantId(value);
        return tenantId === value ? tenantId : null;
    } catch {
        return null;
    }
}

function sendStorefrontError(res, error) {
    if (error?.code === "STOREFRONT_NOT_AVAILABLE") {
        return res.status(404).json({
            success: false,
            message: "İşletme sayfası bulunamadı."
        });
    }
    if (error?.code === "STOREFRONT_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "İşletme sayfası şu anda kullanılamıyor."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "İşletme bağlantısı geçersiz."
        });
    }
    console.error("Public storefront okunamadı.", error?.code || "UNEXPECTED");
    return res.status(500).json({
        success: false,
        message: "İşletme sayfası yüklenemedi."
    });
}

function attachPublicStorefrontRuntime({ app, storefrontService, rateLimiter = null }) {
    if (!app || typeof app.use !== "function" || typeof app.get !== "function") {
        throw new TypeError("Public storefront app geçersiz.");
    }
    if (!storefrontService || typeof storefrontService.get !== "function") {
        throw new TypeError("Public storefront service geçersiz.");
    }
    const limiter = rateLimiter || createStorefrontRateLimiter();
    if (typeof limiter !== "function") {
        throw new TypeError("Public storefront rate limiter geçersiz.");
    }

    const publicDir = path.join(__dirname, "../../public/storefront");
    app.use("/m", (req, res, next) => {
        res.set("Content-Security-Policy", PUBLIC_STOREFRONT_CSP);
        res.set("Referrer-Policy", "strict-origin-when-cross-origin");
        next();
    });
    app.use("/m", express.static(publicDir, {
        index: false,
        etag: true,
        maxAge: "5m"
    }));
    app.get("/m/:tenantId/appointments", limiter, (req, res) => {
        if (!canonicalTenantId(req.params.tenantId)) {
            return res.status(404).send("İşletme bulunamadı.");
        }
        return res.sendFile(path.join(publicDir, "appointments.html"));
    });
    app.get("/m/:tenantId", limiter, (req, res) => {
        if (!canonicalTenantId(req.params.tenantId)) {
            return res.status(404).send("İşletme bulunamadı.");
        }
        return res.sendFile(path.join(publicDir, "index.html"));
    });

    app.get(PUBLIC_STOREFRONT_API, limiter, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Storefront sorgu parametresi kabul etmez.");
            }
            const storefront = await storefrontService.get({
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, storefront });
        } catch (error) {
            return sendStorefrontError(res, error);
        }
    });

    return app;
}

module.exports = {
    PUBLIC_STOREFRONT_API,
    PUBLIC_STOREFRONT_CSP,
    attachPublicStorefrontRuntime,
    createStorefrontRateLimiter,
    sendStorefrontError
};
