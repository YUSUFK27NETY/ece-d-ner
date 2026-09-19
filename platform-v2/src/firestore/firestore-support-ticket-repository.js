const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    normalizePersistedTicket,
    requireStatus,
    requireTicketId
} = require("../support/support-ticket-model");
const {
    TENANT_COLLECTIONS,
    tenantCollection,
    tenantDocument
} = require("./tenant-paths");

const PLATFORM_SUPPORT_TICKETS_COLLECTION = "platformSupportTickets";
const AUDIT_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const AUDIT_ACTIONS = new Set([
    "support.ticket.created",
    "support.ticket.status_changed"
]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function canonicalTenant(value) {
    if (typeof value !== "string") {
        throw new TypeError("Support ticket repository tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Support ticket repository tenantId geçersiz.");
    }
    return tenantId;
}

function normalizeLimit(value, fallback = 100) {
    if (value === undefined || value === null || value === "") return fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        throw new TypeError("Support ticket repository limit geçersiz.");
    }
    return limit;
}

function normalizeStatus(value) {
    if (value === undefined || value === null || value === "") return null;
    return requireStatus(value);
}

function normalizeTenantFilter(value) {
    if (value === undefined || value === null || value === "") return null;
    return canonicalTenant(value);
}

function requireAudit(event, tenantId, action, ticketId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId ||
        event.action !== action ||
        !AUDIT_ACTIONS.has(event.action) ||
        typeof event.eventId !== "string" ||
        !AUDIT_ID_PATTERN.test(event.eventId) ||
        event.metadata?.ticketId !== ticketId) {
        throw new TypeError("Support ticket audit event geçersiz.");
    }
    return event;
}

function projectIndex(ticket) {
    const safe = normalizePersistedTicket({
        tenantId: ticket?.tenantId,
        ticketId: ticket?.ticketId,
        data: ticket
    });
    return Object.freeze({
        schemaVersion: 1,
        ticketId: safe.ticketId,
        tenantId: safe.tenantId,
        subject: safe.subject,
        status: safe.status,
        createdAt: safe.createdAt,
        updatedAt: safe.updatedAt
    });
}

function normalizeIndex(data, documentId) {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        Object.getPrototypeOf(data) !== Object.prototype ||
        data.schemaVersion !== 1 ||
        data.ticketId !== documentId) {
        throw new TypeError("Support ticket platform index geçersiz.");
    }
    const tenantId = canonicalTenant(data.tenantId);
    const ticketId = requireTicketId(data.ticketId);
    const subject = typeof data.subject === "string" ? data.subject.trim() : "";
    if (subject.length < 3 || subject.length > 120) {
        throw new TypeError("Support ticket platform index konusu geçersiz.");
    }
    const status = requireStatus(data.status);
    const createdAt = typeof data.createdAt === "string" ? data.createdAt : "";
    const updatedAt = typeof data.updatedAt === "string" ? data.updatedAt : "";
    const createdMs = Date.parse(createdAt);
    const updatedMs = Date.parse(updatedAt);
    if (!Number.isFinite(createdMs) || !Number.isFinite(updatedMs) ||
        new Date(createdMs).toISOString() !== createdAt ||
        new Date(updatedMs).toISOString() !== updatedAt ||
        createdAt > updatedAt) {
        throw new TypeError("Support ticket platform index zamanı geçersiz.");
    }
    return Object.freeze({
        schemaVersion: 1,
        ticketId,
        tenantId,
        subject,
        status,
        createdAt,
        updatedAt
    });
}

function createFirestoreSupportTicketRepository({ db }) {
    if (!db || typeof db.collection !== "function" ||
        typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore support ticket repository için db gerekli.");
    }

    function ticketRef(tenantId, ticketId) {
        return db.doc(tenantDocument(
            tenantId,
            TENANT_COLLECTIONS.supportTickets,
            ticketId
        ));
    }

    function indexRef(ticketId) {
        return db.doc(`${PLATFORM_SUPPORT_TICKETS_COLLECTION}/${requireTicketId(ticketId)}`);
    }

    function auditRef(tenantId, eventId) {
        return db.doc(
            `${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`
        );
    }

    async function ticketFromSnapshot(snapshot, tenantId, ticketId) {
        if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== "function") {
            return null;
        }
        return normalizePersistedTicket({
            tenantId,
            ticketId,
            data: snapshot.data()
        });
    }

    return Object.freeze({
        async create({ ticket, auditEvent } = {}) {
            const tenantId = canonicalTenant(ticket?.tenantId);
            const safeTicket = normalizePersistedTicket({
                tenantId,
                ticketId: ticket?.ticketId,
                data: ticket
            });
            const audit = requireAudit(
                auditEvent,
                tenantId,
                "support.ticket.created",
                safeTicket.ticketId
            );
            const target = ticketRef(tenantId, safeTicket.ticketId);
            const index = indexRef(safeTicket.ticketId);
            const event = auditRef(tenantId, audit.eventId);
            const summary = projectIndex(safeTicket);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Support ticket create transaction geçersiz.");
                }
                const [ticketSnapshot, indexSnapshot] = await Promise.all([
                    transaction.get(target),
                    transaction.get(index)
                ]);
                if (ticketSnapshot?.exists === true || indexSnapshot?.exists === true) {
                    throw safeError(
                        "SUPPORT_TICKET_ID_CONFLICT",
                        "Support ticket kimliği zaten kullanılıyor."
                    );
                }
                transaction.create(target, { ...safeTicket });
                transaction.create(index, { ...summary });
                transaction.create(event, { ...audit });
                return safeTicket;
            });
        },

        async listByTenant(rawTenantId, { status = null, limit = 100 } = {}) {
            const tenantId = canonicalTenant(rawTenantId);
            const safeStatus = normalizeStatus(status);
            const safeLimit = normalizeLimit(limit);
            let query = db.collection(
                tenantCollection(tenantId, TENANT_COLLECTIONS.supportTickets)
            );
            if (typeof query.orderBy === "function") {
                query = query.orderBy("updatedAt", "desc");
            }
            if (typeof query.limit === "function") {
                query = query.limit(Math.max(safeLimit, 200));
            }
            const snapshot = await query.get();
            if (!snapshot || !Array.isArray(snapshot.docs)) {
                throw new TypeError("Support ticket tenant snapshot geçersiz.");
            }
            return snapshot.docs
                .map(document => normalizePersistedTicket({
                    tenantId,
                    ticketId: requireTicketId(document.id),
                    data: document.data()
                }))
                .filter(ticket => safeStatus === null || ticket.status === safeStatus)
                .sort((left, right) =>
                    right.updatedAt.localeCompare(left.updatedAt) ||
                    left.ticketId.localeCompare(right.ticketId)
                )
                .slice(0, safeLimit);
        },

        async listPlatform({ tenantId = null, status = null, limit = 200 } = {}) {
            const tenantFilter = normalizeTenantFilter(tenantId);
            const statusFilter = normalizeStatus(status);
            const safeLimit = normalizeLimit(limit, 200);

            let query = db.collection(PLATFORM_SUPPORT_TICKETS_COLLECTION);
            if (tenantFilter !== null && typeof query.where === "function") {
                query = query.where("tenantId", "==", tenantFilter);
            } else if (statusFilter !== null && typeof query.where === "function") {
                query = query.where("status", "==", statusFilter);
            }
            if (typeof query.orderBy === "function" && tenantFilter === null &&
                statusFilter === null) {
                query = query.orderBy("updatedAt", "desc");
            }
            if (typeof query.limit === "function") {
                query = query.limit(1000);
            }
            const snapshot = await query.get();
            if (!snapshot || !Array.isArray(snapshot.docs)) {
                throw new TypeError("Support ticket platform snapshot geçersiz.");
            }

            const indexes = snapshot.docs
                .map(document => normalizeIndex(document.data(), document.id))
                .filter(item =>
                    (tenantFilter === null || item.tenantId === tenantFilter) &&
                    (statusFilter === null || item.status === statusFilter)
                )
                .sort((left, right) =>
                    right.updatedAt.localeCompare(left.updatedAt) ||
                    left.ticketId.localeCompare(right.ticketId)
                )
                .slice(0, safeLimit);

            const tickets = await Promise.all(indexes.map(index =>
                this.getById(index.tenantId, index.ticketId)
            ));
            if (tickets.some(ticket => ticket === null)) {
                throw safeError(
                    "SUPPORT_TICKET_INDEX_MISMATCH",
                    "Support ticket platform index tenant kaydıyla uyuşmuyor."
                );
            }
            return tickets;
        },

        async getById(rawTenantId, rawTicketId) {
            const tenantId = canonicalTenant(rawTenantId);
            const ticketId = requireTicketId(rawTicketId);
            const snapshot = await ticketRef(tenantId, ticketId).get();
            return ticketFromSnapshot(snapshot, tenantId, ticketId);
        },

        async update({ expectedTicket, nextTicket, auditEvent } = {}) {
            const tenantId = canonicalTenant(expectedTicket?.tenantId);
            const expected = normalizePersistedTicket({
                tenantId,
                ticketId: expectedTicket?.ticketId,
                data: expectedTicket
            });
            const next = normalizePersistedTicket({
                tenantId,
                ticketId: nextTicket?.ticketId,
                data: nextTicket
            });
            if (expected.ticketId !== next.ticketId ||
                expected.createdAt !== next.createdAt ||
                expected.subject !== next.subject ||
                expected.description !== next.description) {
                throw new TypeError("Support ticket immutable alanları değiştirilemez.");
            }
            const audit = requireAudit(
                auditEvent,
                tenantId,
                "support.ticket.status_changed",
                expected.ticketId
            );
            const target = ticketRef(tenantId, expected.ticketId);
            const index = indexRef(expected.ticketId);
            const event = auditRef(tenantId, audit.eventId);
            const nextIndex = projectIndex(next);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Support ticket update transaction geçersiz.");
                }
                const [ticketSnapshot, indexSnapshot] = await Promise.all([
                    transaction.get(target),
                    transaction.get(index)
                ]);
                const persisted = await ticketFromSnapshot(
                    ticketSnapshot,
                    tenantId,
                    expected.ticketId
                );
                if (!persisted || !indexSnapshot?.exists ||
                    typeof indexSnapshot.data !== "function" ||
                    !isDeepStrictEqual(
                        normalizeIndex(indexSnapshot.data(), expected.ticketId),
                        projectIndex(expected)
                    ) ||
                    !isDeepStrictEqual(persisted, expected)) {
                    throw safeError(
                        "SUPPORT_TICKET_STATE_CHANGED",
                        "Support ticket durumu değişti; işlem yeniden değerlendirilmelidir."
                    );
                }

                transaction.update(target, { ...next });
                transaction.update(index, { ...nextIndex });
                transaction.create(event, { ...audit });
                return next;
            });
        }
    });
}

module.exports = {
    PLATFORM_SUPPORT_TICKETS_COLLECTION,
    createFirestoreSupportTicketRepository,
    normalizeIndex,
    normalizeLimit,
    normalizeStatus,
    projectIndex
};
