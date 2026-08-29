"use strict";

function normalizeOrderIdentifier(value) {
    const identifier = String(value ?? "").trim();

    if (
        !identifier ||
        identifier.length > 150 ||
        identifier.includes("/") ||
        identifier === "." ||
        identifier === ".." ||
        /^__.*__$/.test(identifier) ||
        /[\u0000-\u001f]/.test(identifier)
    ) {
        return null;
    }

    return identifier;
}

function createOrderNumber(firestoreId) {
    const identifier =
        normalizeOrderIdentifier(firestoreId);

    if (!identifier) {
        throw new Error("Geçerli Firestore sipariş kimliği gerekli.");
    }

    const shortIdentifier = identifier
        .replace(/[^a-z0-9]/gi, "")
        .slice(0, 8)
        .toUpperCase();

    if (!shortIdentifier) {
        throw new Error("Sipariş kimliği okunabilir karakter içermiyor.");
    }

    return `ECE-${shortIdentifier}`;
}

module.exports = {
    normalizeOrderIdentifier,
    createOrderNumber
};
