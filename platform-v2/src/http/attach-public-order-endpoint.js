const rateLimit = require("express-rate-limit");

const PUBLIC_ORDER_PATH = "/api/public/orders";
const PUBLIC_ROUTE_HEADERS = Object.freeze({
    domain: "x-platform-route-host",
    timestamp: "x-platform-route-timestamp",
    signature: "x-platform-route-signature"
});

function createPublicOrderRateLimiter({
    windowMs = 60_000,
    max = 30
} = {}) {
    const safeWindowMs = Number(windowMs);
    const safeMax = Number(max);
    if (!Number.isSafeInteger(safeWindowMs) || safeWindowMs < 1_000 || safeWindowMs > 3_600_000 ||
        !Number.isSafeInteger(safeMax) || safeMax < 1 || safeMax > 10_000) {
        throw new TypeError("Public order rate limit geçersiz.");
    }
    return rateLimit({
        windowMs: safeWindowMs,
        max: safeMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: "Çok fazla sipariş isteği gönderildi."
        }
    });
}

function sendPublicOrderError(res, error) {
    const code = error && typeof error === "object"
        ? Object.getOwnPropertyDescriptor(error, "code")?.value
        : null;

    if (new Set([
        "PUBLIC_ROUTE_ATTESTATION_REQUIRED",
        "PUBLIC_ROUTE_NOT_FOUND",
        "PUBLIC_ROUTE_MISMATCH"
    ]).has(code)) {
        return res.status(404).json({
            success: false,
            message: "Sipariş yönlendirmesi kullanılamıyor."
        });
    }
    if (code === "PUBLIC_ROUTE_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Sipariş yönlendirmesi şu anda kullanılamıyor."
        });
    }
    if (new Set([
        "TENANT_NOT_ACTIVE",
        "ENTITLEMENT_DENIED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(code)) {
        return res.status(409).json({
            success: false,
            message: "İşletme şu anda sipariş alamıyor."
        });
    }
    if (new Set([
        "ORDER_IDEMPOTENCY_CONFLICT",
        "ORDER_PRODUCT_UNAVAILABLE",
        "ORDER_PRODUCT_INVALID",
        "ORDER_PRICE_CHANGED",
        "ORDER_TOTAL_INVALID"
    ]).has(code)) {
        return res.status(409).json({
            success: false,
            message: "Sipariş güncel ürün veya istek durumuyla uyuşmuyor."
        });
    }
    if (code === "ORDER_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Sipariş şu anda oluşturulamıyor."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Sipariş isteği geçersiz."
        });
    }

    console.error("Public order işlemi tamamlanamadı.", code || "UNEXPECTED");
    return res.status(500).json({
        success: false,
        message: "Sipariş tamamlanamadı."
    });
}

function attachPublicOrderEndpoint({
    app,
    orderService,
    publicTenantResolver,
    rateLimiter = null
} = {}) {
    if (!app || typeof app.post !== "function") {
        throw new TypeError("Public order endpoint app geçersiz.");
    }
    if (!orderService || typeof orderService.createCustomerOrder !== "function") {
        throw new TypeError("Public order endpoint order service geçersiz.");
    }
    if (!publicTenantResolver || typeof publicTenantResolver.resolve !== "function") {
        throw new TypeError("Public order endpoint tenant resolver geçersiz.");
    }
    const limiter = rateLimiter || createPublicOrderRateLimiter();
    if (typeof limiter !== "function") {
        throw new TypeError("Public order endpoint rate limiter geçersiz.");
    }

    app.post(PUBLIC_ORDER_PATH, limiter, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Public order query kabul etmez.");
            }

            const resolution = await publicTenantResolver.resolve({
                method: req.method,
                path: req.path,
                domain: req.get(PUBLIC_ROUTE_HEADERS.domain),
                timestamp: req.get(PUBLIC_ROUTE_HEADERS.timestamp),
                signature: req.get(PUBLIC_ROUTE_HEADERS.signature)
            });

            const order = await orderService.createCustomerOrder({
                resolution,
                request: req.body,
                idempotencyKey: req.get("Idempotency-Key"),
                requestId: req.requestId || null
            });

            return res.status(200).json({
                success: true,
                order
            });
        } catch (error) {
            return sendPublicOrderError(res, error);
        }
    });

    return app;
}

module.exports = {
    PUBLIC_ORDER_PATH,
    PUBLIC_ROUTE_HEADERS,
    attachPublicOrderEndpoint,
    createPublicOrderRateLimiter,
    sendPublicOrderError
};
