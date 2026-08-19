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
    return String(value ?? "")
        .trim()
        .slice(0, maxLength);
}

function normalizeTurkishPhone(value) {
    let digits = String(value ?? "")
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

    if (!VALID_ORDER_TYPES.has(orderType)) {
        return failure("Geçersiz sipariş türü.");
    }

    const rawAddress =
        cleanText(orderData.address, 500);

    const rawTableNumber =
        cleanText(orderData.tableNumber, 30);

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
                cleanText(orderData.note, 500)
        }
    };
}

module.exports = {
    PACKAGE_ORDER,
    RESTAURANT_ORDER,
    normalizeTurkishPhone,
    validateOrderRequest
};
