const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");
const { requireProductId } = require("../catalog/product-model");

const ORDER_SCHEMA_VERSION = 1;
const ORDER_TYPES = Object.freeze(["delivery", "dine_in"]);
const ORDER_STATUSES = Object.freeze([
    "pending",
    "preparing",
    "ready",
    "completed",
    "cancelled"
]);
const ORDER_STATUS_TRANSITIONS = Object.freeze({
    pending: Object.freeze(["preparing", "cancelled"]),
    preparing: Object.freeze(["ready", "cancelled"]),
    ready: Object.freeze(["completed", "cancelled"]),
    completed: Object.freeze([]),
    cancelled: Object.freeze([])
});
const MAX_ORDER_LINES = 50;
const MAX_ITEM_QUANTITY = 99;
const MAX_ORDER_TOTAL = 100000;

function fail(label) {
    throw new TypeError(`Order ${label} geçersiz.`);
}

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownDataValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function assertExactRecord(input, allowed, required, label) {
    if (!isPlainRecord(input)) fail(label);
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key))) {
        fail(label);
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(label);
    }
    if (required.some(key => !Object.hasOwn(input, key))) fail(label);
    return input;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireOrderId(value) {
    if (typeof value !== "string" || value !== value.trim() ||
        !/^idem_[0-9a-f]{40}$/.test(value)) {
        fail("orderId");
    }
    return value;
}

function requireText(value, label, min, max) {
    if (typeof value !== "string") fail(label);
    const normalized = value.trim();
    if (normalized.length < min || normalized.length > max ||
        /[\u0000-\u001f]/.test(normalized)) {
        fail(label);
    }
    return normalized;
}

function optionalText(value, label, max) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") fail(label);
    const normalized = value.trim();
    if (normalized.length > max || /[\u0000-\u001f]/.test(normalized)) fail(label);
    return normalized;
}

function normalizeTurkishPhone(value) {
    if (typeof value !== "string") fail("phone");
    let digits = value.replace(/\D/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    if (/^05\d{9}$/.test(digits)) return `+90${digits.slice(1)}`;
    if (/^5\d{9}$/.test(digits)) return `+90${digits}`;
    if (/^905\d{9}$/.test(digits)) return `+${digits}`;
    fail("phone");
}

function normalizeIdempotencyKey(value) {
    if (typeof value !== "string") fail("idempotencyKey");
    const key = value.trim();
    if (key !== value || key.length < 16 || key.length > 128 ||
        !/^[A-Za-z0-9._:-]+$/.test(key)) {
        fail("idempotencyKey");
    }
    return key;
}

function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function createTenantBoundOrderId(tenantId, idempotencyKey) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const key = normalizeIdempotencyKey(idempotencyKey);
    return `idem_${sha256(`${safeTenantId}\u0000${key}`).slice(0, 40)}`;
}

function normalizeRequestedItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_ORDER_LINES) {
        fail("items");
    }
    const seen = new Set();
    return Object.freeze(rawItems.map(raw => {
        const item = assertExactRecord(
            raw,
            ["productId", "quantity", "clientPrice"],
            ["productId", "quantity"],
            "item"
        );
        const productId = requireProductId(ownDataValue(item, "productId"));
        if (seen.has(productId)) fail("duplicate item");
        seen.add(productId);
        const quantity = ownDataValue(item, "quantity");
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) {
            fail("quantity");
        }
        const clientPrice = ownDataValue(item, "clientPrice");
        if (clientPrice !== undefined &&
            (typeof clientPrice !== "number" || !Number.isFinite(clientPrice) ||
                clientPrice <= 0 || clientPrice > MAX_ORDER_TOTAL)) {
            fail("clientPrice");
        }
        return Object.freeze({
            productId,
            quantity,
            ...(clientPrice === undefined
                ? {}
                : { clientPrice: Math.round(clientPrice * 100) / 100 })
        });
    }));
}

function normalizeOrderRequest(input) {
    const request = assertExactRecord(
        input,
        ["customerName", "phone", "orderType", "address", "tableNumber", "note", "items"],
        ["customerName", "phone", "orderType", "items"],
        "request"
    );
    const customerName = requireText(ownDataValue(request, "customerName"), "customerName", 2, 100);
    const phone = normalizeTurkishPhone(ownDataValue(request, "phone"));
    const orderType = ownDataValue(request, "orderType");
    if (!ORDER_TYPES.includes(orderType)) fail("orderType");
    const address = optionalText(ownDataValue(request, "address"), "address", 500);
    const tableNumber = optionalText(ownDataValue(request, "tableNumber"), "tableNumber", 30);
    const note = optionalText(ownDataValue(request, "note"), "note", 500);
    if (orderType === "delivery" && !address) fail("address");
    if (orderType === "dine_in" && !tableNumber) fail("tableNumber");
    const items = normalizeRequestedItems(ownDataValue(request, "items"));
    return Object.freeze({
        customer: Object.freeze({ name: customerName, phone }),
        fulfillment: Object.freeze({
            type: orderType,
            address: orderType === "delivery" ? address : "",
            tableNumber: orderType === "dine_in" ? tableNumber : ""
        }),
        note,
        items
    });
}

function createCanonicalRequestHash(normalizedRequest) {
    if (!normalizedRequest || typeof normalizedRequest !== "object") fail("normalized request");
    const canonicalItems = [...normalizedRequest.items]
        .map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            clientPrice: item.clientPrice === undefined ? null : item.clientPrice
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
    return sha256(JSON.stringify({
        customer: normalizedRequest.customer,
        fulfillment: normalizedRequest.fulfillment,
        note: normalizedRequest.note,
        items: canonicalItems
    }));
}

function requireProductForPricing(product, expectedTenantId, expectedProductId) {
    if (!product || typeof product !== "object" || Array.isArray(product) ||
        product.tenantId !== expectedTenantId || product.productId !== expectedProductId ||
        product.archived === true || product.available !== true) {
        throw safeError("ORDER_PRODUCT_UNAVAILABLE", "Siparişteki ürün kullanılamıyor.");
    }
    if (typeof product.name !== "string" || product.name.trim().length < 2 ||
        typeof product.price !== "number" || !Number.isFinite(product.price) ||
        product.price <= 0 || product.price > MAX_ORDER_TOTAL) {
        throw safeError("ORDER_PRODUCT_INVALID", "Siparişteki ürün doğrulanamadı.");
    }
    return product;
}

function priceOrderItems({ tenantId, requestedItems, productsById }) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    if (!(productsById instanceof Map)) fail("productsById");
    const items = [];
    let total = 0;
    for (const requestItem of requestedItems) {
        const product = requireProductForPricing(
            productsById.get(requestItem.productId),
            safeTenantId,
            requestItem.productId
        );
        const price = Math.round(product.price * 100) / 100;
        if (requestItem.clientPrice !== undefined && requestItem.clientPrice !== price) {
            throw safeError("ORDER_PRICE_CHANGED", "Ürün fiyatı değişti.");
        }
        const lineTotal = Math.round(price * requestItem.quantity * 100) / 100;
        total = Math.round((total + lineTotal) * 100) / 100;
        items.push(Object.freeze({
            productId: requestItem.productId,
            name: product.name.trim().slice(0, 150),
            price,
            quantity: requestItem.quantity,
            lineTotal
        }));
    }
    if (total <= 0 || total > MAX_ORDER_TOTAL) {
        throw safeError("ORDER_TOTAL_INVALID", "Sipariş toplamı geçersiz.");
    }
    return Object.freeze({ items: Object.freeze(items), total });
}

function requireIsoTimestamp(value, label) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
        new Date(Date.parse(value)).toISOString() !== value) fail(label);
    return value;
}

function requireHash(value, label) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) fail(label);
    return value;
}

function requireStatus(value) {
    if (typeof value !== "string" || !ORDER_STATUSES.includes(value)) fail("status");
    return value;
}

function requireMoney(value, label) {
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < 0 || value > MAX_ORDER_TOTAL) fail(label);
    return Math.round(value * 100) / 100;
}

function normalizeStoredItem(item) {
    const value = assertExactRecord(
        item,
        ["productId", "name", "price", "quantity", "lineTotal"],
        ["productId", "name", "price", "quantity", "lineTotal"],
        "stored item"
    );
    const quantity = ownDataValue(value, "quantity");
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ITEM_QUANTITY) fail("stored quantity");
    return Object.freeze({
        productId: requireProductId(ownDataValue(value, "productId")),
        name: requireText(ownDataValue(value, "name"), "stored item name", 2, 150),
        price: requireMoney(ownDataValue(value, "price"), "stored item price"),
        quantity,
        lineTotal: requireMoney(ownDataValue(value, "lineTotal"), "stored lineTotal")
    });
}

function normalizePersistedOrder({ tenantId, orderId, data }) {
    if (!isPlainRecord(data)) fail("stored record");
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeOrderId = requireOrderId(orderId);
    if (ownDataValue(data, "tenantId") !== undefined && ownDataValue(data, "tenantId") !== safeTenantId) {
        fail("stored tenantId");
    }
    if (ownDataValue(data, "orderId") !== undefined && ownDataValue(data, "orderId") !== safeOrderId) {
        fail("stored orderId");
    }
    if (ownDataValue(data, "schemaVersion") !== undefined && ownDataValue(data, "schemaVersion") !== ORDER_SCHEMA_VERSION) {
        fail("schemaVersion");
    }
    const customer = assertExactRecord(
        ownDataValue(data, "customer"),
        ["name", "phone"],
        ["name", "phone"],
        "stored customer"
    );
    const fulfillment = assertExactRecord(
        ownDataValue(data, "fulfillment"),
        ["type", "address", "tableNumber"],
        ["type", "address", "tableNumber"],
        "stored fulfillment"
    );
    const type = ownDataValue(fulfillment, "type");
    if (!ORDER_TYPES.includes(type)) fail("stored fulfillment type");
    const rawItems = ownDataValue(data, "items");
    if (!Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > MAX_ORDER_LINES) fail("stored items");
    const items = Object.freeze(rawItems.map(normalizeStoredItem));
    const total = requireMoney(ownDataValue(data, "total"), "stored total");
    const computed = Math.round(items.reduce((sum, item) => sum + item.lineTotal, 0) * 100) / 100;
    if (computed !== total) fail("stored total");
    return Object.freeze({
        schemaVersion: ORDER_SCHEMA_VERSION,
        tenantId: safeTenantId,
        orderId: safeOrderId,
        status: requireStatus(ownDataValue(data, "status")),
        customer: Object.freeze({
            name: requireText(ownDataValue(customer, "name"), "stored customer name", 2, 100),
            phone: normalizeTurkishPhone(ownDataValue(customer, "phone"))
        }),
        fulfillment: Object.freeze({
            type,
            address: optionalText(ownDataValue(fulfillment, "address"), "stored address", 500),
            tableNumber: optionalText(ownDataValue(fulfillment, "tableNumber"), "stored tableNumber", 30)
        }),
        note: optionalText(ownDataValue(data, "note"), "stored note", 500),
        items,
        total,
        requestHash: requireHash(ownDataValue(data, "requestHash"), "requestHash"),
        createdAt: requireIsoTimestamp(ownDataValue(data, "createdAt"), "createdAt"),
        updatedAt: requireIsoTimestamp(ownDataValue(data, "updatedAt"), "updatedAt")
    });
}

function createOrderRecord({
    tenantId,
    orderId,
    requestHash,
    normalizedRequest,
    priced,
    now = new Date()
}) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("clock");
    if (!priced || !Array.isArray(priced.items)) fail("priced items");
    const record = {
        schemaVersion: ORDER_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        orderId: requireOrderId(orderId),
        status: "pending",
        customer: normalizedRequest.customer,
        fulfillment: normalizedRequest.fulfillment,
        note: normalizedRequest.note,
        items: priced.items,
        total: priced.total,
        requestHash: requireHash(requestHash, "requestHash"),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
    };
    return normalizePersistedOrder({ tenantId: record.tenantId, orderId: record.orderId, data: record });
}

function applyOrderStatus(existing, nextStatus, now = new Date()) {
    const current = normalizePersistedOrder({
        tenantId: existing?.tenantId,
        orderId: existing?.orderId,
        data: existing
    });
    const target = requireStatus(nextStatus);
    if (target === current.status) return current;
    if (!ORDER_STATUS_TRANSITIONS[current.status].includes(target)) {
        throw safeError("ORDER_STATUS_INVALID_TRANSITION", "Sipariş durum geçişi geçersiz.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("clock");
    return Object.freeze({ ...current, status: target, updatedAt: now.toISOString() });
}

function projectCustomerOrder(order) {
    const current = normalizePersistedOrder({
        tenantId: order?.tenantId,
        orderId: order?.orderId,
        data: order
    });
    return Object.freeze({
        schemaVersion: current.schemaVersion,
        tenantId: current.tenantId,
        orderId: current.orderId,
        status: current.status,
        fulfillmentType: current.fulfillment.type,
        items: current.items,
        total: current.total,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt
    });
}

function projectAdminOrder(order) {
    const current = normalizePersistedOrder({
        tenantId: order?.tenantId,
        orderId: order?.orderId,
        data: order
    });
    return Object.freeze({
        schemaVersion: current.schemaVersion,
        tenantId: current.tenantId,
        orderId: current.orderId,
        status: current.status,
        customer: current.customer,
        fulfillment: current.fulfillment,
        note: current.note,
        items: current.items,
        total: current.total,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt
    });
}

module.exports = {
    MAX_ORDER_LINES,
    MAX_ORDER_TOTAL,
    ORDER_SCHEMA_VERSION,
    ORDER_STATUSES,
    ORDER_STATUS_TRANSITIONS,
    ORDER_TYPES,
    applyOrderStatus,
    createCanonicalRequestHash,
    createOrderRecord,
    createTenantBoundOrderId,
    normalizeIdempotencyKey,
    normalizeOrderRequest,
    normalizePersistedOrder,
    normalizeTurkishPhone,
    priceOrderItems,
    projectAdminOrder,
    projectCustomerOrder,
    requireOrderId
};
