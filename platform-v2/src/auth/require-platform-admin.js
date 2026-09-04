function createRequirePlatformAdmin({ auth, abuseMonitor = null }) {
    if (!auth || typeof auth.verifyIdToken !== "function") {
        throw new TypeError("Firebase Auth adapter gerekli.");
    }

    if (abuseMonitor && typeof abuseMonitor.recordDenied !== "function") {
        throw new TypeError("Platform admin abuse monitor geçersiz.");
    }

    async function recordDenied(req, statusCode) {
        if (!abuseMonitor) return;

        try {
            await abuseMonitor.recordDenied({
                requestId: req.requestId || null,
                operation: "platform.admin.auth",
                statusCode
            });
        } catch {
            console.error("Platform admin auth security signal yazılamadı.");
        }
    }

    return async function requirePlatformAdmin(req, res, next) {
        try {
            const authorization = String(req.headers.authorization || "");

            if (!authorization.startsWith("Bearer ")) {
                await recordDenied(req, 401);
                return res.status(401).json({
                    success: false,
                    message: "Yetkilendirme gerekli."
                });
            }

            const idToken = authorization.slice(7).trim();

            if (!idToken) {
                await recordDenied(req, 401);
                return res.status(401).json({
                    success: false,
                    message: "Geçersiz yetkilendirme."
                });
            }

            const decodedToken = await auth.verifyIdToken(idToken, true);
            const uid = String(decodedToken?.uid || "").trim();

            if (!uid) {
                await recordDenied(req, 401);
                return res.status(401).json({
                    success: false,
                    message: "Geçersiz kullanıcı kimliği."
                });
            }

            if (decodedToken.platformAdmin !== true) {
                await recordDenied(req, 403);
                return res.status(403).json({
                    success: false,
                    message: "Platform yöneticisi yetkisi gerekli."
                });
            }

            req.platformActor = Object.freeze({
                uid,
                role: "platform_admin"
            });

            return next();
        } catch {
            await recordDenied(req, 401);
            console.error("Platform admin token doğrulaması başarısız.");

            return res.status(401).json({
                success: false,
                message: "Oturum geçersiz veya süresi dolmuş."
            });
        }
    };
}

module.exports = {
    createRequirePlatformAdmin
};
