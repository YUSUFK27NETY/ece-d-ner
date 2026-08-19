"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeRequestedItems,
    priceRequestedItems
} = require("../order-pricing");

test("istemcinin değiştirdiği ad ve fiyat yerine Firestore verisini kullanır", () => {
    const request = normalizeRequestedItems([
        {
            productId: "product-1",
            name: "Sahte ürün",
            price: 1,
            quantity: 2
        }
    ]);

    const result = priceRequestedItems(
        request.items,
        new Map([
            [
                "product-1",
                {
                    name: "Pide Döner",
                    price: 90,
                    available: true
                }
            ]
        ])
    );

    assert.equal(result.ok, true);
    assert.equal(result.total, 180);
    assert.deepEqual(result.items, [
        {
            productId: "product-1",
            name: "Pide Döner",
            price: 90,
            quantity: 2
        }
    ]);
});

test("aynı ürün tekrar gönderilirse miktarları güvenli biçimde birleştirir", () => {
    const result = normalizeRequestedItems([
        { productId: "product-1", quantity: 2 },
        { productId: "product-1", quantity: 3 }
    ]);

    assert.equal(result.ok, true);
    assert.deepEqual(result.items, [
        { productId: "product-1", quantity: 5 }
    ]);
});

test("ürün kimliği veya miktar geçersizse siparişi reddeder", () => {
    const invalidId = normalizeRequestedItems([
        { productId: "bad/id", quantity: 1 }
    ]);

    const fractionalQuantity = normalizeRequestedItems([
        { productId: "product-1", quantity: 1.5 }
    ]);

    assert.equal(invalidId.ok, false);
    assert.equal(fractionalQuantity.ok, false);
});

test("olmayan veya satışa kapalı ürünü reddeder", () => {
    const requestedItems = [
        { productId: "product-1", quantity: 1 }
    ];

    const missing = priceRequestedItems(
        requestedItems,
        new Map()
    );

    const unavailable = priceRequestedItems(
        requestedItems,
        new Map([
            [
                "product-1",
                {
                    name: "Ayran",
                    price: 30,
                    available: false
                }
            ]
        ])
    );

    assert.equal(missing.ok, false);
    assert.equal(missing.status, 409);
    assert.equal(unavailable.ok, false);
    assert.equal(unavailable.status, 409);
});
