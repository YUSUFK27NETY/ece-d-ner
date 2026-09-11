const { requireTenantId } = require("../tenant/tenant-id");

const PRODUCT_SCHEMA_VERSION = 1;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PRODUCT_PRICE = 100000;

function fail(label) {
    throw new TypeError(`Catalog product ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownDataValue(record, key) {
    if (!record || typeof record !== "object") {
        return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function assertExactRecord(input, allowedFields, requiredFields, label) {
    if (!isPlainRecord(input)) {
        fail(label);
    }
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== "string" || !allowedFields.includes(key))) {
        fail(label);
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail(label);
        }
    }
    if (requiredFields.some(field => !Object.hasOwn(input, field))) {
        fail(label);
    }
    return input;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        fail("tenantId");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail("tenantId");
    }
    return tenantId;
}

function requireProductId(value) {
    if (typeof value !== "string" || value !== value.trim() ||
        !PRODUCT_ID_PATTERN.test(value) || value === "." || value === "..") {
        fail("productId");
    }
    return value;
}

function requireText(value, label, min, max) {
    if (typeof value !== "string" || value !== value.trim() ||
        value.length < min || value.length > max || /[\u0000-\u001f]/.test(value)) {
        fail(label);
    }
    return value;
}

function optionalText(value, label, max) {
    if (value === undefined || value === null) {
        return "";
    }
    if (typeof value !== "string") {
        fail(label);
    }
    const normalized = value.trim();
    if (normalized.length > max || /[\u0000-\u001f]/.test(normalized)) {
        fail(label);
    }
    return normalized;
}

function requirePrice(value) {
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value <= 0 || value > MAX_PRODUCT_PRICE) {
        fail("price");
    }
    return Math.round(value * 100) / 100;
}

function requireBoolean(value, label) {
    if (typeof value !== "boolean") {
        fail(label);
    }
    return value;
}

function requireIsoTimestamp(value, label) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
        new Date(Date.parse(value)).toISOString() !== value) {
        fail(label);
    }
    return value;
}

function requireNow(now) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        fail("clock");
    }
    return now.toISOString();
}

function normalizeDraft(input) {
    const draft = assertExactRecord(
        input,
        ["name", "category", "price", "description", "available"],
        ["name", "category", "price"],
        "draft"
    );
    return Object.freeze({
        name: requireText(ownDataValue(draft, "name"), "name", 2, 150),
        category: requireText(ownDataValue(draft, "category"), "category", 1, 80),
        price: requirePrice(ownDataValue(draft, "price")),
        description: optionalText(ownDataValue(draft, "description"), "description", 500),
        available: ownDataValue(draft, "available") === undefined
            ? true
            : requireBoolean(ownDataValue(draft, "available"), "available")
    });
}

function createProductRecord({ tenantId, productId, draft, now = new Date() }) {
    const normalizedDraft = normalizeDraft(draft);
    const timestamp = requireNow(now);
    return Object.freeze({
        schemaVersion: PRODUCT_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        productId: requireProductId(productId),
        ...normalizedDraft,
        archived: false,
        createdAt: timestamp,
        updatedAt: timestamp
    });
}

function normalizePersistedProduct({ tenantId, productId, data }) {
    if (!isPlainRecord(data)) {
        fail("stored record");
    }
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeProductId = requireProductId(productId);
    const storedTenantId = ownDataValue(data, "tenantId");
    const storedProductId = ownDataValue(data, "productId");
    if (storedTenantId !== undefined && storedTenantId !== safeTenantId) {
        fail("stored tenantId");
    }
    if (storedProductId !== undefined && storedProductId !== safeProductId) {
        fail("stored productId");
    }
    const schemaVersion = ownDataValue(data, "schemaVersion");
    if (schemaVersion !== undefined && schemaVersion !== PRODUCT_SCHEMA_VERSION) {
        fail("schemaVersion");
    }
    const archivedValue = ownDataValue(data, "archived");
    const availableValue = ownDataValue(data, "available");
    const archived = archivedValue === undefined
        ? false
        : requireBoolean(archivedValue, "archived");
    const available = availableValue === undefined
        ? true
        : requireBoolean(availableValue, "available");
    if (archived && available) {
        fail("archived availability");
    }
    return Object.freeze({
        schemaVersion: PRODUCT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        productId: safeProductId,
        name: requireText(ownDataValue(data, "name"), "name", 2, 150),
        category: requireText(ownDataValue(data, "category"), "category", 1, 80),
        price: requirePrice(ownDataValue(data, "price")),
        description: optionalText(ownDataValue(data, "description"), "description", 500),
        available,
        archived,
        createdAt: requireIsoTimestamp(ownDataValue(data, "createdAt"), "createdAt"),
        updatedAt: requireIsoTimestamp(ownDataValue(data, "updatedAt"), "updatedAt")
    });
}

function applyProductPatch(existing, patch, now = new Date()) {
    const current = normalizePersistedProduct({
        tenantId: existing?.tenantId,
        productId: existing?.productId,
        data: existing
    });
    if (current.archived) {
        const error = new Error("Arşivlenmiş ürün güncellenemez.");
        error.code = "PRODUCT_ARCHIVED";
        throw error;
    }
    const input = assertExactRecord(
        patch,
        ["name", "category", "price", "description", "available"],
        [],
        "patch"
    );
    if (Reflect.ownKeys(input).length === 0) {
        fail("patch");
    }
    const next = {
        ...current,
        updatedAt: requireNow(now)
    };
    if (Object.hasOwn(input, "name")) {
        next.name = requireText(ownDataValue(input, "name"), "name", 2, 150);
    }
    if (Object.hasOwn(input, "category")) {
        next.category = requireText(ownDataValue(input, "category"), "category", 1, 80);
    }
    if (Object.hasOwn(input, "price")) {
        next.price = requirePrice(ownDataValue(input, "price"));
    }
    if (Object.hasOwn(input, "description")) {
        next.description = optionalText(ownDataValue(input, "description"), "description", 500);
    }
    if (Object.hasOwn(input, "available")) {
        next.available = requireBoolean(ownDataValue(input, "available"), "available");
    }
    return Object.freeze(next);
}

function archiveProductRecord(existing, now = new Date()) {
    const current = normalizePersistedProduct({
        tenantId: existing?.tenantId,
        productId: existing?.productId,
        data: existing
    });
    if (current.archived) {
        return current;
    }
    return Object.freeze({
        ...current,
        available: false,
        archived: true,
        updatedAt: requireNow(now)
    });
}

function projectProduct(product) {
    const current = normalizePersistedProduct({
        tenantId: product?.tenantId,
        productId: product?.productId,
        data: product
    });
    return Object.freeze({ ...current });
}

module.exports = {
    PRODUCT_ID_PATTERN,
    PRODUCT_SCHEMA_VERSION,
    applyProductPatch,
    archiveProductRecord,
    createProductRecord,
    normalizePersistedProduct,
    projectProduct,
    requireProductId
};
