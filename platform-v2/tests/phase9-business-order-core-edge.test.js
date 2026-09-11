const test = require("node:test");
const assert = require("node:assert/strict");

const { createProductRecord } = require("../src/catalog/product-model");
const {
    createTenantBoundOrderId,
    normalizeOrderRequest,
    priceOrderItems
} = require("../src/orders/order-model");

const NOW = new Date("2026-09-09T18:30:00.000Z");

test("tenant-bound idempotent order identity aynı key için tenantlar arasında ayrıdır", () => {
    const key = "same-idempotency-key-0001";
    const first = createTenantBoundOrderId("first-tenant", key);
    const second = createTenantBoundOrderId("second-tenant", key);
    assert.notEqual(first, second);
    assert.match(first, /^idem_[0-9a-f]{40}$/);
    assert.match(second, /^idem_[0-9a-f]{40}$/);
});

test("archived product customer pricing yolunda fail-closed olur", () => {
    const base = createProductRecord({
        tenantId: "second-tenant",
        productId: "archived-product",
        draft: {
            name: "Archived Test Product",
            category: "Main",
            price: 120,
            available: true
        },
        now: new Date(NOW)
    });
    const archived = Object.freeze({
        ...base,
        available: false,
        archived: true
    });
    const request = normalizeOrderRequest({
        customerName: "Test Customer",
        phone: "05000000000",
        orderType: "dine_in",
        tableNumber: "T1",
        items: [{ productId: "archived-product", quantity: 1 }]
    });

    assert.throws(
        () => priceOrderItems({
            tenantId: "second-tenant",
            requestedItems: request.items,
            productsById: new Map([["archived-product", archived]])
        }),
        error => error?.code === "ORDER_PRODUCT_UNAVAILABLE"
    );
});
