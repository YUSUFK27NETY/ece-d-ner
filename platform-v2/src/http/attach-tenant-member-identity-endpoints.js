const rateLimit = require("express-rate-limit");
const {
    createPlatformCorsMiddleware,
    sendPlatformError
} = require("./create-platform-app");
const { createRequireTenantMember } = require("../auth/require-tenant-member");

const INITIAL_OWNER_BOOTSTRAP_PATH =
    "/api/platform/tenants/:tenantId/admin-bootstrap/initial-owner";
const INITIAL_OWNER_INVITE_PATH =
    "/api/platform/tenants/:tenantId/admin-bootstrap/initial-owner-invite";
const INITIAL_OWNER_INVITE_ACCEPT_PATH =
    "/api/tenant-invitations/:tenantId/initial-owner/accept";
const TENANT_MEMBER_SESSION_PATH = "/api/tenant/tenants/:tenantId/session";

function requireExactBody(body, field, label) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype) {
        throw new TypeError(`${label} gövdesi geçersiz.`);
    }
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 1 || keys[0] !== field) {
        throw new TypeError(`${label} gövdesi geçersiz.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(body, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string") {
        throw new TypeError(`${label} gövdesi geçersiz.`);
    }
    return descriptor.value;
}

function requireInitialOwnerBody(body) {
    return requireExactBody(body, "firebaseUid", "Initial owner bootstrap");
}

function requireInviteCreateBody(body) {
    return requireExactBody(body, "email", "Initial owner daveti");
}

function requireInviteAcceptBody(body) {
    return requireExactBody(body, "inviteToken", "Initial owner davet kabul");
}

function bearerToken(req) {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) return null;
    const token = authorization.slice(7).trim();
    return token || null;
}

function sendInitialOwnerError(res, error) {
    if (error?.code === "EXTERNAL_IDENTITY_NOT_FOUND" || error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "Kayıt bulunamadı." });
    }
    if (new Set([
        "TENANT_INITIAL_OWNER_INVALID_STATE",
        "TENANT_INITIAL_OWNER_ALREADY_BOUND",
        "TENANT_BOOTSTRAP_STATE_CHANGED",
        "EXTERNAL_IDENTITY_NOT_ELIGIBLE"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Initial owner bootstrap mevcut tenant/kimlik durumuyla uyumlu değil."
        });
    }
    if (new Set([
        "EXTERNAL_IDENTITY_UNAVAILABLE",
        "TENANT_BOOTSTRAP_UNAVAILABLE"
    ]).has(error?.code)) {
        return res.status(503).json({
            success: false,
            message: "Initial owner bootstrap şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function sendInviteError(res, error) {
    if (error?.code === "INVITE_AUTH_INVALID") {
        return res.status(401).json({ success: false, message: "Davet oturumu geçersiz veya süresi dolmuş." });
    }
    if (error?.code === "INVITE_IDENTITY_NOT_ELIGIBLE") {
        return res.status(403).json({ success: false, message: "Bu Firebase kimliği owner daveti için uygun değil." });
    }
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "İşletme bulunamadı." });
    }
    if (error?.code === "TENANT_INITIAL_OWNER_INVITE_EXPIRED") {
        return res.status(410).json({ success: false, message: "Owner davetinin süresi dolmuş." });
    }
    if (new Set([
        "TENANT_INITIAL_OWNER_INVITE_INVALID",
        "TENANT_INITIAL_OWNER_INVALID_STATE",
        "TENANT_INITIAL_OWNER_ALREADY_BOUND",
        "TENANT_BOOTSTRAP_STATE_CHANGED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Owner daveti mevcut işletme/davet durumuyla uyumlu değil."
        });
    }
    if (error?.code === "TENANT_BOOTSTRAP_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Owner daveti şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function attachTenantMemberIdentityEndpoints({
    app,
    auth,
    bindingReader,
    initialOwnerBootstrapService,
    allowedOrigins = []
}) {
    if (!app || typeof app.use !== "function" || typeof app.get !== "function" ||
        typeof app.post !== "function") {
        throw new TypeError("Tenant member identity endpoint app geçersiz.");
    }
    if (!initialOwnerBootstrapService ||
        typeof initialOwnerBootstrapService.bindInitialOwner !== "function") {
        throw new TypeError("Initial owner bootstrap service geçersiz.");
    }

    app.post(INITIAL_OWNER_BOOTSTRAP_PATH, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Initial owner bootstrap sorgu parametresi kabul etmez.");
            }
            const result = await initialOwnerBootstrapService.bindInitialOwner({
                context: {
                    role: req.platformActor.role,
                    actorId: req.platformActor.uid
                },
                tenantId: req.params.tenantId,
                firebaseUid: requireInitialOwnerBody(req.body),
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, bootstrap: result });
        } catch (error) {
            return sendInitialOwnerError(res, error);
        }
    });

    if (typeof initialOwnerBootstrapService.createInitialOwnerInvite === "function") {
        app.post(INITIAL_OWNER_INVITE_PATH, async (req, res) => {
            try {
                if (!req.is("application/json")) {
                    return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
                }
                if (Reflect.ownKeys(req.query).length > 0) {
                    throw new TypeError("Initial owner daveti sorgu parametresi kabul etmez.");
                }
                const invite = await initialOwnerBootstrapService.createInitialOwnerInvite({
                    context: {
                        role: req.platformActor.role,
                        actorId: req.platformActor.uid
                    },
                    tenantId: req.params.tenantId,
                    email: requireInviteCreateBody(req.body),
                    requestId: req.requestId
                });
                return res.status(201).json({ success: true, invite });
            } catch (error) {
                return sendInviteError(res, error);
            }
        });
    }

    const tenantCors = createPlatformCorsMiddleware(allowedOrigins);
    if (typeof initialOwnerBootstrapService.acceptInitialOwnerInvite === "function") {
        const inviteLimiter = rateLimit({
            windowMs: 15 * 60 * 1000,
            max: 30,
            standardHeaders: true,
            legacyHeaders: false,
            message: { success: false, message: "Çok fazla owner davet isteği gönderildi." }
        });
        app.use("/api/tenant-invitations", tenantCors, inviteLimiter);
        app.post(INITIAL_OWNER_INVITE_ACCEPT_PATH, async (req, res) => {
            try {
                if (!req.is("application/json")) {
                    return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
                }
                if (Reflect.ownKeys(req.query).length > 0) {
                    throw new TypeError("Initial owner davet kabul sorgu parametresi kabul etmez.");
                }
                const idToken = bearerToken(req);
                if (!idToken) {
                    return res.status(401).json({ success: false, message: "Firebase oturumu gerekli." });
                }
                const bootstrap = await initialOwnerBootstrapService.acceptInitialOwnerInvite({
                    tenantId: req.params.tenantId,
                    inviteToken: requireInviteAcceptBody(req.body),
                    idToken,
                    requestId: req.requestId
                });
                return res.status(201).json({ success: true, bootstrap });
            } catch (error) {
                return sendInviteError(res, error);
            }
        });
    }

    const requireTenantMember = createRequireTenantMember({ auth, bindingReader });
    app.use("/api/tenant", tenantCors);
    app.use("/api/tenant/tenants/:tenantId", requireTenantMember);

    app.get(TENANT_MEMBER_SESSION_PATH, (req, res) => res.json({
        success: true,
        session: Object.freeze({
            tenantId: req.tenantActor.tenantId,
            role: req.tenantActor.role
        })
    }));

    return app;
}

module.exports = {
    INITIAL_OWNER_BOOTSTRAP_PATH,
    INITIAL_OWNER_INVITE_PATH,
    INITIAL_OWNER_INVITE_ACCEPT_PATH,
    TENANT_MEMBER_SESSION_PATH,
    attachTenantMemberIdentityEndpoints
};
