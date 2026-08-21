"use strict";

const MAX_ORDER_LINES = 50;
const MAX_ITEM_QUANTITY = 99;
const MAX_ORDER_TOTAL = 100000;

function failure(message, status = 400) {
    return {
        ok: false,
        status,
        message
    };
}

function normalizeProductId(value) {
    if (typeof value !== "string") {
        return null;
    }

    const productId = value.trim();

    if (
        !productId ||
        productId.length > 150 ||
        productId.includes("/") ||
        productId === "." ||
        productId === ".." ||
        /[\u0000-\u001f]/.test(productId)
    ) {
        return null;
    }

    return productId;
}

function normalizeQuantity(value) {
    const quantity = Number(value);

    if (
        !Number.isInteger(quantity) ||
        quantity <= 0 ||
        quantity > MAX_ITEM_QUANTITY
    ) {
        return null;
    }

    return quantity;
}

function normalizeRequestedItems(rawItems) {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return failure("Sipariş sepeti boş.");
    }

    if (rawItems.length > MAX_ORDER_LINES) {
        return failure("Siparişte çok fazla ürün var.");
    }

    const mergedItems = new Map();

    for (const rawItem of rawItems) {
        if (
            !rawItem ||
            typeof rawItem !== "object" ||
            Array.isArray(rawItem)
        ) {
            return failure("Geçersiz ürün bilgisi.");
        }

        const productId = normalizeProductId(rawItem.productId);
        const quantity = normalizeQuantity(rawItem.quantity);

        if (!productId || quantity === null) {
            return failure("Geçersiz ürün bilgisi.");
        }

        const previousQuantity =
            mergedItems.get(productId)?.quantity || 0;

        const mergedQuantity = previousQuantity + quantity;

        if (mergedQuantity > MAX_ITEM_QUANTITY) {
            return failure("Bir üründen en fazla 99 adet eklenebilir.");
        }

        mergedItems.set(productId, {
            productId,
            quantity: mergedQuantity
        });
    }

    return {
        ok: true,
        items: Array.from(mergedItems.values())
    };
}

function getProductName(product) {
    const name = String(
        product?.name ??
        product?.productName ??
        product?.title ??
        ""
    )
        .trim()
        .slice(0, 150);

    return name || null;
}

function getProductPrice(product) {
    const price = Number(
        product?.price ??
        product?.fiyat
    );

    if (!Number.isFinite(price) || price <= 0) {
        return null;
    }

    return Math.round(price * 100) / 100;
}

function isProductAvailable(product) {
    return !(
        product?.active === false ||
        product?.aktif === false ||
        product?.available === false
    );
}

function priceRequestedItems(requestedItems, productsById) {
    const items = [];

    for (const requestedItem of requestedItems) {
        const product = productsById.get(requestedItem.productId);

        if (!product) {
            return failure(
                "Sepetteki bir ürün artık bulunamıyor. Menüyü yenileyip tekrar deneyin.",
                409
            );
        }

        if (!isProductAvailable(product)) {
            return failure(
                "Sepetteki bir ürün şu anda satışta değil. Menüyü yenileyip tekrar deneyin.",
                409
            );
        }

        const name = getProductName(product);
        const price = getProductPrice(product);

        if (!name || price === null) {
            return failure(
                "Sepetteki bir ürünün güncel bilgisi geçersiz. Lütfen işletmeye bildirin.",
                409
            );
        }

        items.push({
            productId: requestedItem.productId,
            name,
            price,
            quantity: requestedItem.quantity
        });
    }

    const total = Math.round(
        items.reduce(
            (sum, item) => sum + item.price * item.quantity,
            0
        ) * 100
    ) / 100;

    if (total <= 0 || total > MAX_ORDER_TOTAL) {
        return failure("Geçersiz sipariş toplamı.");
    }

    return {
        ok: true,
        items,
        total
    };
}

module.exports = {
    normalizeRequestedItems,
    priceRequestedItems
};
