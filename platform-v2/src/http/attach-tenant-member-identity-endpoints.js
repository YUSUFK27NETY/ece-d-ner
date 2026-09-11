const {
    createPlatformCorsMiddleware,
    sendPlatformError
} = require("./create-platform-app");
const { createRequireTenantMember } = require("../auth/require-tenant-member");

const INITIAL_OWNER_BOOTSTRAP_PATH =
    "/api/platform/tenants/:tenantId/admin-bootstrap/initial-owner";
const TENANT_MEMBER_SESSION_PATH = "/api/tenant/tenants/:tenantId/session";

function requireInitialOwnerBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype) {
        throw new TypeError("Initial owner bootstrap gövdesi geçersiz.");
    }
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 1 || keys[0] !== "firebaseUid" ||
        typeof body.firebaseUid !== "string") {
        throw new TypeError("Initial owner bootstrap gövdesi geçersiz.");
    }
    return body.firebaseUid;
}

function sendInitialOwnerError(res, error) {
    if (error?.code === "EXTERNAL_IDENTITY_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "Harici kimlik bulunamadı." });
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
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
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

    const tenantCors = createPlatformCorsMiddleware(allowedOrigins);
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
    TENANT_MEMBER_SESSION_PATH,
    attachTenantMemberIdentityEndpoints
};
