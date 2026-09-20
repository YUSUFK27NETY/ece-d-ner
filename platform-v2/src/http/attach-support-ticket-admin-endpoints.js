const { sendPlatformError } = require("./create-platform-app");

const PLATFORM_SUPPORT_TICKETS_BASE = "/api/platform/support/tickets";

function platformContext(req) {
    return Object.freeze({
        role: req.platformActor?.role,
        actorId: req.platformActor?.uid
    });
}

function assertAllowedQuery(query, allowed) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Support ticket admin query geçersiz.");
    }
    for (const key of Reflect.ownKeys(query)) {
        if (typeof key !== "string" || !allowed.has(key)) {
            throw new TypeError("Support ticket admin query geçersiz.");
        }
    }
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Support ticket admin endpoint query kabul etmez.");
    }
}

function sendAdminTicketError(res, error) {
    if (error?.code === "SUPPORT_TICKET_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "Destek talebi bulunamadı."
        });
    }
    if (new Set([
        "SUPPORT_TICKET_STATUS_TRANSITION_INVALID",
        "SUPPORT_TICKET_STATE_CHANGED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "Destek talebi durumu değişti; sayfayı yenileyip tekrar deneyin."
        });
    }
    if (error?.code === "PERMISSION_DENIED") {
        return res.status(403).json({
            success: false,
            message: "Platform Admin yetkisi gerekli."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Destek talebi isteği geçersiz."
        });
    }
    return sendPlatformError(res, error);
}

function attachSupportTicketAdminEndpoints({ app, supportTicketService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Support ticket admin endpoint app geçersiz.");
    }
    if (!supportTicketService ||
        typeof supportTicketService.listPlatformTickets !== "function" ||
        typeof supportTicketService.getPlatformTicket !== "function" ||
        typeof supportTicketService.updatePlatformTicketStatus !== "function") {
        throw new TypeError("Support ticket admin service geçersiz.");
    }

    app.get(PLATFORM_SUPPORT_TICKETS_BASE, async (req, res) => {
        try {
            assertAllowedQuery(
                req.query,
                new Set(["tenantId", "status", "limit"])
            );
            const tickets = await supportTicketService.listPlatformTickets({
                context: platformContext(req),
                tenantId: req.query.tenantId || null,
                status: req.query.status || null,
                limit: req.query.limit === undefined ? 200 : req.query.limit
            });
            return res.json({ success: true, tickets });
        } catch (error) {
            return sendAdminTicketError(res, error);
        }
    });

    app.get(
        `${PLATFORM_SUPPORT_TICKETS_BASE}/:tenantId/:ticketId`,
        async (req, res) => {
            try {
                noQuery(req);
                const ticket = await supportTicketService.getPlatformTicket({
                    context: platformContext(req),
                    tenantId: req.params.tenantId,
                    ticketId: req.params.ticketId
                });
                return res.json({ success: true, ticket });
            } catch (error) {
                return sendAdminTicketError(res, error);
            }
        }
    );

    app.patch(
        `${PLATFORM_SUPPORT_TICKETS_BASE}/:tenantId/:ticketId/status`,
        async (req, res) => {
            try {
                noQuery(req);
                if (!req.is("application/json")) {
                    return res.status(415).json({
                        success: false,
                        message: "Content-Type application/json olmalı."
                    });
                }
                const ticket = await supportTicketService.updatePlatformTicketStatus({
                    context: platformContext(req),
                    tenantId: req.params.tenantId,
                    ticketId: req.params.ticketId,
                    input: req.body,
                    requestId: req.requestId || null
                });
                return res.json({ success: true, ticket });
            } catch (error) {
                return sendAdminTicketError(res, error);
            }
        }
    );

    return app;
}

module.exports = {
    PLATFORM_SUPPORT_TICKETS_BASE,
    attachSupportTicketAdminEndpoints,
    sendAdminTicketError
};
