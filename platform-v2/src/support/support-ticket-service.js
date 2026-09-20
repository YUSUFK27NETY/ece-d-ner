const { isDeepStrictEqual } = require("node:util");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { createAuditEvent } = require("../audit/audit-event");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    SUPPORT_TICKET_STATUSES,
    changeTicketStatus,
    createTicketRecord,
    normalizeStatusUpdateInput,
    projectSupportTicket,
    requireTicketId,
    requireStatus
} = require("./support-ticket-model");

function requirePlatformAdmin(context) {
    if (!context || context.role !== "platform_admin" ||
        typeof context.actorId !== "string" || !context.actorId) {
        const error = new Error("Platform Admin yetkisi gerekli.");
        error.code = "PERMISSION_DENIED";
        throw error;
    }
    return context;
}

function normalizeLimit(value, fallback = 100) {
    if (value === undefined || value === null || value === "") return fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Support ticket limit 1-200 arasında olmalı.");
    }
    return limit;
}

function normalizeOptionalStatus(value) {
    if (value === undefined || value === null || value === "" || value === "all") {
        return null;
    }
    return requireStatus(value);
}

function normalizeOptionalTenantId(value) {
    if (value === undefined || value === null || value === "") return null;
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Support ticket tenant filtresi canonical olmalı.");
    }
    return tenantId;
}

function createSupportTicketService({ repository, clock = () => new Date() }) {
    for (const method of ["create", "listByTenant", "listPlatform", "getById", "update"]) {
        if (!repository || typeof repository[method] !== "function") {
            throw new TypeError(`Support ticket repository ${method} gerekli.`);
        }
    }
    if (typeof clock !== "function") {
        throw new TypeError("Support ticket clock gerekli.");
    }

    function now() {
        const value = clock();
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new TypeError("Support ticket clock geçersiz.");
        }
        return new Date(value.getTime());
    }

    return Object.freeze({
        async createOwnerTicket({ context, tenantId, input, requestId = null }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "support.create"
            });
            const ticket = createTicketRecord({
                tenantId: safeTenantId,
                input,
                actorRole: context.role,
                now: now()
            });
            const auditEvent = createAuditEvent({
                tenantId: safeTenantId,
                action: "support.ticket.created",
                actorId: context.actorId,
                requestId,
                metadata: {
                    ticketId: ticket.ticketId,
                    status: ticket.status
                },
                now: new Date(ticket.createdAt)
            });
            return projectSupportTicket(await repository.create({
                ticket,
                auditEvent
            }));
        },

        async listOwnerTickets({ context, tenantId, status = null, limit = 100 }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "support.read"
            });
            const rows = await repository.listByTenant(safeTenantId, {
                status: normalizeOptionalStatus(status),
                limit: normalizeLimit(limit)
            });
            return Object.freeze(rows.map(projectSupportTicket));
        },

        async getOwnerTicket({ context, tenantId, ticketId }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "support.read"
            });
            const ticket = await repository.getById(
                safeTenantId,
                requireTicketId(ticketId)
            );
            if (!ticket) {
                const error = new Error("Support ticket bulunamadı.");
                error.code = "SUPPORT_TICKET_NOT_FOUND";
                throw error;
            }
            return projectSupportTicket(ticket);
        },

        async listPlatformTickets({
            context,
            tenantId = null,
            status = null,
            limit = 200
        }) {
            requirePlatformAdmin(context);
            const rows = await repository.listPlatform({
                tenantId: normalizeOptionalTenantId(tenantId),
                status: normalizeOptionalStatus(status),
                limit: normalizeLimit(limit, 200)
            });
            return Object.freeze(rows.map(projectSupportTicket));
        },

        async getPlatformTicket({ context, tenantId, ticketId }) {
            requirePlatformAdmin(context);
            const safeTenantId = requireTenantId(tenantId);
            const ticket = await repository.getById(
                safeTenantId,
                requireTicketId(ticketId)
            );
            if (!ticket) {
                const error = new Error("Support ticket bulunamadı.");
                error.code = "SUPPORT_TICKET_NOT_FOUND";
                throw error;
            }
            return projectSupportTicket(ticket);
        },

        async updatePlatformTicketStatus({
            context,
            tenantId,
            ticketId,
            input,
            requestId = null
        }) {
            requirePlatformAdmin(context);
            const safeTenantId = requireTenantId(tenantId);
            const safeTicketId = requireTicketId(ticketId);
            const patch = normalizeStatusUpdateInput(input);
            const current = await repository.getById(safeTenantId, safeTicketId);
            if (!current) {
                const error = new Error("Support ticket bulunamadı.");
                error.code = "SUPPORT_TICKET_NOT_FOUND";
                throw error;
            }
            const next = changeTicketStatus(current, {
                status: patch.status,
                note: patch.note,
                actorRole: "platform_admin",
                now: now()
            });
            if (isDeepStrictEqual(current, next)) {
                return projectSupportTicket(current);
            }
            const auditEvent = createAuditEvent({
                tenantId: safeTenantId,
                action: "support.ticket.status_changed",
                actorId: context.actorId,
                requestId,
                metadata: {
                    ticketId: safeTicketId,
                    fromStatus: current.status,
                    toStatus: next.status
                },
                now: new Date(next.updatedAt)
            });
            return projectSupportTicket(await repository.update({
                expectedTicket: current,
                nextTicket: next,
                auditEvent
            }));
        },

        statuses: SUPPORT_TICKET_STATUSES
    });
}

module.exports = {
    createSupportTicketService,
    normalizeLimit,
    normalizeOptionalStatus,
    normalizeOptionalTenantId,
    requirePlatformAdmin
};
