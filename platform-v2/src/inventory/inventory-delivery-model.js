const { requireTenantId } = require("../tenant/tenant-id");
const { requireProductId } = require("../catalog/product-model");

const INVENTORY_SCHEMA_VERSION = 1;
const FULFILLMENT_SCHEMA_VERSION = 1;
const FULFILLMENT_SETTING_ID = "fulfillment";
const MAX_STOCK_QUANTITY = 1_000_000;
const FULFILLMENT_TYPES = Object.freeze(["delivery", "pickup", "takeaway", "dine_in"]);

function fail(label) {
    throw new TypeError(`${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function requireExactRecord(value, keys, label) {
    if (!isPlainRecord(value)) fail(label);
    const actual = Reflect.ownKeys(value);
    if (actual.length !== keys.length ||
        actual.some(key => typeof key !== "string" || !keys.includes(key))) {
        fail(label);
    }
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(label);
    }
    return value;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("Inventory tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("Inventory tenantId");
    return tenantId;
}

function requireIso(value, label) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
        new Date(Date.parse(value)).toISOString() !== value) {
        fail(label);
    }
    return value;
}

function requireQuantity(value, label) {
    if (!Number.isInteger(value) || value < 0 || value > MAX_STOCK_QUANTITY) {
        fail(label);
    }
    return value;
}

function normalizeInventoryInput(input) {
    const value = requireExactRecord(
        input,
        ["trackingEnabled", "quantity", "lowStockThreshold"],
        "Inventory stock input"
    );
    const trackingEnabled = ownValue(value, "trackingEnabled");
    if (typeof trackingEnabled !== "boolean") fail("Inventory trackingEnabled");
    const quantity = requireQuantity(ownValue(value, "quantity"), "Inventory quantity");
    const lowStockThreshold = requireQuantity(
        ownValue(value, "lowStockThreshold"),
        "Inventory lowStockThreshold"
    );
    return Object.freeze({ trackingEnabled, quantity, lowStockThreshold });
}

function createInventoryRecord({ tenantId, productId, input, now }) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeProductId = requireProductId(productId);
    const normalized = normalizeInventoryInput(input);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("Inventory now");
    return Object.freeze({
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        tenantId: safeTenantId,
        productId: safeProductId,
        trackingEnabled: normalized.trackingEnabled,
        quantity: normalized.quantity,
        lowStockThreshold: normalized.lowStockThreshold,
        updatedAt: now.toISOString()
    });
}

function normalizePersistedInventory({ tenantId, productId, data }) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeProductId = requireProductId(productId);
    const value = requireExactRecord(
        data,
        ["schemaVersion", "tenantId", "productId", "trackingEnabled", "quantity", "lowStockThreshold", "updatedAt"],
        "Inventory record"
    );
    if (ownValue(value, "schemaVersion") !== INVENTORY_SCHEMA_VERSION ||
        ownValue(value, "tenantId") !== safeTenantId ||
        ownValue(value, "productId") !== safeProductId ||
        typeof ownValue(value, "trackingEnabled") !== "boolean") {
        fail("Inventory record");
    }
    return Object.freeze({
        schemaVersion: INVENTORY_SCHEMA_VERSION,
        tenantId: safeTenantId,
        productId: safeProductId,
        trackingEnabled: ownValue(value, "trackingEnabled"),
        quantity: requireQuantity(ownValue(value, "quantity"), "Inventory quantity"),
        lowStockThreshold: requireQuantity(
            ownValue(value, "lowStockThreshold"),
            "Inventory lowStockThreshold"
        ),
        updatedAt: requireIso(ownValue(value, "updatedAt"), "Inventory updatedAt")
    });
}

function stockStatus(record) {
    if (!record || record.trackingEnabled !== true) return "untracked";
    if (record.quantity === 0) return "out_of_stock";
    if (record.quantity <= record.lowStockThreshold) return "low_stock";
    return "in_stock";
}

function projectInventory(record, product) {
    const productId = requireProductId(product?.productId);
    if (!product || typeof product.name !== "string") fail("Inventory product");
    if (!record) {
        return Object.freeze({
            productId,
            productName: product.name,
            trackingEnabled: false,
            quantity: 0,
            lowStockThreshold: 0,
            status: "untracked",
            updatedAt: null
        });
    }
    return Object.freeze({
        productId,
        productName: product.name,
        trackingEnabled: record.trackingEnabled,
        quantity: record.quantity,
        lowStockThreshold: record.lowStockThreshold,
        status: stockStatus(record),
        updatedAt: record.updatedAt
    });
}

function defaultFulfillmentConfig(tenantId) {
    return Object.freeze({
        schemaVersion: FULFILLMENT_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        deliveryEnabled: true,
        pickupEnabled: true,
        takeawayEnabled: true,
        dineInEnabled: true,
        updatedAt: null
    });
}

function normalizeFulfillmentInput(input) {
    const value = requireExactRecord(
        input,
        ["deliveryEnabled", "pickupEnabled", "takeawayEnabled", "dineInEnabled"],
        "Fulfillment input"
    );
    const projected = {};
    for (const key of ["deliveryEnabled", "pickupEnabled", "takeawayEnabled", "dineInEnabled"]) {
        const item = ownValue(value, key);
        if (typeof item !== "boolean") fail(`Fulfillment ${key}`);
        projected[key] = item;
    }
    if (!Object.values(projected).some(Boolean)) {
        fail("Fulfillment en az bir kanal");
    }
    return Object.freeze(projected);
}

function createFulfillmentRecord({ tenantId, input, now }) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const normalized = normalizeFulfillmentInput(input);
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("Fulfillment now");
    return Object.freeze({
        schemaVersion: FULFILLMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        ...normalized,
        updatedAt: now.toISOString()
    });
}

function normalizePersistedFulfillment({ tenantId, data }) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const value = requireExactRecord(
        data,
        ["schemaVersion", "tenantId", "deliveryEnabled", "pickupEnabled", "takeawayEnabled", "dineInEnabled", "updatedAt"],
        "Fulfillment record"
    );
    if (ownValue(value, "schemaVersion") !== FULFILLMENT_SCHEMA_VERSION ||
        ownValue(value, "tenantId") !== safeTenantId) {
        fail("Fulfillment record");
    }
    const normalized = normalizeFulfillmentInput({
        deliveryEnabled: ownValue(value, "deliveryEnabled"),
        pickupEnabled: ownValue(value, "pickupEnabled"),
        takeawayEnabled: ownValue(value, "takeawayEnabled"),
        dineInEnabled: ownValue(value, "dineInEnabled")
    });
    return Object.freeze({
        schemaVersion: FULFILLMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        ...normalized,
        updatedAt: requireIso(ownValue(value, "updatedAt"), "Fulfillment updatedAt")
    });
}

function fulfillmentAllows(config, type) {
    if (!FULFILLMENT_TYPES.includes(type)) fail("Fulfillment type");
    const key = {
        delivery: "deliveryEnabled",
        pickup: "pickupEnabled",
        takeaway: "takeawayEnabled",
        dine_in: "dineInEnabled"
    }[type];
    return config?.[key] === true;
}

function projectFulfillment(config) {
    return Object.freeze({
        deliveryEnabled: config.deliveryEnabled === true,
        pickupEnabled: config.pickupEnabled === true,
        takeawayEnabled: config.takeawayEnabled === true,
        dineInEnabled: config.dineInEnabled === true,
        updatedAt: config.updatedAt || null
    });
}

module.exports = {
    FULFILLMENT_SCHEMA_VERSION,
    FULFILLMENT_SETTING_ID,
    FULFILLMENT_TYPES,
    INVENTORY_SCHEMA_VERSION,
    MAX_STOCK_QUANTITY,
    createFulfillmentRecord,
    createInventoryRecord,
    defaultFulfillmentConfig,
    fulfillmentAllows,
    normalizeFulfillmentInput,
    normalizeInventoryInput,
    normalizePersistedFulfillment,
    normalizePersistedInventory,
    projectFulfillment,
    projectInventory,
    stockStatus
};
