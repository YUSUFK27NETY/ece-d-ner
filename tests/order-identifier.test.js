"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeOrderIdentifier,
    createOrderNumber
} = require("../order-identifier");

test("Firestore kimliğinden okunabilir sipariş numarası üretir", () => {
    assert.equal(
        createOrderNumber("AbCd1234EfGh5678"),
        "ECE-ABCD1234"
    );
});

test("eski sayısal kimlikleri kabul edip geçersiz yolları reddeder", () => {
    assert.equal(
        normalizeOrderIdentifier("1724071234567"),
        "1724071234567"
    );
    assert.equal(normalizeOrderIdentifier("bad/id"), null);
    assert.equal(normalizeOrderIdentifier(".."), null);
    assert.equal(normalizeOrderIdentifier("__bad__"), null);
    assert.throws(
        () => createOrderNumber("--------"),
        /okunabilir/
    );
});
