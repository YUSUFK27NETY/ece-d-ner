"use strict";

const BODY_METHODS = new Set([
    "POST",
    "PUT",
    "PATCH"
]);

function requireJsonRequest(req, res, next) {
    if (
        BODY_METHODS.has(req.method) &&
        !req.is("application/json")
    ) {
        return res.status(415).json({
            success: false,
            message:
                "Bu endpoint application/json içeriği gerektirir."
        });
    }

    return next();
}

function createSafeRequestLogger({
    log = message => console.log(message),
    now = () => Date.now()
} = {}) {
    return function requestLogger(req, res, next) {
        const startedAt = now();

        res.once("finish", () => {
            log(
                JSON.stringify({
                    level:
                        res.statusCode >= 500
                            ? "error"
                            : res.statusCode >= 400
                                ? "warn"
                                : "info",
                    event: "http_request",
                    requestId: req.requestId,
                    method: req.method,
                    path: req.path,
                    statusCode: res.statusCode,
                    durationMs:
                        Math.max(0, now() - startedAt)
                })
            );
        });

        next();
    };
}

function configureServerTimeouts(server) {
    server.headersTimeout = 10000;
    server.requestTimeout = 30000;
    server.keepAliveTimeout = 5000;
    server.maxRequestsPerSocket = 1000;

    return server;
}

module.exports = {
    requireJsonRequest,
    createSafeRequestLogger,
    configureServerTimeouts
};
