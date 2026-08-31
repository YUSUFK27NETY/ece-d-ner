function createRequirePlatformAdmin({ auth }) {
    if (!auth || typeof auth.verifyIdToken !== "function") {
        throw new TypeError("Firebase Auth adapter gerekli.");
    }

    return async function requirePlatformAdmin(req, res, next) {
        try {
            const authorization = String(req.headers.authorization || "");

            if (!authorization.startsWith("Bearer ")) {
                return res.status(401).json({
                    success: false,
                    message: "Yetkilendirme gerekli."
                });
            }

            const idToken = authorization.slice(7).trim();

            if (!idToken) {
                return res.status(401).json({
                    success: false,
                    message: "Geçersiz yetkilendirme."
                });
            }

            const decodedToken = await auth.verifyIdToken(idToken, true);
            const uid = String(decodedToken?.uid || "").trim();

            if (!uid) {
                return res.status(401).json({
                    success: false,
                    message: "Geçersiz kullanıcı kimliği."
                });
            }

            if (decodedToken.platformAdmin !== true) {
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
        } catch (error) {
            console.error("Platform admin token doğrulama hatası:", error.message);

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
