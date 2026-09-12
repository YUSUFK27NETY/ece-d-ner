const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const { QUOTE_STATUSES, normalizePersistedQuote, requireQuoteId } = require("../quotes/quote-model");
const { TENANT_COLLECTIONS, tenantCollection, tenantDocument } = require("./tenant-paths");

const AUDIT_ID = /^[0-9a-f-]{36}$/i;
const AUDIT_ACTIONS = new Set(["quote.request.created", "quote.updated"]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function canonicalTenant(value) {
    if (typeof value !== "string") throw new TypeError("Quote repository tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Quote repository tenantId geçersiz.");
    return tenantId;
}

function normalizeLimit(value, fallback = 100) {
    if (value === undefined || value === null || value === "") return fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError("Quote limit geçersiz.");
    return limit;
}

function normalizeStatus(value) {
    if (value === undefined || value === null || value === "") return null;
    const status = String(value).trim();
    if (!QUOTE_STATUSES.includes(status)) throw new TypeError("Quote status filtresi geçersiz.");
    return status;
}

function requireAudit(event, tenantId, action, quoteId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId || event.action !== action || !AUDIT_ACTIONS.has(event.action) ||
        typeof event.eventId !== "string" || !AUDIT_ID.test(event.eventId) ||
        event.metadata?.quoteId !== quoteId) {
        throw new TypeError("Quote audit event geçersiz.");
    }
    return event;
}

function createFirestoreQuoteRepository({ db }) {
    if (!db || typeof db.collection !== "function" || typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore quote repository için db gerekli.");
    }

    function quoteRef(tenantId, quoteId) {
        return db.doc(tenantDocument(tenantId, TENANT_COLLECTIONS.quotes, quoteId));
    }

    function auditRef(tenantId, eventId) {
        return db.doc(`${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`);
    }

    return Object.freeze({
        async listByTenant(rawTenantId, { status = null, limit = 100 } = {}) {
            const tenantId = canonicalTenant(rawTenantId);
            const safeStatus = normalizeStatus(status);
            const safeLimit = normalizeLimit(limit);
            const snapshot = await db.collection(tenantCollection(tenantId, TENANT_COLLECTIONS.quotes)).get();
            if (!snapshot || !Array.isArray(snapshot.docs)) throw new TypeError("Quote snapshot geçersiz.");
            const records = snapshot.docs.map(doc => normalizePersistedQuote({
                tenantId,
                quoteId: requireQuoteId(doc.id),
                data: doc.data()
            }));
            return records
                .filter(record => safeStatus === null || record.status === safeStatus)
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .slice(0, safeLimit);
        },

        async getById(rawTenantId, rawQuoteId) {
            const tenantId = canonicalTenant(rawTenantId);
            const quoteId = requireQuoteId(rawQuoteId);
            const snapshot = await quoteRef(tenantId, quoteId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            return normalizePersistedQuote({ tenantId, quoteId, data: snapshot.data() });
        },

        async commitCreate({ quote, auditEvent } = {}) {
            const tenantId = canonicalTenant(quote?.tenantId);
            const safeQuote = normalizePersistedQuote({
                tenantId,
                quoteId: quote?.quoteId,
                data: quote
            });
            const audit = requireAudit(auditEvent, tenantId, "quote.request.created", safeQuote.quoteId);
            const target = quoteRef(tenantId, safeQuote.quoteId);
            const event = auditRef(tenantId, audit.eventId);
            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Quote create transaction geçersiz.");
                }
                const snapshot = await transaction.get(target);
                if (snapshot?.exists === true && typeof snapshot.data === "function") {
                    const existing = normalizePersistedQuote({
                        tenantId,
                        quoteId: safeQuote.quoteId,
                        data: snapshot.data()
                    });
                    if (existing.requestHash !== safeQuote.requestHash) {
                        throw safeError("QUOTE_IDEMPOTENCY_CONFLICT", "Idempotent teklif talebi önceki istekle uyuşmuyor.");
                    }
                    return Object.freeze({ created: false, quote: existing });
                }
                transaction.create(target, { ...safeQuote });
                transaction.create(event, { ...audit });
                return Object.freeze({ created: true, quote: safeQuote });
            });
        },

        async commitUpdate({ expectedQuote, nextQuote, auditEvent } = {}) {
            const tenantId = canonicalTenant(expectedQuote?.tenantId);
            const expected = normalizePersistedQuote({
                tenantId,
                quoteId: expectedQuote?.quoteId,
                data: expectedQuote
            });
            const next = normalizePersistedQuote({
                tenantId,
                quoteId: nextQuote?.quoteId,
                data: nextQuote
            });
            if (expected.quoteId !== next.quoteId || expected.requestHash !== next.requestHash ||
                expected.createdAt !== next.createdAt) {
                throw new TypeError("Quote immutable alanları değiştirilemez.");
            }
            const audit = requireAudit(auditEvent, tenantId, "quote.updated", expected.quoteId);
            const target = quoteRef(tenantId, expected.quoteId);
            const event = auditRef(tenantId, audit.eventId);
            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" || typeof transaction.create !== "function") {
                    throw new TypeError("Quote update transaction geçersiz.");
                }
                const snapshot = await transaction.get(target);
                if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== "function") {
                    throw safeError("QUOTE_STATE_CHANGED", "Teklif durumu değişti; işlem yeniden değerlendirilmelidir.");
                }
                const persisted = normalizePersistedQuote({
                    tenantId,
                    quoteId: expected.quoteId,
                    data: snapshot.data()
                });
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw safeError("QUOTE_STATE_CHANGED", "Teklif durumu değişti; işlem yeniden değerlendirilmelidir.");
                }
                transaction.update(target, { ...next });
                transaction.create(event, { ...audit });
                return next;
            });
        }
    });
}

module.exports = {
    createFirestoreQuoteRepository,
    normalizeLimit,
    normalizeStatus
};
