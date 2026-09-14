const { requireTenantId } = require("../tenant/tenant-id");
const {
    deriveFirebaseSubjectRef,
    requireTenantMemberRole
} = require("./tenant-member-subject");

function createRequireTenantMember({ auth, bindingReader, tenantReader }) {
    if (!auth || typeof auth.verifyIdToken !== "function") {
        throw new TypeError("Tenant member Firebase Auth adapter gerekli.");
    }
    if (!bindingReader || typeof bindingReader.getBySubject !== "function") {
        throw new TypeError("Tenant member binding reader gerekli.");
    }
    if (!tenantReader || typeof tenantReader.getById !== "function") {
        throw new TypeError("Tenant member lifecycle reader gerekli.");
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

            // The fixed common owner login resolves membership through the global
            // active-binding lookup. Keep tenant-scoped APIs compatible with that
            // canonical resolution if an exact document lookup cannot see the
            // binding, while still requiring the resolved tenant to match exactly.
            if (!binding && typeof bindingReader.findActiveBySubject === "function") {
                const resolvedBinding = await bindingReader.findActiveBySubject({ subjectRef });
                if (resolvedBinding?.tenantId === tenantId &&
                    resolvedBinding?.subjectRef === subjectRef) {
                    binding = resolvedBinding;
                }
            }
        } catch {
            return res.status(503).json({
                success: false,
                message: "Tenant üyeliği şu anda doğrulanamıyor."
            });
        }

        if (!binding || binding.state !== "active" ||
            binding.tenantId !== tenantId || binding.subjectRef !== subjectRef) {
            return res.status(403).json({ success: false, message: "Tenant üyeliği gerekli." });
        }

        let tenant;
        try {
            tenant = await tenantReader.getById(tenantId);
        } catch {
            return res.status(503).json({
                success: false,
                message: "Tenant durumu şu anda doğrulanamıyor."
            });
        }
        if (!tenant || tenant.tenantId !== tenantId || tenant.status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Tenant erişimi aktif değil."
            });
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