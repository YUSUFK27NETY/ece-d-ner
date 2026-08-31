const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const path = require("node:path");
const { createRequirePlatformAdmin } = require("../auth/require-platform-admin");
const { createTenantOnboardingService } = require("../tenant/onboarding-service");
const { createTenantManagementService } = require("../tenant/tenant-management-service");
const { requireTenantId } = require("../tenant/tenant-id");

const ADMIN_CSP = [
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

function normalizeApiListLimit(value = 100) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Tenant liste limiti 1-200 arasında olmalı.");
    }

    return limit;
}

function createPlatformCorsMiddleware(allowedOrigins = []) {
    const allowlist = new Set(allowedOrigins);

    return function platformCors(req, res, next) {
        const origin = req.headers.origin;

        if (!origin) {
            return next();
        }

        const selfOrigin = `${req.protocol}://${req.get("host")}`;
        const allowed = origin === selfOrigin || allowlist.has(origin);

        if (!allowed) {
            return res.status(403).json({
                success: false,
                message: "Bu origin Platform API için yetkili değil."
            });
        }

        res.set("Access-Control-Allow-Origin", origin);
        res.set("Vary", "Origin");
        res.set("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
        res.set("Access-Control-Allow-Headers", "Authorization,Content-Type");
        res.set("Access-Control-Max-Age", "600");

        if (req.method === "OPTIONS") {
            return res.status(204).end();
        }

        return next();
    };
}

function createPlatformApp({
    auth,
    tenantRegistry,
    auditWriter = null,
    webConfig = null,
    allowedOrigins = []
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function" ||
        typeof tenantRegistry.list !== "function" ||
        typeof tenantRegistry.create !== "function" ||
        typeof tenantRegistry.update !== "function") {
        throw new TypeError("Tenant registry getById/list/create/update metodlarını uygulamalı.");
    }

    const app = express();
    const requirePlatformAdmin = createRequirePlatformAdmin({ auth });
    const onboarding = createTenantOnboardingService({
        tenantRegistry,
        auditWriter
    });
    const tenantManagement = createTenantManagementService({
        tenantRegistry,
        auditWriter
    });
    const platformCors = createPlatformCorsMiddleware(allowedOrigins);
    const adminPublicDir = path.join(__dirname, "../../public/admin");

    app.disable("x-powered-by");
    app.set("trust proxy", 1);

    app.use((req, res, next) => {
        req.requestId = crypto.randomUUID();
        res.set({
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
            "X-Request-Id": req.requestId,
            "Cache-Control": "no-store"
        });

        if (req.path === "/admin" || req.path.startsWith("/admin/")) {
            res.set("Content-Security-Policy", ADMIN_CSP);
        } else {
            res.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
        }

        if (req.secure) {
            res.set(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains"
            );
        }

        next();
    });

    app.get("/admin/config.js", (req, res) => {
        res.type("application/javascript");
        res.send(
            `window.PLATFORM_BOOTSTRAP = ${JSON.stringify({ firebase: webConfig })};`
        );
    });

    app.use("/admin", express.static(adminPublicDir, {
        index: "index.html",
        etag: true,
        maxAge: "5m"
    }));

    app.use(express.json({
        limit: "32kb",
        strict: true
    }));

    const adminLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
            success: false,
            message: "Çok fazla yönetim isteği gönderildi."
        }
    });

    app.get("/health", (req, res) => {
        res.json({
            success: true,
            status: "ok",
            service: "platform-v2-admin-api"
        });
    });

    app.use("/api/platform", platformCors, adminLimiter, requirePlatformAdmin);

    app.get("/api/platform/tenants", async (req, res) => {
        try {
            const limit = normalizeApiListLimit(
                req.query.limit === undefined ? 100 : req.query.limit
            );
            const tenants = await tenantRegistry.list({ limit });

            return res.json({
                success: true,
                tenants
            });
        } catch (error) {
            return sendPlatformError(res, error);
        }
    });

    app.get("/api/platform/tenants/:tenantId", async (req, res) => {
        try {
            const tenantId = requireTenantId(req.params.tenantId);
            const tenant = await tenantRegistry.getById(tenantId);

            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: "İşletme bulunamadı."
                });
            }

            return res.json({
                success: true,
                tenant
            });
        } catch (error) {
            return sendPlatformError(res, error);
        }
    });

    app.post("/api/platform/tenants", async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }

            const tenant = await onboarding.onboard({
                ...req.body,
                createdBy: req.platformActor.uid,
                requestId: req.requestId
            });

            return res.status(201).json({
                success: true,
                tenant
            });
        } catch (error) {
            return sendPlatformError(res, error);
        }
    });

    app.patch("/api/platform/tenants/:tenantId", async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }

            const tenant = await tenantManagement.update({
                tenantId: req.params.tenantId,
                patch: req.body,
                actorId: req.platformActor.uid,
                requestId: req.requestId
            });

            return res.json({
                success: true,
                tenant
            });
        } catch (error) {
            return sendPlatformError(res, error);
        }
    });

    app.use((error, req, res, next) => {
        if (error?.type === "entity.too.large") {
            return res.status(413).json({
                success: false,
                message: "İstek gövdesi çok büyük."
            });
        }

        if (error instanceof SyntaxError && "body" in error) {
            return res.status(400).json({
                success: false,
                message: "Geçersiz JSON."
            });
        }

        console.error("Platform API beklenmeyen middleware hatası:", error.message);
        return res.status(500).json({
            success: false,
            message: "Beklenmeyen sunucu hatası."
        });
    });

    return app;
}

function sendPlatformError(res, error) {
    if (error?.code === "TENANT_ALREADY_EXISTS") {
        return res.status(409).json({
            success: false,
            message: "Bu işletme zaten mevcut."
        });
    }

    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "İşletme bulunamadı."
        });
    }

    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: error.message
        });
    }

    console.error("Platform API hatası:", error.message);
    return res.status(500).json({
        success: false,
        message: "İşlem tamamlanamadı."
    });
}

module.exports = {
    ADMIN_CSP,
    normalizeApiListLimit,
    createPlatformCorsMiddleware,
    createPlatformApp,
    sendPlatformError
};
