const { sendPlatformError } = require("./create-platform-app");

const OWNER_SUPPORT_TICKETS_BASE =
    "/api/tenant/tenants/:tenantId/owner/support/tickets";

function actorContext(req) {
    return Object.freeze({
        role: req.tenantActor?.role,
        actorId: req.tenantActor?.actorId,
        tenantId: req.tenantActor?.tenantId
    });
}

function assertAllowedQuery(query, allowed) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Support ticket query geçersiz.");
    }
    for (const key of Reflect.ownKeys(query)) {
        if (typeof key !== "string" || !allowed.has(key)) {
            throw new TypeError("Support ticket query geçersiz.");
        }
    }
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Support ticket endpoint query kabul etmez.");
    }
}

function sendTicketError(res, error) {
    if (error?.code === "SUPPORT_TICKET_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "Destek talebi bulunamadı."
        });
    }
    if (new Set([
        "TENANT_SCOPE_MISMATCH",
        "PERMISSION_DENIED"
    ]).has(error?.code)) {
        return res.status(403).json({
            success: false,
            message: "Bu destek talebi için yetkiniz yok."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Destek talebi geçersiz."
        });
    }
    return sendPlatformError(res, error);
}

function attachSupportTicketOwnerEndpoints({ app, supportTicketService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
        throw new TypeError("Support ticket owner endpoint app geçersiz.");
    }
    if (!supportTicketService ||
        typeof supportTicketService.createOwnerTicket !== "function" ||
        typeof supportTicketService.listOwnerTickets !== "function" ||
        typeof supportTicketService.getOwnerTicket !== "function") {
        throw new TypeError("Support ticket owner service geçersiz.");
    }

    app.get(OWNER_SUPPORT_TICKETS_BASE, async (req, res) => {
        try {
            assertAllowedQuery(req.query, new Set(["status", "limit"]));
            const tickets = await supportTicketService.listOwnerTickets({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                status: req.query.status || null,
                limit: req.query.limit === undefined ? 100 : req.query.limit
            });
            return res.json({ success: true, tickets });
        } catch (error) {
            return sendTicketError(res, error);
        }
    });

    app.post(OWNER_SUPPORT_TICKETS_BASE, async (req, res) => {
        try {
            noQuery(req);
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            const ticket = await supportTicketService.createOwnerTicket({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                input: req.body,
                requestId: req.requestId || null
            });
            return res.status(201).json({ success: true, ticket });
        } catch (error) {
            return sendTicketError(res, error);
        }
    });

    app.get(`${OWNER_SUPPORT_TICKETS_BASE}/:ticketId`, async (req, res) => {
        try {
            noQuery(req);
            const ticket = await supportTicketService.getOwnerTicket({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                ticketId: req.params.ticketId
            });
            return res.json({ success: true, ticket });
        } catch (error) {
            return sendTicketError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_SUPPORT_TICKETS_BASE,
    attachSupportTicketOwnerEndpoints,
    sendTicketError
};
