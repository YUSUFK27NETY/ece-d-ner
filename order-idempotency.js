"use strict";

const crypto = require("node:crypto");

function normalizeIdempotencyKey(value) {
    if (typeof value !== "string") {
        return null;
    }

    const key = value.trim();

    if (
        key.length < 16 ||
        key.length > 128 ||
        !/^[a-zA-Z0-9._:-]+$/.test(key)
    ) {
        return null;
    }

    return key;
}

function sha256(value) {
    return crypto
        .createHash("sha256")
        .update(value, "utf8")
        .digest("hex");
}

function createIdempotentOrderId(key) {
    const normalizedKey = normalizeIdempotencyKey(key);

    if (!normalizedKey) {
        throw new Error("Geçerli idempotency anahtarı gerekli.");
    }

    return `idem_${sha256(normalizedKey).slice(0, 40)}`;
}

function createRequestHash(details, items) {
    const canonicalItems = [...items]
        .map(item => ({
            productId: item.productId,
            quantity: item.quantity,
            clientPrice:
                item.clientPrice === undefined
                    ? null
                    : item.clientPrice
        }))
        .sort((first, second) =>
            first.productId.localeCompare(second.productId)
        );

    return sha256(JSON.stringify({
        customerName: details.customerName,
        phone: details.phone,
        orderType: details.orderType,
        address: details.address,
        tableNumber: details.tableNumber,
        note: details.note,
        items: canonicalItems
    }));
}

module.exports = {
    normalizeIdempotencyKey,
    createIdempotentOrderId,
    createRequestHash
};
