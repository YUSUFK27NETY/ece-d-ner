"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PACKAGE_ORDER,
    RESTAURANT_ORDER,
    normalizeTurkishPhone,
    validateOrderRequest
} = require("../order-request");

test("Türkiye cep telefonu biçimlerini tek biçime dönüştürür", () => {
    assert.equal(
        normalizeTurkishPhone("0531 500 69 96"),
        "+905315006996"
    );
    assert.equal(
        normalizeTurkishPhone("+90 (531) 500 69 96"),
        "+905315006996"
    );
    assert.equal(
        normalizeTurkishPhone("5315006996"),
        "+905315006996"
    );
    assert.equal(
        normalizeTurkishPhone("2125551212"),
        null
    );
});

test("paket siparişinde adresi zorunlu tutar", () => {
    const result = validateOrderRequest({
        customerName: "Yusuf Kaya",
        phone: "05315006996",
        orderType: PACKAGE_ORDER,
        address: ""
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /adres/i);
});

test("restoran siparişinde masa numarasını zorunlu tutar", () => {
    const result = validateOrderRequest({
        customerName: "Yusuf Kaya",
        phone: "05315006996",
        orderType: RESTAURANT_ORDER,
        tableNumber: ""
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /masa/i);
});

test("rastgele sipariş türünü reddeder", () => {
    const result = validateOrderRequest({
        customerName: "Yusuf Kaya",
        phone: "05315006996",
        orderType: "Ücretsiz Sipariş",
        address: "Adres"
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /sipariş türü/i);
});

test("nesne ve dizi biçimindeki metin alanlarını reddeder", () => {
    const invalidName = validateOrderRequest({
        customerName: { value: "Yusuf" },
        phone: "05315006996",
        orderType: PACKAGE_ORDER,
        address: "Adres"
    });

    const invalidNote = validateOrderRequest({
        customerName: "Yusuf Kaya",
        phone: "05315006996",
        orderType: PACKAGE_ORDER,
        address: "Adres",
        note: ["özel", "not"]
    });

    const tooLongNote = validateOrderRequest({
        customerName: "Yusuf Kaya",
        phone: "05315006996",
        orderType: PACKAGE_ORDER,
        address: "Adres",
        note: "x".repeat(501)
    });

    assert.equal(invalidName.ok, false);
    assert.equal(invalidNote.ok, false);
    assert.equal(tooLongNote.ok, false);
});

test("geçerli siparişi temizlenmiş müşteri bilgileriyle döndürür", () => {
    const result = validateOrderRequest({
        customerName: "  Yusuf Kaya  ",
        phone: "0090 531 500 69 96",
        orderType: RESTAURANT_ORDER,
        tableNumber: "  12  ",
        address: "saklanmamalı",
        note: "  Soğansız  "
    });

    assert.equal(result.ok, true);
    assert.deepEqual(result.details, {
        customerName: "Yusuf Kaya",
        phone: "+905315006996",
        orderType: RESTAURANT_ORDER,
        address: "",
        tableNumber: "12",
        note: "Soğansız"
    });
});
