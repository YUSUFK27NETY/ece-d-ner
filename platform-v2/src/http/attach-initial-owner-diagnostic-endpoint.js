const { sendPlatformError } = require("./create-platform-app");

const INITIAL_OWNER_DIAGNOSTIC_PATH =
    "/api/platform/tenants/:tenantId/admin-bootstrap/initial-owner-diagnostic";

function hasRequestInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        (contentLength !== undefined && contentLength !== "0") ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function sendInitialOwnerDiagnosticError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "İşletme bulunamadı." });
    }
    if (error?.code === "TENANT_DIAGNOSTIC_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Owner onboarding durumu şu anda doğrulanamıyor."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Owner onboarding diagnostic isteği geçersiz."
        });
    }
    return sendPlatformError(res, error);
}

function attachInitialOwnerDiagnosticEndpoint({ app, diagnosticService }) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Initial owner diagnostic endpoint app geçersiz.");
    }
    if (!diagnosticService || typeof diagnosticService.diagnose !== "function") {
        throw new TypeError("Initial owner diagnostic service geçersiz.");
    }

    app.get(INITIAL_OWNER_DIAGNOSTIC_PATH, async (req, res) => {
        try {
            if (hasRequestInput(req)) {
                throw new TypeError("Owner onboarding diagnostic body/query kabul etmez.");
            }
            const diagnostic = await diagnosticService.diagnose({
                context: {
                    role: req.platformActor.role,
                    actorId: req.platformActor.uid
                },
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, diagnostic });
        } catch (error) {
            return sendInitialOwnerDiagnosticError(res, error);
        }
    });

    return app;
}

module.exports = {
    INITIAL_OWNER_DIAGNOSTIC_PATH,
    hasRequestInput,
    sendInitialOwnerDiagnosticError,
    attachInitialOwnerDiagnosticEndpoint
};
