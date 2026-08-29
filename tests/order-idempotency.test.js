"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeIdempotencyKey,
    createIdempotentOrderId,
    createRequestHash
} = require("../order-idempotency");

test("geçerli anahtardan kararlı ve Firestore uyumlu kimlik üretir", () => {
    const key = "550e8400-e29b-41d4-a716-446655440000";

    assert.equal(normalizeIdempotencyKey(key), key);
    assert.equal(
        createIdempotentOrderId(key),
        createIdempotentOrderId(key)
    );
    assert.match(
        createIdempotentOrderId(key),
        /^idem_[a-f0-9]{40}$/
    );
});

test("kısa ve başlık için güvensiz anahtarları reddeder", () => {
    assert.equal(normalizeIdempotencyKey("short"), null);
    assert.equal(
        normalizeIdempotencyKey("valid-but-has-a-space inside"),
        null
    );
});

test("aynı siparişi ürün sırası değişse de aynı özetle tanır", () => {
    const details = {
        customerName: "Yusuf Kaya",
        phone: "+905315006996",
        orderType: "Paket Sipariş",
        address: "Adres",
        tableNumber: "",
        note: ""
    };

    const first = createRequestHash(details, [
        { productId: "b", quantity: 1, clientPrice: 30 },
        { productId: "a", quantity: 2, clientPrice: 90 }
    ]);
    const second = createRequestHash(details, [
        { productId: "a", quantity: 2, clientPrice: 90 },
        { productId: "b", quantity: 1, clientPrice: 30 }
    ]);

    assert.equal(first, second);
});
