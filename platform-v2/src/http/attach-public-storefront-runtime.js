const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("node:path");
const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");

const PUBLIC_STOREFRONT_API = "/api/public/storefront/:tenantId";
const PUBLIC_HOST_STOREFRONT_API = "/api/public/storefront-host";
const PUBLIC_DEPLOYMENT_API = "/api/public/deployment";
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PUBLIC_TENANT_EDGE_NOISE = /^[\s\p{Cf}]+|[\s\p{Cf}]+$/gu;
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

function deploymentRevision(env = process.env) {
    const commit = String(env?.RENDER_GIT_COMMIT || "").trim().toLowerCase();
    return GIT_COMMIT_PATTERN.test(commit) ? commit : null;
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

function canonicalRequestDomain(req) {
    const hostname = String(req?.hostname || "").trim().toLowerCase();
    if (!hostname) return null;
    try {
        const domain = normalizeDomain(hostname);
        return domain === hostname ? domain : null;
    } catch {
        return null;
    }
}

function safeStorefrontError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function resolveActivePublicRoute({ routeReader, req }) {
    if (!routeReader || typeof routeReader.getByDomain !== "function") {
        throw safeStorefrontError(
            "STOREFRONT_NOT_AVAILABLE",
            "Custom domain storefront kullanılamıyor."
        );
    }
    const domain = canonicalRequestDomain(req);
    if (!domain) {
        throw safeStorefrontError(
            "STOREFRONT_NOT_AVAILABLE",
            "Custom domain storefront kullanılamıyor."
        );
    }

    let route;
    try {
        route = await routeReader.getByDomain(domain);
    } catch {
        throw safeStorefrontError(
            "STOREFRONT_UNAVAILABLE",
            "Custom domain route şu anda okunamıyor."
        );
    }
    if (!route || route.domain !== domain || route.state !== "active" ||
        !canonicalTenantId(route.tenantId)) {
        throw safeStorefrontError(
            "STOREFRONT_NOT_AVAILABLE",
            "Custom domain storefront kullanılamıyor."
        );
    }
    return route;
}

function recoverPublicTenantId(value) {
    if (typeof value !== "string") return null;
    const recovered = value.replace(PUBLIC_TENANT_EDGE_NOISE, "");
    if (!recovered || recovered === value) return null;
    return canonicalTenantId(recovered);
}

function hasMalformedPathEncoding(value) {
    const pathname = String(value ?? "").split("?", 1)[0];
    try {
        decodeURIComponent(pathname);
        return false;
    } catch {
        return true;
    }
}

function sendInvalidStorefrontPage(res, tenantId, suffix = "") {
    const recovered = recoverPublicTenantId(tenantId);
    if (recovered) {
        return res.redirect(308, `/m/${encodeURIComponent(recovered)}${suffix}`);
    }
    return res.status(404).send("İşletme bulunamadı.");
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

function attachPublicStorefrontRuntime({ app, storefrontService, routeReader = null, rateLimiter = null }) {
    if (!app || typeof app.use !== "function" || typeof app.get !== "function") {
        throw new TypeError("Public storefront app geçersiz.");
    }
    if (!storefrontService || typeof storefrontService.get !== "function") {
        throw new TypeError("Public storefront service geçersiz.");
    }
    if (routeReader !== null &&
        (!routeReader || typeof routeReader.getByDomain !== "function" ||
            typeof storefrontService.verifyDomainRoute !== "function" ||
            typeof storefrontService.getByDomain !== "function")) {
        throw new TypeError("Custom domain storefront runtime geçersiz.");
    }
    const limiter = rateLimiter || createStorefrontRateLimiter();
    if (typeof limiter !== "function") {
        throw new TypeError("Public storefront rate limiter geçersiz.");
    }

    const publicDir = path.join(__dirname, "../../public/storefront");

    app.get("/", limiter, async (req, res, next) => {
        if (routeReader === null) return next();
        try {
            const route = await resolveActivePublicRoute({ routeReader, req });
            await storefrontService.verifyDomainRoute({
                tenantId: route.tenantId,
                domain: route.domain
            });
            res.set("Content-Security-Policy", PUBLIC_STOREFRONT_CSP);
            res.set("Referrer-Policy", "strict-origin-when-cross-origin");
            return res.sendFile(path.join(publicDir, "index.html"));
        } catch (error) {
            if (error?.code === "STOREFRONT_UNAVAILABLE") {
                res.set("Content-Security-Policy", PUBLIC_STOREFRONT_CSP);
                return res.status(503).send("İşletme sayfası şu anda kullanılamıyor.");
            }
            if (error?.code === "STOREFRONT_NOT_AVAILABLE" ||
                error instanceof TypeError) {
                return next();
            }
            console.error("Custom domain storefront shell doğrulanamadı.");
            res.set("Content-Security-Policy", PUBLIC_STOREFRONT_CSP);
            return res.status(503).send("İşletme sayfası şu anda kullanılamıyor.");
        }
    });
    app.use("/m", (req, res, next) => {
        if (hasMalformedPathEncoding(req.url)) {
            return res.status(404).send("İşletme bulunamadı.");
        }
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
            return sendInvalidStorefrontPage(res, req.params.tenantId, "/appointments");
        }
        return res.sendFile(path.join(publicDir, "appointments.html"));
    });
    app.get("/m/:tenantId/quote", limiter, (req, res) => {
        if (!canonicalTenantId(req.params.tenantId)) {
            return sendInvalidStorefrontPage(res, req.params.tenantId, "/quote");
        }
        return res.sendFile(path.join(publicDir, "quote.html"));
    });
    app.get("/m/:tenantId", limiter, (req, res) => {
        if (!canonicalTenantId(req.params.tenantId)) {
            return sendInvalidStorefrontPage(res, req.params.tenantId);
        }
        return res.sendFile(path.join(publicDir, "index.html"));
    });

    app.get(PUBLIC_HOST_STOREFRONT_API, limiter, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Host storefront sorgu parametresi kabul etmez.");
            }
            const route = await resolveActivePublicRoute({ routeReader, req });
            const storefront = await storefrontService.getByDomain({
                tenantId: route.tenantId,
                domain: route.domain
            });
            return res.json({ success: true, storefront });
        } catch (error) {
            return sendStorefrontError(res, error);
        }
    });

    app.get(PUBLIC_DEPLOYMENT_API, limiter, (req, res) => {
        if (Reflect.ownKeys(req.query).length > 0) {
            return res.status(400).json({
                success: false,
                message: "Deployment sorgu parametresi kabul etmez."
            });
        }
        return res.json({
            success: true,
            deployment: {
                commit: deploymentRevision()
            }
        });
    });

    app.use("/api/public/storefront", (req, res, next) => {
        if (hasMalformedPathEncoding(req.url)) {
            return res.status(400).json({
                success: false,
                message: "İşletme bağlantısı geçersiz."
            });
        }
        return next();
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
    PUBLIC_DEPLOYMENT_API,
    PUBLIC_HOST_STOREFRONT_API,
    PUBLIC_STOREFRONT_API,
    PUBLIC_STOREFRONT_CSP,
    attachPublicStorefrontRuntime,
    createStorefrontRateLimiter,
    canonicalRequestDomain,
    deploymentRevision,
    hasMalformedPathEncoding,
    resolveActivePublicRoute,
    recoverPublicTenantId,
    sendStorefrontError
};
