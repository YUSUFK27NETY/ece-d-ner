"use strict";

const PACKAGE_ORDER = "Paket Sipariş";
const RESTAURANT_ORDER = "Restoranda Sipariş";

const VALID_ORDER_TYPES = new Set([
    PACKAGE_ORDER,
    RESTAURANT_ORDER
]);

function failure(message) {
    return {
        ok: false,
        status: 400,
        message
    };
}

function cleanText(value, maxLength) {
    if (value === undefined || value === null) {
        return "";
    }

    if (typeof value !== "string") {
        return null;
    }

    const text = value.trim();

    if (text.length > maxLength) {
        return null;
    }

    return text;
}

function normalizeTurkishPhone(value) {
    if (typeof value !== "string") {
        return null;
    }

    let digits = value
        .replace(/\D/g, "");

    if (digits.startsWith("00")) {
        digits = digits.slice(2);
    }

    if (/^05\d{9}$/.test(digits)) {
        return `+90${digits.slice(1)}`;
    }

    if (/^5\d{9}$/.test(digits)) {
        return `+90${digits}`;
    }

    if (/^905\d{9}$/.test(digits)) {
        return `+${digits}`;
    }

    return null;
}

function validateOrderRequest(orderData) {
    if (
        !orderData ||
        typeof orderData !== "object" ||
        Array.isArray(orderData)
    ) {
        return failure("Geçersiz sipariş verisi.");
    }

    const customerName =
        cleanText(orderData.customerName, 100);

    if (customerName === null) {
        return failure("Müşteri adı metin olmalıdır.");
    }

    if (customerName.length < 2) {
        return failure("Müşteri adı en az 2 karakter olmalıdır.");
    }

    const phone =
        normalizeTurkishPhone(orderData.phone);

    if (!phone) {
        return failure("Geçerli bir Türkiye cep telefonu numarası girin.");
    }

    const orderType =
        cleanText(orderData.orderType, 50);

    if (orderType === null || !VALID_ORDER_TYPES.has(orderType)) {
        return failure("Geçersiz sipariş türü.");
    }

    const rawAddress =
        cleanText(orderData.address, 500);

    const rawTableNumber =
        cleanText(orderData.tableNumber, 30);

    const note =
        cleanText(orderData.note, 500);

    if (
        rawAddress === null ||
        rawTableNumber === null ||
        note === null
    ) {
        return failure("Adres, masa ve not alanları metin olmalıdır.");
    }

    if (orderType === PACKAGE_ORDER && !rawAddress) {
        return failure("Paket siparişi için adres gerekli.");
    }

    if (orderType === RESTAURANT_ORDER && !rawTableNumber) {
        return failure("Restoran siparişi için masa numarası gerekli.");
    }

    return {
        ok: true,
        details: {
            customerName,
            phone,
            orderType,
            address:
                orderType === PACKAGE_ORDER
                    ? rawAddress
                    : "",
            tableNumber:
                orderType === RESTAURANT_ORDER
                    ? rawTableNumber
                    : "",
            note:
                note
        }
    };
}

module.exports = {
    PACKAGE_ORDER,
    RESTAURANT_ORDER,
    normalizeTurkishPhone,
    validateOrderRequest
};
