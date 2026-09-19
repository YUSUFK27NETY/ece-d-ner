const { requireTenantId } = require("../tenant/tenant-id");

const TENANT_ROUTE_PATTERNS = Object.freeze([
    Object.freeze({
        pattern: /^\/api\/platform\/support\/tickets\/([^/]+)(?:\/|$)/,
        operation: "http.platform.support_ticket"
    }),
    Object.freeze({
        pattern: /^\/api\/platform\/tenants\/([^/]+)(?:\/|$)/,
        operation: "http.platform.tenant"
    }),
    Object.freeze({
        pattern: /^\/api\/tenant\/tenants\/([^/]+)(?:\/|$)/,
        operation: "http.owner.tenant"
    }),
    Object.freeze({
        pattern: /^\/api\/public\/storefront\/([^/]+)(?:\/|$)/,
        operation: "http.public.storefront"
    }),
    Object.freeze({
        pattern: /^\/api\/public\/appointments\/([^/]+)(?:\/|$)/,
        operation: "http.public.appointments"
    }),
    Object.freeze({
        pattern: /^\/api\/public\/fulfillment\/([^/]+)(?:\/|$)/,
        operation: "http.public.fulfillment"
    }),
    Object.freeze({
        pattern: /^\/api\/public\/quotes\/([^/]+)(?:\/|$)/,
        operation: "http.public.quotes"
    }),
    Object.freeze({
        pattern: /^\/media\/([^/]+)(?:\/|$)/,
        operation: "http.public.media"
    }),
    Object.freeze({
        pattern: /^\/m\/([^/]+)(?:\/|$)/,
        operation: "http.public.storefront_page"
    })
]);

function resolveOperationalAlertScope(pathname) {
    const path = String(pathname || "");
    for (const descriptor of TENANT_ROUTE_PATTERNS) {
        const match = descriptor.pattern.exec(path);
        if (!match) continue;

        let tenantId;
        try {
            tenantId = requireTenantId(decodeURIComponent(match[1]));
        } catch {
            return null;
        }
        if (tenantId !== match[1]) return null;
        return Object.freeze({
            tenantId,
            operation: descriptor.operation
        });
    }
    return null;
}

function resolveTrustedOperationalAlertScope(locals) {
    const scope = locals?.platformOperationalAlertScope;
    if (!scope || typeof scope !== "object" || Array.isArray(scope) ||
        Object.getPrototypeOf(scope) !== Object.prototype) {
        return null;
    }
    const keys = Reflect.ownKeys(scope);
    if (keys.length !== 2 || !keys.every(key => ["tenantId", "operation"].includes(key))) {
        return null;
    }

    let tenantId;
    try {
        tenantId = requireTenantId(scope.tenantId);
    } catch {
        return null;
    }
    if (tenantId !== scope.tenantId ||
        typeof scope.operation !== "string" ||
        !/^[a-z0-9][a-z0-9_.:-]{1,119}$/i.test(scope.operation)) {
        return null;
    }
    return Object.freeze({ tenantId, operation: scope.operation });
}

function createOperationalAlertMiddleware({ alerts, clock = Date.now }) {
    if (!alerts || typeof alerts.record !== "function") {
        throw new TypeError("Operational alert service gerekli.");
    }
    if (typeof clock !== "function") {
        throw new TypeError("Operational alert clock geçersiz.");
    }

    return function operationalAlertMiddleware(req, res, next) {
        const pathScope = resolveOperationalAlertScope(req.path);

        res.once("finish", () => {
            const scope = pathScope || resolveTrustedOperationalAlertScope(res.locals);
            if (!scope || !Number.isInteger(res.statusCode) ||
                res.statusCode < 500 || res.statusCode > 599) {
                return;
            }

            let occurredAt;
            try {
                const now = clock();
                if (!Number.isSafeInteger(now) || now <= 0) throw new Error();
                occurredAt = new Date(now).toISOString();
            } catch {
                console.error("Operational alert clock kullanılamadı.");
                return;
            }

            Promise.resolve(alerts.record({
                tenantId: scope.tenantId,
                operation: scope.operation,
                statusCode: res.statusCode,
                occurredAt
            })).catch(() => {
                console.error("Operational alert yazılamadı.");
            });
        });

        return next();
    };
}

module.exports = {
    TENANT_ROUTE_PATTERNS,
    createOperationalAlertMiddleware,
    resolveOperationalAlertScope,
    resolveTrustedOperationalAlertScope
};
