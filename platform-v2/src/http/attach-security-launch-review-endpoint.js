const { sendPlatformError } = require("./create-platform-app");

const SECURITY_LAUNCH_REVIEW_PATH =
    "/api/platform/tenants/:tenantId/security-review/complete";

function hasRequestInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        (contentLength !== undefined && contentLength !== "0") ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function sendSecurityReviewError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "İşletme bulunamadı."
        });
    }
    if ([
        "SECURITY_REVIEW_INVALID_STATE",
        "SECURITY_REVIEW_ALREADY_RECORDED",
        "SECURITY_REVIEW_HAS_UNRESOLVED_ALERTS"
    ].includes(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Launch security review mevcut tenant/güvenlik durumuyla tamamlanamıyor."
        });
    }
    if ([
        "SECURITY_REVIEW_VISIBILITY_TRUNCATED",
        "SECURITY_REVIEW_STATE_CHANGED",
        "SECURITY_REVIEW_UNAVAILABLE"
    ].includes(error?.code)) {
        return res.status(503).json({
            success: false,
            message: "Launch security review şu anda kullanılamıyor."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Launch security review isteği geçersiz."
        });
    }
    return sendPlatformError(res, error);
}

function attachSecurityLaunchReviewEndpoint({ app, securityLaunchReviewService }) {
    if (!app || typeof app.post !== "function") {
        throw new TypeError("Security launch review endpoint app geçersiz.");
    }
    if (!securityLaunchReviewService ||
        typeof securityLaunchReviewService.completeReview !== "function") {
        throw new TypeError("Security launch review service geçersiz.");
    }

    app.post(SECURITY_LAUNCH_REVIEW_PATH, async (req, res) => {
        try {
            if (hasRequestInput(req)) {
                throw new TypeError(
                    "Launch security review body/query kabul etmez."
                );
            }
            const review = await securityLaunchReviewService.completeReview({
                context: {
                    role: req.platformActor.role,
                    actorId: req.platformActor.uid
                },
                tenantId: req.params.tenantId,
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, review });
        } catch (error) {
            return sendSecurityReviewError(res, error);
        }
    });

    return app;
}

module.exports = {
    SECURITY_LAUNCH_REVIEW_PATH,
    attachSecurityLaunchReviewEndpoint
};
