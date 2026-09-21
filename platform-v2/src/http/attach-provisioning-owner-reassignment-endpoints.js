const {
    sendPlatformError
} = require("./create-platform-app");

const OWNER_REASSIGNMENT_INVITE_PATH =
    "/api/platform/tenants/:tenantId/admin-bootstrap/initial-owner-reassignment-invite";
const OWNER_REASSIGNMENT_ACCEPT_PATH =
    "/api/tenant-invitations/:tenantId/initial-owner-reassignment/accept";

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

function bearerToken(req) {
    const authorization = String(req.headers.authorization || "");
    if (!authorization.startsWith("Bearer ")) return null;
    const token = authorization.slice(7).trim();
    return token || null;
}

function sendReassignmentError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "İşletme bulunamadı."
        });
    }
    if (error?.code === "TENANT_OWNER_REASSIGNMENT_INVITE_EXPIRED") {
        return res.status(410).json({
            success: false,
            message: "Owner değiştirme davetinin süresi dolmuş."
        });
    }
    if (error?.code === "OWNER_REASSIGNMENT_AUTH_INVALID") {
        return res.status(401).json({
            success: false,
            message: "Owner değiştirme oturumu geçersiz veya süresi dolmuş."
        });
    }
    if (error?.code === "OWNER_REASSIGNMENT_IDENTITY_NOT_ELIGIBLE") {
        return res.status(403).json({
            success: false,
            message: "Bu Firebase kimliği yeni owner olmak için uygun değil."
        });
    }
    if (new Set([
        "TENANT_OWNER_REASSIGNMENT_INVALID_STATE",
        "TENANT_OWNER_REASSIGNMENT_OWNER_MISSING",
        "TENANT_OWNER_REASSIGNMENT_STATE_CHANGED",
        "TENANT_OWNER_REASSIGNMENT_INVITE_INVALID",
        "TENANT_OWNER_REASSIGNMENT_TARGET_EXISTS",
        "TENANT_OWNER_REASSIGNMENT_SAME_SUBJECT"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Owner değiştirme işlemi mevcut tenant/owner durumuyla uyumlu değil."
        });
    }
    if (error?.code === "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Owner değiştirme işlemi şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function attachProvisioningOwnerReassignmentEndpoints({
    app,
    ownerReassignmentService
}) {
    if (!app || typeof app.post !== "function") {
        throw new TypeError("Owner reassignment endpoint app geçersiz.");
    }
    if (!ownerReassignmentService ||
        typeof ownerReassignmentService.createInvite !== "function" ||
        typeof ownerReassignmentService.acceptInvite !== "function") {
        throw new TypeError("Owner reassignment service geçersiz.");
    }

    app.post(OWNER_REASSIGNMENT_INVITE_PATH, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError(
                    "Owner reassignment daveti sorgu parametresi kabul etmez."
                );
            }
            const invite = await ownerReassignmentService.createInvite({
                context: {
                    role: req.platformActor.role,
                    actorId: req.platformActor.uid
                },
                tenantId: req.params.tenantId,
                email: requireExactBody(
                    req.body,
                    "email",
                    "Owner reassignment daveti"
                ),
                requestId: req.requestId
            });
            return res.status(201).json({
                success: true,
                invite
            });
        } catch (error) {
            return sendReassignmentError(res, error);
        }
    });

    app.post(OWNER_REASSIGNMENT_ACCEPT_PATH, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError(
                    "Owner reassignment kabul sorgu parametresi kabul etmez."
                );
            }
            const idToken = bearerToken(req);
            if (!idToken) {
                return res.status(401).json({
                    success: false,
                    message: "Firebase oturumu gerekli."
                });
            }
            const bootstrap = await ownerReassignmentService.acceptInvite({
                tenantId: req.params.tenantId,
                inviteToken: requireExactBody(
                    req.body,
                    "inviteToken",
                    "Owner reassignment kabul"
                ),
                idToken,
                requestId: req.requestId
            });
            return res.json({
                success: true,
                bootstrap
            });
        } catch (error) {
            return sendReassignmentError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_REASSIGNMENT_INVITE_PATH,
    OWNER_REASSIGNMENT_ACCEPT_PATH,
    attachProvisioningOwnerReassignmentEndpoints
};
