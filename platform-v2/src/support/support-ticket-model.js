const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");

const SUPPORT_TICKET_STATUSES = Object.freeze(["open", "in_review", "resolved"]);
const SUPPORT_TICKET_TRANSITIONS = Object.freeze({
    open: Object.freeze(["in_review", "resolved"]),
    in_review: Object.freeze(["resolved"]),
    resolved: Object.freeze([])
});
const SUPPORT_ACTOR_ROLES = Object.freeze([
    "tenant_owner",
    "tenant_admin",
    "platform_admin"
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function ticketError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requirePlainRecord(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return value;
}

function requireExactFields(value, allowed, label) {
    requirePlainRecord(value, label);
    for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== "string" || !allowed.has(key)) {
            throw new TypeError(`${label} bilinmeyen alan içeriyor.`);
        }
    }
    return value;
}

function requireTicketId(value) {
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new TypeError("Support ticket kimliği geçersiz.");
    }
    return value;
}

function requireStatus(value) {
    if (typeof value !== "string" || !SUPPORT_TICKET_STATUSES.includes(value)) {
        throw new TypeError("Support ticket durumu geçersiz.");
    }
    return value;
}

function requireCanonicalTimestamp(value, label = "Support ticket zamanı") {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0 ||
        new Date(timestamp).toISOString() !== value) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return value;
}

function normalizeText(value, { label, min, max }) {
    if (typeof value !== "string") throw new TypeError(`${label} geçersiz.`);
    const text = value.trim();
    if (text.length < min || text.length > max) {
        throw new TypeError(`${label} ${min}-${max} karakter olmalı.`);
    }
    return text;
}

function normalizeNullableNote(value) {
    if (value === undefined || value === null || value === "") return null;
    return normalizeText(value, { label: "Support ticket notu", min: 1, max: 1000 });
}

function normalizeCreateInput(input) {
    requireExactFields(input, new Set(["subject", "description"]), "Support ticket oluşturma");
    return Object.freeze({
        subject: normalizeText(input.subject, {
            label: "Support ticket konusu",
            min: 3,
            max: 120
        }),
        description: normalizeText(input.description, {
            label: "Support ticket açıklaması",
            min: 5,
            max: 2000
        })
    });
}

function normalizeStatusUpdateInput(input) {
    requireExactFields(input, new Set(["status", "note"]), "Support ticket durum güncelleme");
    return Object.freeze({
        status: requireStatus(input.status),
        note: normalizeNullableNote(input.note)
    });
}

function createHistoryEntry({ status, actorRole, note = null, now = new Date() }) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Support ticket history tarihi geçersiz.");
    }
    if (!SUPPORT_ACTOR_ROLES.includes(actorRole)) {
        throw new TypeError("Support ticket actor role geçersiz.");
    }
    return Object.freeze({
        eventId: crypto.randomUUID(),
        status: requireStatus(status),
        actorRole,
        note: normalizeNullableNote(note),
        createdAt: now.toISOString()
    });
}

function normalizeHistoryEntry(value) {
    requireExactFields(
        value,
        new Set(["eventId", "status", "actorRole", "note", "createdAt"]),
        "Support ticket history"
    );
    if (!SUPPORT_ACTOR_ROLES.includes(value.actorRole)) {
        throw new TypeError("Support ticket history actor role geçersiz.");
    }
    return Object.freeze({
        eventId: requireTicketId(value.eventId),
        status: requireStatus(value.status),
        actorRole: value.actorRole,
        note: normalizeNullableNote(value.note),
        createdAt: requireCanonicalTimestamp(value.createdAt, "Support ticket history zamanı")
    });
}

function normalizePersistedTicket({ tenantId, ticketId, data }) {
    const safeTenantId = requireTenantId(tenantId);
    const safeTicketId = requireTicketId(ticketId);
    requireExactFields(data, new Set([
        "schemaVersion",
        "ticketId",
        "tenantId",
        "subject",
        "description",
        "status",
        "createdAt",
        "updatedAt",
        "history"
    ]), "Support ticket kaydı");

    if (data.schemaVersion !== 1 ||
        data.ticketId !== safeTicketId ||
        data.tenantId !== safeTenantId ||
        !Array.isArray(data.history) ||
        data.history.length < 1 ||
        data.history.length > 4) {
        throw new TypeError("Support ticket persisted contract geçersiz.");
    }

    const history = data.history.map(normalizeHistoryEntry);
    const createdAt = requireCanonicalTimestamp(data.createdAt, "Support ticket createdAt");
    const updatedAt = requireCanonicalTimestamp(data.updatedAt, "Support ticket updatedAt");
    if (createdAt > updatedAt ||
        history[0].status !== "open" ||
        history[0].createdAt !== createdAt ||
        history.at(-1).status !== data.status ||
        history.at(-1).createdAt !== updatedAt) {
        throw new TypeError("Support ticket zaman/durum sırası geçersiz.");
    }

    for (let index = 1; index < history.length; index += 1) {
        const previous = history[index - 1];
        const current = history[index];
        if (previous.createdAt > current.createdAt ||
            !SUPPORT_TICKET_TRANSITIONS[previous.status].includes(current.status)) {
            throw new TypeError("Support ticket history geçişi geçersiz.");
        }
    }

    return Object.freeze({
        schemaVersion: 1,
        ticketId: safeTicketId,
        tenantId: safeTenantId,
        subject: normalizeText(data.subject, {
            label: "Support ticket konusu",
            min: 3,
            max: 120
        }),
        description: normalizeText(data.description, {
            label: "Support ticket açıklaması",
            min: 5,
            max: 2000
        }),
        status: requireStatus(data.status),
        createdAt,
        updatedAt,
        history: Object.freeze(history)
    });
}

function createTicketRecord({
    tenantId,
    input,
    actorRole,
    now = new Date()
}) {
    const safeTenantId = requireTenantId(tenantId);
    const normalized = normalizeCreateInput(input);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Support ticket tarihi geçersiz.");
    }
    const ticketId = crypto.randomUUID();
    const at = now.toISOString();
    const history = Object.freeze([
        createHistoryEntry({
            status: "open",
            actorRole,
            now
        })
    ]);
    return normalizePersistedTicket({
        tenantId: safeTenantId,
        ticketId,
        data: {
            schemaVersion: 1,
            ticketId,
            tenantId: safeTenantId,
            subject: normalized.subject,
            description: normalized.description,
            status: "open",
            createdAt: at,
            updatedAt: at,
            history
        }
    });
}

function changeTicketStatus(ticket, { status, note, actorRole, now = new Date() }) {
    const current = normalizePersistedTicket({
        tenantId: ticket?.tenantId,
        ticketId: ticket?.ticketId,
        data: ticket
    });
    const nextStatus = requireStatus(status);
    if (!SUPPORT_TICKET_TRANSITIONS[current.status].includes(nextStatus)) {
        throw ticketError(
            "SUPPORT_TICKET_STATUS_TRANSITION_INVALID",
            "Support ticket durum geçişi geçersiz."
        );
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime()) ||
        now.toISOString() < current.updatedAt) {
        throw new TypeError("Support ticket güncelleme tarihi geçersiz.");
    }
    const entry = createHistoryEntry({
        status: nextStatus,
        actorRole,
        note,
        now
    });
    return normalizePersistedTicket({
        tenantId: current.tenantId,
        ticketId: current.ticketId,
        data: {
            ...current,
            status: nextStatus,
            updatedAt: entry.createdAt,
            history: [...current.history, entry]
        }
    });
}

function projectSupportTicket(ticket) {
    const safe = normalizePersistedTicket({
        tenantId: ticket?.tenantId,
        ticketId: ticket?.ticketId,
        data: ticket
    });
    return Object.freeze({
        schemaVersion: safe.schemaVersion,
        ticketId: safe.ticketId,
        tenantId: safe.tenantId,
        subject: safe.subject,
        description: safe.description,
        status: safe.status,
        createdAt: safe.createdAt,
        updatedAt: safe.updatedAt,
        history: Object.freeze(safe.history.map(entry => Object.freeze({
            eventId: entry.eventId,
            status: entry.status,
            actorRole: entry.actorRole,
            note: entry.note,
            createdAt: entry.createdAt
        })))
    });
}

module.exports = {
    SUPPORT_ACTOR_ROLES,
    SUPPORT_TICKET_STATUSES,
    SUPPORT_TICKET_TRANSITIONS,
    changeTicketStatus,
    createHistoryEntry,
    createTicketRecord,
    normalizeCreateInput,
    normalizePersistedTicket,
    normalizeStatusUpdateInput,
    projectSupportTicket,
    requireStatus,
    requireTicketId,
    ticketError
};
