const express = require("express");
const rateLimit = require("express-rate-limit");
const crypto = require("node:crypto");
const path = require("node:path");
const { createRequirePlatformAdmin } = require("../auth/require-platform-admin");
const { createTenantOnboardingService } = require("../tenant/onboarding-service");
const { createTenantManagementService } = require("../tenant/tenant-management-service");
const { requireTenantId } = require("../tenant/tenant-id");
const { createTenantRateLimitMiddleware } = require("../security/tenant-rate-limiter");
const { createTenantTelemetryMiddleware } = require("./tenant-telemetry-middleware");
const { assertSecurityPosture } = require("../security/security-posture-service");
const {
    assertCustomerReadiness
} = require("../onboarding/customer-readiness-service");
const {
    assertCommercialPlanCatalog,
    assertCommercialPlanPreview
} = require("../entitlements/commercial-plan-preview-service");

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

function normalizeTopTenantLimit(value = 10) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new TypeError("FinOps liste limiti 1-100 arasında olmalı.");
    }

    return limit;
}

const SECURITY_ALERT_RESPONSE_FIELDS = Object.freeze([
    "schemaVersion", "alertId", "dedupeKey", "eventType", "severity", "tenantId",
    "actorId", "requestId", "correlationId", "source", "occurredAt", "reasonCode",
    "operation", "eventCount", "duplicateCount", "rollingCount", "firstSeenAt", "lastSeenAt"
]);

function normalizeSecurityAlertLimit(value = 20) {
    const limit = typeof value === "string" && /^[1-9][0-9]{0,2}$/.test(value)
        ? Number(value)
        : value;

    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Güvenlik uyarısı liste limiti geçersiz.");
    }

    return limit;
}

function projectSecurityAlertList(alerts) {
    if (!Array.isArray(alerts) || Object.getPrototypeOf(alerts) !== Array.prototype) {
        throw new TypeError("Güvenlik uyarısı reader sonucu geçersiz.");
    }

    return Object.freeze(alerts.map(alert => {
        if (!alert || typeof alert !== "object" || Array.isArray(alert) ||
            Object.getPrototypeOf(alert) !== Object.prototype) {
            throw new TypeError("Güvenlik uyarısı reader sonucu geçersiz.");
        }

        const projected = {};
        for (const field of SECURITY_ALERT_RESPONSE_FIELDS) {
            const descriptor = Object.getOwnPropertyDescriptor(alert, field);
            if (!descriptor || !Object.hasOwn(descriptor, "value")) {
                throw new TypeError("Güvenlik uyarısı reader sonucu geçersiz.");
            }
            const value = descriptor.value;
            if (value !== null && !["string", "number"].includes(typeof value)) {
                throw new TypeError("Güvenlik uyarısı reader sonucu geçersiz.");
            }
            projected[field] = value;
        }

        return Object.freeze(projected);
    }));
}

function sendSecurityAlertReadError(res) {
    console.error("Platform güvenlik uyarıları okunamadı.");
    return res.status(500).json({
        success: false,
        message: "Güvenlik uyarıları alınamadı."
    });
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
    allowedOrigins = [],
    usageTelemetry = null,
    tenantRateLimiter = null,
    tenantRateLimitPolicy = null,
    securitySignals = null,
    abuseMonitor = null,
    securityOperations = null,
    securityAlertReader = null,
    securityPostureService = null,
    customerReadinessService = null,
    commercialPlanPreviewService = null,
    tenantOperations = null,
    finOpsService = null
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function" ||
        typeof tenantRegistry.list !== "function" ||
        typeof tenantRegistry.create !== "function" ||
        typeof tenantRegistry.update !== "function") {
        throw new TypeError("Tenant registry getById/list/create/update metodlarını uygulamalı.");
    }

    const app = express();
    if (tenantOperations && typeof tenantOperations.getOverview !== "function") {
        throw new TypeError("Tenant operations service geçersiz.");
    }
    if (finOpsService && typeof finOpsService.getTopTenants !== "function") {
        throw new TypeError("FinOps service geçersiz.");
    }
    if (securityAlertReader && typeof securityAlertReader.list !== "function") {
        throw new TypeError("Security alert reader geçersiz.");
    }
    if (securityPostureService &&
        typeof securityPostureService.getPlatformPosture !== "function") {
        throw new TypeError("Security posture service geçersiz.");
    }
    if (customerReadinessService &&
        typeof customerReadinessService.evaluate !== "function") {
        throw new TypeError("Customer readiness service geçersiz.");
    }
    if (commercialPlanPreviewService &&
        (typeof commercialPlanPreviewService.getCatalog !== "function" ||
            typeof commercialPlanPreviewService.preview !== "function")) {
        throw new TypeError("Commercial plan preview service geçersiz.");
    }

    const requirePlatformAdmin = createRequirePlatformAdmin({
        auth,
        abuseMonitor,
        securityOperations
    });
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

    const tenantMiddlewares = [];
    if (usageTelemetry) {
        tenantMiddlewares.push(createTenantTelemetryMiddleware({
            telemetry: usageTelemetry
        }));
    }
    if (tenantRateLimiter || tenantRateLimitPolicy) {
        if (!tenantRateLimiter || !tenantRateLimitPolicy) {
            throw new TypeError("Tenant rate limiter ve policy birlikte gerekli.");
        }
        tenantMiddlewares.push(createTenantRateLimitMiddleware({
            limiter: tenantRateLimiter,
            policy: tenantRateLimitPolicy,
            scope: "admin_tenant",
            securitySignals
        }));
    }
    if (tenantMiddlewares.length > 0) {
        app.use("/api/platform/tenants/:tenantId", ...tenantMiddlewares);
    }

    if (securityAlertReader) {
        app.get("/api/platform/tenants/:tenantId/security-alerts", async (req, res) => {
            let tenantId;
            let limit;
            try {
                tenantId = requireTenantId(req.params.tenantId);
                if (tenantId !== req.params.tenantId) throw new TypeError();
                limit = normalizeSecurityAlertLimit(
                    req.query.limit === undefined ? 20 : req.query.limit
                );
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Güvenlik uyarısı sorgusu geçersiz."
                });
            }

            try {
                const alerts = projectSecurityAlertList(await securityAlertReader.list({
                    context: {
                        role: req.platformActor.role,
                        actorId: req.platformActor.uid
                    },
                    tenantId,
                    limit
                }));

                return res.json({ success: true, alerts });
            } catch {
                return sendSecurityAlertReadError(res);
            }
        });

        app.get("/api/platform/security-alerts", async (req, res) => {
            let limit;
            try {
                limit = normalizeSecurityAlertLimit(
                    req.query.limit === undefined ? 20 : req.query.limit
                );
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Güvenlik uyarısı sorgusu geçersiz."
                });
            }

            try {
                const alerts = projectSecurityAlertList(await securityAlertReader.list({
                    context: {
                        role: req.platformActor.role,
                        actorId: req.platformActor.uid
                    },
                    tenantId: null,
                    limit
                }));

                return res.json({ success: true, alerts });
            } catch {
                return sendSecurityAlertReadError(res);
            }
        });
    }

    if (securityPostureService) {
        app.get("/api/platform/security-posture", async (req, res) => {
            try {
                const posture = assertSecurityPosture(
                    await securityPostureService.getPlatformPosture({
                        context: {
                            role: req.platformActor.role,
                            actorId: req.platformActor.uid
                        }
                    })
                );

                return res.json({ success: true, posture });
            } catch {
                console.error("Platform security posture okunamadı.");
                return res.status(500).json({
                    success: false,
                    message: "Güvenlik durumu alınamadı."
                });
            }
        });
    }

    if (commercialPlanPreviewService) {
        app.get("/api/platform/plans", (req, res) => {
            try {
                const catalog = assertCommercialPlanCatalog(
                    commercialPlanPreviewService.getCatalog({
                        context: {
                            role: req.platformActor.role,
                            actorId: req.platformActor.uid
                        }
                    })
                );
                return res.json({ success: true, catalog });
            } catch {
                console.error("Commercial plan catalog okunamadı.");
                return res.status(500).json({
                    success: false,
                    message: "Plan kataloğu alınamadı."
                });
            }
        });
    }

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

    if (customerReadinessService) {
        app.get("/api/platform/tenants/:tenantId/readiness", async (req, res) => {
            let tenantId;
            try {
                tenantId = requireTenantId(req.params.tenantId);
                if (tenantId !== req.params.tenantId) {
                    throw new TypeError();
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Müşteri hazırlığı tenant kimliği geçersiz."
                });
            }

            try {
                const tenant = await tenantRegistry.getById(tenantId);
                if (!tenant) {
                    return res.status(404).json({
                        success: false,
                        message: "İşletme bulunamadı."
                    });
                }

                const readiness = assertCustomerReadiness(
                    await customerReadinessService.evaluate({ tenantId, tenant })
                );
                return res.json({ success: true, readiness });
            } catch {
                console.error("Müşteri hazırlığı okunamadı.");
                return res.status(500).json({
                    success: false,
                    message: "Müşteri hazırlığı alınamadı."
                });
            }
        });
    }

    if (commercialPlanPreviewService) {
        app.get("/api/platform/tenants/:tenantId/plan-preview", async (req, res) => {
            let tenantId;
            try {
                tenantId = requireTenantId(req.params.tenantId);
                if (tenantId !== req.params.tenantId ||
                    typeof req.query.targetPlan !== "string") {
                    throw new TypeError();
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Plan önizleme sorgusu geçersiz."
                });
            }

            try {
                const tenant = await tenantRegistry.getById(tenantId);
                if (!tenant) {
                    return res.status(404).json({
                        success: false,
                        message: "İşletme bulunamadı."
                    });
                }

                const preview = assertCommercialPlanPreview(
                    commercialPlanPreviewService.preview({
                        context: {
                            role: req.platformActor.role,
                            actorId: req.platformActor.uid
                        },
                        tenantId,
                        tenant,
                        targetPlan: req.query.targetPlan
                    })
                );
                return res.json({ success: true, preview });
            } catch (error) {
                const code = error && typeof error === "object"
                    ? Object.getOwnPropertyDescriptor(error, "code")
                    : null;
                if (code && Object.hasOwn(code, "value") &&
                    code.value === "TARGET_PLAN_NOT_CONFIGURED") {
                    return res.status(400).json({
                        success: false,
                        message: "Hedef plan yapılandırılmamış."
                    });
                }

                console.error("Commercial plan preview okunamadı.");
                return res.status(500).json({
                    success: false,
                    message: "Plan önizlemesi alınamadı."
                });
            }
        });
    }

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

    if (tenantOperations) {
        app.get("/api/platform/tenants/:tenantId/operations", async (req, res) => {
            try {
                const overview = await tenantOperations.getOverview({
                    context: {
                        role: req.platformActor.role,
                        actorId: req.platformActor.uid
                    },
                    tenantId: req.params.tenantId
                });

                return res.json({
                    success: true,
                    overview
                });
            } catch (error) {
                return sendPlatformError(res, error);
            }
        });
    }

    if (finOpsService) {
        app.get("/api/platform/finops/top-tenants", async (req, res) => {
            try {
                const result = await finOpsService.getTopTenants({
                    context: {
                        role: req.platformActor.role,
                        actorId: req.platformActor.uid
                    },
                    limit: normalizeTopTenantLimit(
                        req.query.limit === undefined ? 10 : req.query.limit
                    )
                });

                return res.json({
                    success: true,
                    finops: result
                });
            } catch (error) {
                return sendPlatformError(res, error);
            }
        });
    }

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

    if (new Set([
        "ENTITLEMENT_DENIED",
        "PERMISSION_DENIED",
        "TENANT_SCOPE_MISMATCH",
        "TENANT_BOUNDARY_VIOLATION"
    ]).has(error?.code)) {
        return res.status(403).json({
            success: false,
            message: "Bu veri veya işlem için yetki yok."
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
    normalizeTopTenantLimit,
    normalizeSecurityAlertLimit,
    projectSecurityAlertList,
    createPlatformCorsMiddleware,
    createPlatformApp,
    sendPlatformError
};
