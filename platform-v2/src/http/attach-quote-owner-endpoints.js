const { sendPlatformError } = require("./create-platform-app");

const BASE = "/api/tenant/tenants/:tenantId/owner/quotes";

function context(req) {
    return Object.freeze({
        role: req.tenantActor?.role,
        actorId: req.tenantActor?.actorId,
        tenantId: req.tenantActor?.tenantId
    });
}

function sendError(res, error) {
    if (new Set(["TENANT_NOT_FOUND", "QUOTE_NOT_FOUND"]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Teklif bulunamadı." });
    }
    if (new Set([
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED",
        "ENTITLEMENT_DENIED",
        "QUOTE_STATUS_TRANSITION_INVALID",
        "QUOTE_STATE_CHANGED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "İşlem mevcut teklif veya işletme durumuyla uyumlu değil."
        });
    }
    if (error?.code === "QUOTE_UNAVAILABLE") {
        return res.status(503).json({ success: false, message: "Teklifler şu anda alınamıyor." });
    }
    return sendPlatformError(res, error);
}

function listQuery(req) {
    const allowed = new Set(["status", "limit"]);
    for (const key of Reflect.ownKeys(req.query)) {
        if (!allowed.has(key)) throw new TypeError("Quote list query geçersiz.");
    }
    return {
        status: req.query.status || null,
        limit: req.query.limit === undefined ? 100 : req.query.limit
    };
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) throw new TypeError("Quote endpoint query kabul etmez.");
}

function attachQuoteOwnerEndpoints({ app, quoteService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Quote owner endpoint app geçersiz.");
    }
    if (!quoteService || typeof quoteService.listAdmin !== "function" ||
        typeof quoteService.getAdmin !== "function" || typeof quoteService.updateAdmin !== "function") {
        throw new TypeError("Quote owner service geçersiz.");
    }

    app.get(BASE, async (req, res) => {
        try {
            const query = listQuery(req);
            const quotes = await quoteService.listAdmin({
                context: context(req),
                tenantId: req.params.tenantId,
                ...query
            });
            return res.json({ success: true, quotes });
        } catch (error) {
            return sendError(res, error);
        }
    });

    app.get(`${BASE}/:quoteId`, async (req, res) => {
        try {
            noQuery(req);
            const quote = await quoteService.getAdmin({
                context: context(req),
                tenantId: req.params.tenantId,
                quoteId: req.params.quoteId
            });
            return res.json({ success: true, quote });
        } catch (error) {
            return sendError(res, error);
        }
    });

    app.patch(`${BASE}/:quoteId`, async (req, res) => {
        try {
            noQuery(req);
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            const quote = await quoteService.updateAdmin({
                context: context(req),
                tenantId: req.params.tenantId,
                quoteId: req.params.quoteId,
                input: req.body,
                requestId: req.requestId || null
            });
            return res.json({ success: true, quote });
        } catch (error) {
            return sendError(res, error);
        }
    });

    return app;
}

module.exports = { QUOTE_OWNER_BASE: BASE, attachQuoteOwnerEndpoints };
