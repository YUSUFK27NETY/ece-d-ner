const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");

const CONTACT_STATUSES = Object.freeze(["active", "inactive"]);
const REQUEST_STATUSES = Object.freeze(["new", "in_progress", "converted", "closed"]);
const REQUEST_SOURCES = Object.freeze([
    "manual", "website", "phone", "whatsapp", "instagram", "google",
    "quote", "order", "appointment", "other"
]);
const TASK_STATUSES = Object.freeze(["open", "done", "cancelled"]);
const TASK_PRIORITIES = Object.freeze(["low", "normal", "high"]);

const ID_PATTERNS = Object.freeze({
    contact: /^c_[0-9a-f]{24}$/,
    request: /^r_[0-9a-f]{24}$/,
    task: /^t_[0-9a-f]{24}$/
});

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function assertAllowedKeys(value, allowed, label) {
    if (!isPlainRecord(value)) throw new TypeError(`${label} nesne olmalı.`);
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) throw new TypeError(`${label} bilinmeyen alan içeriyor.`);
    }
}

function text(value, label, { min = 0, max, nullable = false } = {}) {
    if ((value === null || value === undefined || value === "") && nullable) return null;
    const normalized = String(value ?? "").trim();
    if (normalized.length < min || normalized.length > max) throw new TypeError(`${label} geçersiz.`);
    return normalized;
}

function oneOf(value, allowed, label) {
    const normalized = String(value ?? "").trim();
    if (!allowed.includes(normalized)) throw new TypeError(`${label} geçersiz.`);
    return normalized;
}

function optionalEmail(value) {
    const email = text(value, "E-posta", { max: 254, nullable: true });
    if (email === null) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TypeError("E-posta geçersiz.");
    return email.toLowerCase();
}

function optionalPhone(value) {
    const phone = text(value, "Telefon", { max: 32, nullable: true });
    if (phone === null) return null;
    if (!/^[+0-9() .-]{5,32}$/.test(phone)) throw new TypeError("Telefon geçersiz.");
    return phone;
}

function optionalIso(value, label) {
    const raw = text(value, label, { max: 40, nullable: true });
    if (raw === null) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) throw new TypeError(`${label} geçersiz.`);
    return date.toISOString();
}

function optionalMoney(amountValue, currencyValue) {
    const amountMissing = amountValue === null || amountValue === undefined || amountValue === "";
    const currencyMissing = currencyValue === null || currencyValue === undefined || currencyValue === "";
    if (amountMissing && currencyMissing) return { valueMinor: null, currency: null };
    if (amountMissing !== currencyMissing) throw new TypeError("Değer ve para birimi birlikte girilmeli.");
    const valueMinor = Number(amountValue);
    if (!Number.isSafeInteger(valueMinor) || valueMinor < 0 || valueMinor > 100_000_000_000) {
        throw new TypeError("Talep değeri geçersiz.");
    }
    const currency = String(currencyValue).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new TypeError("Para birimi geçersiz.");
    return { valueMinor, currency };
}

function normalizeTags(value) {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 12) throw new TypeError("CRM etiketleri geçersiz.");
    const tags = [];
    for (const item of value) {
        const tag = text(item, "CRM etiketi", { min: 1, max: 40 }).toLowerCase();
        if (!tags.includes(tag)) tags.push(tag);
    }
    return tags;
}

function id(prefix) {
    return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function requireId(value, kind) {
    const normalized = String(value ?? "").trim();
    if (!ID_PATTERNS[kind]?.test(normalized)) throw new TypeError(`CRM ${kind} ID geçersiz.`);
    return normalized;
}

function requireContactId(value) { return requireId(value, "contact"); }
function requireRequestId(value) { return requireId(value, "request"); }
function requireTaskId(value) { return requireId(value, "task"); }

function normalizeContactInput(input, { partial = false } = {}) {
    const allowed = new Set(["name", "company", "email", "phone", "status", "tags", "note"]);
    assertAllowedKeys(input, allowed, "CRM müşteri girdisi");
    const out = {};
    if (!partial || input.name !== undefined) out.name = text(input.name, "Müşteri adı", { min: 2, max: 120 });
    if (!partial || input.company !== undefined) out.company = text(input.company, "Firma", { max: 120, nullable: true });
    if (!partial || input.email !== undefined) out.email = optionalEmail(input.email);
    if (!partial || input.phone !== undefined) out.phone = optionalPhone(input.phone);
    if (!partial || input.status !== undefined) out.status = oneOf(input.status ?? "active", CONTACT_STATUSES, "Müşteri durumu");
    if (!partial || input.tags !== undefined) out.tags = normalizeTags(input.tags);
    if (!partial || input.note !== undefined) out.note = text(input.note, "Müşteri notu", { max: 2000, nullable: true });
    if (!partial && !out.email && !out.phone) throw new TypeError("Müşteri için e-posta veya telefon gerekli.");
    return out;
}

function normalizeRequestInput(input, { partial = false } = {}) {
    const allowed = new Set([
        "contactId", "title", "description", "source", "status",
        "valueMinor", "currency", "dueAt", "note"
    ]);
    assertAllowedKeys(input, allowed, "CRM talep girdisi");
    const out = {};
    if (!partial || input.contactId !== undefined) out.contactId = requireContactId(input.contactId);
    if (!partial || input.title !== undefined) out.title = text(input.title, "Talep başlığı", { min: 2, max: 160 });
    if (!partial || input.description !== undefined) out.description = text(input.description, "Talep açıklaması", { max: 3000, nullable: true });
    if (!partial || input.source !== undefined) out.source = oneOf(input.source ?? "manual", REQUEST_SOURCES, "Talep kaynağı");
    if (!partial || input.status !== undefined) out.status = oneOf(input.status ?? "new", REQUEST_STATUSES, "Talep durumu");
    if (!partial || input.valueMinor !== undefined || input.currency !== undefined) {
        Object.assign(out, optionalMoney(input.valueMinor, input.currency));
    }
    if (!partial || input.dueAt !== undefined) out.dueAt = optionalIso(input.dueAt, "Talep son tarihi");
    if (!partial || input.note !== undefined) out.note = text(input.note, "Talep notu", { max: 2000, nullable: true });
    return out;
}

function normalizeTaskInput(input, { partial = false } = {}) {
    const allowed = new Set([
        "title", "status", "priority", "dueAt", "relatedType", "relatedId",
        "assigneeId", "note"
    ]);
    assertAllowedKeys(input, allowed, "CRM görev girdisi");
    const out = {};
    if (!partial || input.title !== undefined) out.title = text(input.title, "Görev başlığı", { min: 2, max: 160 });
    if (!partial || input.status !== undefined) out.status = oneOf(input.status ?? "open", TASK_STATUSES, "Görev durumu");
    if (!partial || input.priority !== undefined) out.priority = oneOf(input.priority ?? "normal", TASK_PRIORITIES, "Görev önceliği");
    if (!partial || input.dueAt !== undefined) out.dueAt = optionalIso(input.dueAt, "Görev son tarihi");
    if (!partial || input.relatedType !== undefined || input.relatedId !== undefined) {
        const type = text(input.relatedType, "Görev ilişki türü", { max: 20, nullable: true });
        const relatedId = text(input.relatedId, "Görev ilişki ID", { max: 64, nullable: true });
        if ((type === null) !== (relatedId === null)) throw new TypeError("Görev ilişkisi birlikte girilmeli.");
        if (type !== null && !["contact", "request"].includes(type)) throw new TypeError("Görev ilişki türü geçersiz.");
        if (type === "contact") requireContactId(relatedId);
        if (type === "request") requireRequestId(relatedId);
        out.relatedType = type;
        out.relatedId = relatedId;
    }
    if (!partial || input.assigneeId !== undefined) out.assigneeId = text(input.assigneeId, "Görev atanan", { max: 128, nullable: true });
    if (!partial || input.note !== undefined) out.note = text(input.note, "Görev notu", { max: 2000, nullable: true });
    return out;
}

function normalizeStored({ tenantId, entityId, data, kind }) {
    if (!isPlainRecord(data)) throw new TypeError("CRM kayıt verisi geçersiz.");
    const safeTenantId = requireTenantId(tenantId);
    const safeId = requireId(entityId, kind);
    if (data.tenantId !== safeTenantId || data[`${kind}Id`] !== safeId || data.schemaVersion !== 1) {
        throw new TypeError("CRM kayıt kapsamı geçersiz.");
    }
    const createdAt = optionalIso(data.createdAt, "CRM oluşturulma tarihi");
    const updatedAt = optionalIso(data.updatedAt, "CRM güncellenme tarihi");
    if (!createdAt || !updatedAt) throw new TypeError("CRM kayıt tarihi geçersiz.");
    let normalized;
    if (kind === "contact") normalized = normalizeContactInput(data);
    else if (kind === "request") normalized = normalizeRequestInput(data);
    else normalized = normalizeTaskInput(data);
    return Object.freeze({
        schemaVersion: 1,
        tenantId: safeTenantId,
        [`${kind}Id`]: safeId,
        ...normalized,
        ...(kind === "task" ? { completedAt: optionalIso(data.completedAt, "Görev tamamlanma tarihi") } : {}),
        createdAt,
        updatedAt
    });
}

function createRecord({ tenantId, kind, input, now = new Date() }) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("CRM tarihi geçersiz.");
    const entityId = id(kind === "contact" ? "c" : kind === "request" ? "r" : "t");
    let normalized;
    if (kind === "contact") normalized = normalizeContactInput(input);
    else if (kind === "request") normalized = normalizeRequestInput(input);
    else if (kind === "task") normalized = normalizeTaskInput(input);
    else throw new TypeError("CRM kayıt türü geçersiz.");
    const iso = now.toISOString();
    return normalizeStored({
        tenantId,
        entityId,
        kind,
        data: {
            schemaVersion: 1,
            tenantId: requireTenantId(tenantId),
            [`${kind}Id`]: entityId,
            ...normalized,
            ...(kind === "task" ? { completedAt: normalized.status === "done" ? iso : null } : {}),
            createdAt: iso,
            updatedAt: iso
        }
    });
}

function project(record) {
    return Object.freeze({ ...record, tags: record.tags ? Object.freeze([...record.tags]) : record.tags });
}

module.exports = {
    CONTACT_STATUSES,
    REQUEST_STATUSES,
    REQUEST_SOURCES,
    TASK_STATUSES,
    TASK_PRIORITIES,
    createRecord,
    normalizeContactInput,
    normalizeRequestInput,
    normalizeTaskInput,
    normalizeStored,
    project,
    requireContactId,
    requireRequestId,
    requireTaskId
};
