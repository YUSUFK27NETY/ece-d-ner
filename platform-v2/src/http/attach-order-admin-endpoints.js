const { sendPlatformError } = require("./create-platform-app");

const ORDER_ADMIN_BASE = "/api/platform/tenants/:tenantId/orders";

function normalizeOrderListLimit(value = 100) {
    const limit = typeof value === "string" && /^[1-9][0-9]{0,2}$/.test(value)
        ? Number(value)
        : value;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Sipariş liste limiti geçersiz.");
    }
    return limit;
}

function assertListQuery(query) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Sipariş sorgusu geçersiz.");
    }
    const keys = Reflect.ownKeys(query);
    if (keys.some(key => key !== "limit")) {
        throw new TypeError("Sipariş sorgusu geçersiz.");
    }
}

function requireStatusBody(body) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype) {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 1 || keys[0] !== "status") {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    const descriptor = Object.getOwnPropertyDescriptor(body, "status");
    if (!descriptor || !Object.hasOwn(descriptor, "value") ||
        typeof descriptor.value !== "string") {
        throw new TypeError("Sipariş durum isteği geçersiz.");
    }
    return descriptor.value;
}

function actorContext(req) {
    return Object.freeze({
        role: req.platformActor.role,
        actorId: req.platformActor.uid
    });
}

function sendOrderAdminError(res, error) {
    if (error?.code === "ORDER_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "Sipariş bulunamadı."
        });
    }
    if (new Set([
        "ORDER_STATUS_INVALID_TRANSITION",
        "ORDER_STATE_CHANGED",
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Sipariş işlemi mevcut tenant/sipariş durumuyla uyumlu değil."
        });
    }
    if (error?.code === "ORDER_UNAVAILABLE") {
        return res.status(503).json({
            success: false,
            message: "Sipariş verileri şu anda kullanılamıyor."
        });
    }
    return sendPlatformError(res, error);
}

function attachOrderAdminEndpoints({ app, orderService }) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Order admin endpoint app geçersiz.");
    }
    if (!orderService || typeof orderService.listAdmin !== "function" ||
        typeof orderService.getAdmin !== "function" ||
        typeof orderService.updateStatus !== "function") {
        throw new TypeError("Order service geçersiz.");
    }

    app.get(ORDER_ADMIN_BASE, async (req, res) => {
        try {
            assertListQuery(req.query);
            const orders = await orderService.listAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                limit: normalizeOrderListLimit(
                    req.query.limit === undefined ? 100 : req.query.limit
                )
            });
            return res.json({ success: true, orders });
        } catch (error) {
            return sendOrderAdminError(res, error);
        }
    });

    app.get(`${ORDER_ADMIN_BASE}/:orderId`, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Sipariş detay sorgusu parametre kabul etmez.");
            }
            const order = await orderService.getAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                orderId: req.params.orderId
            });
            return res.json({ success: true, order });
        } catch (error) {
            return sendOrderAdminError(res, error);
        }
    });

    app.patch(`${ORDER_ADMIN_BASE}/:orderId/status`, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Sipariş durum isteği sorgu parametresi kabul etmez.");
            }
            const order = await orderService.updateStatus({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                orderId: req.params.orderId,
                status: requireStatusBody(req.body),
                requestId: req.requestId
            });
            return res.json({ success: true, order });
        } catch (error) {
            return sendOrderAdminError(res, error);
        }
    });

    return app;
}

module.exports = {
    ORDER_ADMIN_BASE,
    attachOrderAdminEndpoints,
    normalizeOrderListLimit
};
