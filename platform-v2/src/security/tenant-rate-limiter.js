const { requireTenantId } = require("../tenant/tenant-id");

function assertRatePolicy(policy) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
        throw new TypeError("Tenant rate limit policy gerekli.");
    }

    for (const key of ["sustainedWindowMs", "sustainedMax", "burstWindowMs", "burstMax"]) {
        if (!Number.isInteger(policy[key]) || policy[key] < 1) {
            throw new TypeError("Tenant rate limit policy geçersiz.");
        }
    }

    if (policy.burstWindowMs > policy.sustainedWindowMs) {
        throw new TypeError("Tenant rate limit policy pencere sırası geçersiz.");
    }

    return policy;
}

function createTenantRateLimiter({ now = () => Date.now() } = {}) {
    if (typeof now !== "function") {
        throw new TypeError("Tenant rate limiter clock geçersiz.");
    }

    const windows = new Map();

    function consume({ tenantId, policy, scope }) {
        const safeTenantId = requireTenantId(tenantId);
        const safeScope = String(scope ?? "").trim();
        const timestamp = Number(now());

        if (!/^[a-z][a-z0-9_-]{1,63}$/i.test(safeScope)) {
            throw new TypeError("Tenant rate limit scope geçersiz.");
        }
        const safePolicy = assertRatePolicy(policy);
        if (!Number.isFinite(timestamp)) {
            throw new TypeError("Tenant rate limiter clock geçersiz.");
        }

        const key = `${safeScope}:${safeTenantId}`;
        const previous = windows.get(key) || [];
        const sustained = previous.filter(item => timestamp - item < safePolicy.sustainedWindowMs);
        const burstCount = sustained.filter(item => timestamp - item < safePolicy.burstWindowMs).length;
        let reason = null;
        let retryAfterMs = 0;

        if (burstCount >= safePolicy.burstMax) {
            reason = "burst";
            retryAfterMs = safePolicy.burstWindowMs - (timestamp - sustained[sustained.length - burstCount]);
        } else if (sustained.length >= safePolicy.sustainedMax) {
            reason = "sustained";
            retryAfterMs = safePolicy.sustainedWindowMs - (timestamp - sustained[0]);
        }

        if (reason) {
            windows.set(key, sustained);
            return Object.freeze({
                allowed: false,
                reason,
                retryAfterMs: Math.max(1, Math.ceil(retryAfterMs))
            });
        }

        sustained.push(timestamp);
        windows.set(key, sustained);
        return Object.freeze({
            allowed: true,
            remaining: Math.max(0, safePolicy.sustainedMax - sustained.length)
        });
    }

    return Object.freeze({ consume });
}

function createTenantRateLimitMiddleware({
    limiter,
    policy,
    scope,
    securitySignals = null,
    tenantResolver = req => req.params.tenantId
}) {
    if (!limiter || typeof limiter.consume !== "function") {
        throw new TypeError("Tenant rate limiter gerekli.");
    }
    if (typeof tenantResolver !== "function") {
        throw new TypeError("Tenant rate limit resolver geçersiz.");
    }

    return async function tenantRateLimit(req, res, next) {
        try {
            const tenantId = requireTenantId(tenantResolver(req));
            const result = limiter.consume({ tenantId, policy, scope });

            if (result.allowed) {
                return next();
            }

            if (securitySignals && typeof securitySignals.emit === "function") {
                try {
                    await securitySignals.emit({
                        tenantId,
                        type: "rate_limit_exceeded",
                        severity: "warning",
                        requestId: req.requestId,
                        operation: "platform.admin.tenant",
                        metadata: {
                            policyScope: scope,
                            reasonCode: result.reason
                        }
                    });
                } catch {
                    console.error("Tenant rate limit security signal yazılamadı.");
                }
            }

            res.set("Retry-After", String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
            return res.status(429).json({
                success: false,
                message: "Bu işletme için çok fazla istek gönderildi."
            });
        } catch (error) {
            if (error instanceof TypeError) {
                return res.status(400).json({
                    success: false,
                    message: "Geçersiz tenant rate-limit bağlamı."
                });
            }
            return next(error);
        }
    };
}

module.exports = {
    assertRatePolicy,
    createTenantRateLimitMiddleware,
    createTenantRateLimiter
};
