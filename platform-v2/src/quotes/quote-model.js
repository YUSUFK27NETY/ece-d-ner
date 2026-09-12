const { requireProductId } = require("../catalog/product-model");

const QUOTE_STATUSES = Object.freeze([
    "new",
    "reviewing",
    "quoted",
    "won",
    "lost",
    "cancelled"
]);
const QUOTE_ID_PATTERN = /^q_[a-f0-9]{32}$/;
const REQUEST_HASH_PATTERN = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const TRANSITIONS = Object.freeze({
    new: Object.freeze(["reviewing", "quoted", "cancelled"]),
    reviewing: Object.freeze(["quoted", "cancelled"]),
    quoted: Object.freeze(["reviewing", "won", "lost", "cancelled"]),
    won: Object.freeze([]),
    lost: Object.freeze([]),
    cancelled: Object.freeze([])
});

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function assertKeys(value, allowed, label) {
    if (!isPlainRecord(value)) throw new TypeError(`${label} nesne olmalı.`);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new TypeError(`${label} bilinmeyen alan içeriyor.`);
    }
}

function requireText(value, label, min, max) {
    const text = String(value ?? "").trim();
    if (text.length < min || text.length > max) throw new TypeError(`${label} geçersiz.`);
    return text;
}

function optionalText(value, label, max) {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    return requireText(value, label, 1, max);
}

function requireQuoteId(value) {
    const id = String(value ?? "").trim();
    if (!QUOTE_ID_PATTERN.test(id)) throw new TypeError("quoteId geçersiz.");
    return id;
}

function requireRequestHash(value) {
    const hash = String(value ?? "").trim().toLowerCase();
    if (!REQUEST_HASH_PATTERN.test(hash)) throw new TypeError("Quote request hash geçersiz.");
    return hash;
}

function requireIdempotencyKey(value) {
    const key = String(value ?? "").trim();
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new TypeError("Idempotency-Key geçersiz.");
    return key;
}

function normalizeEmail(value) {
    const email = optionalText(value, "E-posta", 254);
    if (email === null) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError("E-posta geçersiz.");
    return email.toLowerCase();
}

function normalizePhone(value) {
    const phone = optionalText(value, "Telefon", 32);
    if (phone === null) return null;
    if (!/^[+0-9() .-]{7,32}$/.test(phone)) throw new TypeError("Telefon geçersiz.");
    return phone;
}

function normalizeQuoteItem(item) {
    assertKeys(item, new Set(["productId", "description", "quantity", "unit"]), "Teklif kalemi");
    const productId = item.productId === undefined || item.productId === null || item.productId === ""
        ? null
        : requireProductId(item.productId);
    const description = requireText(item.description, "Teklif kalemi açıklaması", 2, 220);
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
        throw new TypeError("Teklif kalemi miktarı geçersiz.");
    }
    const unit = optionalText(item.unit, "Teklif kalemi birimi", 40);
    return Object.freeze({ productId, description, quantity, unit });
}

function normalizePublicQuoteInput(input) {
    assertKeys(input, new Set([
        "companyName", "country", "contactName", "email", "phone", "items", "note"
    ]), "Teklif talebi");
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 25) {
        throw new TypeError("Teklif kalemleri geçersiz.");
    }
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    if (!email && !phone) throw new TypeError("E-posta veya telefon gerekli.");
    return Object.freeze({
        companyName: requireText(input.companyName, "Firma adı", 2, 160),
        country: requireText(input.country, "Ülke", 2, 80),
        contactName: requireText(input.contactName, "Yetkili adı", 2, 120),
        email,
        phone,
        items: Object.freeze(input.items.map(normalizeQuoteItem)),
        note: optionalText(input.note, "Teklif notu", 1200)
    });
}

function requireIsoTimestamp(value, label) {
    const text = String(value ?? "");
    const date = new Date(text);
    if (!text || Number.isNaN(date.getTime()) || date.toISOString() !== text) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return text;
}

function normalizeOffer(input) {
    if (!isPlainRecord(input)) throw new TypeError("Teklif cevabı geçersiz.");
    assertKeys(input, new Set([
        "status", "amountMinor", "currency", "validUntil", "customerMessage", "ownerNote"
    ]), "Teklif cevabı");
    if (Object.keys(input).length === 0) throw new TypeError("Teklif cevabı boş olamaz.");
    const output = {};
    if (input.status !== undefined) {
        const status = String(input.status).trim();
        if (!QUOTE_STATUSES.includes(status)) throw new TypeError("Teklif durumu geçersiz.");
        output.status = status;
    }
    if (input.amountMinor !== undefined) {
        if (input.amountMinor === null || input.amountMinor === "") {
            output.amountMinor = null;
        } else {
            const amount = Number(input.amountMinor);
            if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000_000_000) {
                throw new TypeError("Teklif tutarı geçersiz.");
            }
            output.amountMinor = amount;
        }
    }
    if (input.currency !== undefined) {
        if (input.currency === null || String(input.currency).trim() === "") {
            output.currency = null;
        } else {
            const currency = String(input.currency).trim().toUpperCase();
            if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("Para birimi geçersiz.");
            output.currency = currency;
        }
    }
    if (input.validUntil !== undefined) {
        if (input.validUntil === null || String(input.validUntil).trim() === "") {
            output.validUntil = null;
        } else {
            const value = String(input.validUntil).trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
                throw new TypeError("Teklif geçerlilik tarihi geçersiz.");
            }
            output.validUntil = value;
        }
    }
    if (input.customerMessage !== undefined) output.customerMessage = optionalText(input.customerMessage, "Müşteri mesajı", 1200);
    if (input.ownerNote !== undefined) output.ownerNote = optionalText(input.ownerNote, "İşletme notu", 1200);
    return Object.freeze(output);
}

function assertStatusTransition(from, to) {
    if (from === to) return true;
    if (!TRANSITIONS[from]?.includes(to)) {
        const error = new Error("Teklif durum geçişi geçersiz.");
        error.code = "QUOTE_STATUS_TRANSITION_INVALID";
        throw error;
    }
    return true;
}

function normalizePersistedQuote({ tenantId, quoteId, data }) {
    if (!isPlainRecord(data) || data.schemaVersion !== 1 || data.tenantId !== tenantId ||
        data.quoteId !== quoteId || !QUOTE_STATUSES.includes(data.status)) {
        throw new TypeError("Persisted quote geçersiz.");
    }
    const normalized = normalizePublicQuoteInput({
        companyName: data.companyName,
        country: data.country,
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        items: data.items,
        note: data.note
    });
    const amountMinor = data.amountMinor === null ? null : Number(data.amountMinor);
    if (amountMinor !== null && (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || amountMinor > 100_000_000_000_000)) {
        throw new TypeError("Persisted quote tutarı geçersiz.");
    }
    const currency = data.currency === null ? null : String(data.currency ?? "").trim().toUpperCase();
    if (currency !== null && !/^[A-Z]{3}$/.test(currency)) throw new TypeError("Persisted quote currency geçersiz.");
    const validUntil = data.validUntil === null ? null : String(data.validUntil ?? "");
    if (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) throw new TypeError("Persisted quote validUntil geçersiz.");
    return Object.freeze({
        schemaVersion: 1,
        tenantId,
        quoteId: requireQuoteId(quoteId),
        requestHash: requireRequestHash(data.requestHash),
        ...normalized,
        status: data.status,
        amountMinor,
        currency,
        validUntil,
        customerMessage: optionalText(data.customerMessage, "Persisted customer message", 1200),
        ownerNote: optionalText(data.ownerNote, "Persisted owner note", 1200),
        createdAt: requireIsoTimestamp(data.createdAt, "Quote createdAt"),
        updatedAt: requireIsoTimestamp(data.updatedAt, "Quote updatedAt")
    });
}

function createQuoteRecord({ tenantId, quoteId, requestHash, input, now }) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Quote tarihi geçersiz.");
    const normalized = normalizePublicQuoteInput(input);
    return normalizePersistedQuote({
        tenantId,
        quoteId: requireQuoteId(quoteId),
        data: {
            schemaVersion: 1,
            tenantId,
            quoteId,
            requestHash: requireRequestHash(requestHash),
            ...normalized,
            status: "new",
            amountMinor: null,
            currency: null,
            validUntil: null,
            customerMessage: null,
            ownerNote: null,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
        }
    });
}

function projectQuotePublic(quote) {
    return Object.freeze({
        quoteId: quote.quoteId,
        status: quote.status,
        createdAt: quote.createdAt
    });
}

function projectQuoteAdmin(quote) {
    return Object.freeze({
        quoteId: quote.quoteId,
        status: quote.status,
        companyName: quote.companyName,
        country: quote.country,
        contactName: quote.contactName,
        email: quote.email,
        phone: quote.phone,
        items: quote.items,
        note: quote.note,
        amountMinor: quote.amountMinor,
        currency: quote.currency,
        validUntil: quote.validUntil,
        customerMessage: quote.customerMessage,
        ownerNote: quote.ownerNote,
        createdAt: quote.createdAt,
        updatedAt: quote.updatedAt
    });
}

module.exports = {
    IDEMPOTENCY_KEY_PATTERN,
    QUOTE_STATUSES,
    TRANSITIONS,
    assertStatusTransition,
    createQuoteRecord,
    normalizeOffer,
    normalizePersistedQuote,
    normalizePublicQuoteInput,
    projectQuoteAdmin,
    projectQuotePublic,
    requireIdempotencyKey,
    requireQuoteId
};
