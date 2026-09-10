const { requireTenantId } = require("../tenant/tenant-id");
const {
    deriveFirebaseSubjectRef,
    requireTenantMemberRole
} = require("./tenant-member-subject");

function createRequireTenantMember({ auth, bindingReader }) {
    if (!auth || typeof auth.verifyIdToken !== "function") {
        throw new TypeError("Tenant member Firebase Auth adapter gerekli.");
    }
    if (!bindingReader || typeof bindingReader.getBySubject !== "function") {
        throw new TypeError("Tenant member binding reader gerekli.");
    }

    return async function requireTenantMember(req, res, next) {
        let tenantId;
        try {
            tenantId = requireTenantId(req.params.tenantId);
            if (tenantId !== req.params.tenantId) throw new TypeError();
        } catch {
            return res.status(400).json({ success: false, message: "Geçersiz tenant kimliği." });
        }

        const authorization = String(req.headers.authorization || "");
        if (!authorization.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Yetkilendirme gerekli." });
        }
        const idToken = authorization.slice(7).trim();
        if (!idToken) {
            return res.status(401).json({ success: false, message: "Geçersiz yetkilendirme." });
        }

        let decodedToken;
        try {
            decodedToken = await auth.verifyIdToken(idToken, true);
        } catch {
            return res.status(401).json({
                success: false,
                message: "Oturum geçersiz veya süresi dolmuş."
            });
        }

        const uid = typeof decodedToken?.uid === "string" ? decodedToken.uid : "";
        if (!uid || decodedToken.platformAdmin === true) {
            return res.status(403).json({
                success: false,
                message: "Tenant üyeliği gerekli."
            });
        }

        let subjectRef;
        try {
            subjectRef = deriveFirebaseSubjectRef(uid);
        } catch {
            return res.status(401).json({ success: false, message: "Geçersiz kullanıcı kimliği." });
        }

        let binding;
        try {
            binding = await bindingReader.getBySubject({ tenantId, subjectRef });
        } catch {
            return res.status(503).json({
                success: false,
                message: "Tenant üyeliği şu anda doğrulanamıyor."
            });
        }

        if (!binding || binding.state !== "active") {
            return res.status(403).json({ success: false, message: "Tenant üyeliği gerekli." });
        }

        let role;
        try {
            role = requireTenantMemberRole(binding.role);
        } catch {
            return res.status(503).json({
                success: false,
                message: "Tenant üyeliği şu anda doğrulanamıyor."
            });
        }
        if (binding.tenantId !== tenantId || binding.subjectRef !== subjectRef) {
            return res.status(403).json({ success: false, message: "Tenant üyeliği gerekli." });
        }

        req.tenantActor = Object.freeze({
            tenantId,
            actorId: subjectRef,
            role
        });
        return next();
    };
}

module.exports = {
    createRequireTenantMember
};
