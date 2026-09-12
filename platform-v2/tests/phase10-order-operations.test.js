const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ORDER_TYPES,
    normalizeOrderRequest,
    normalizePersistedOrder
} = require("../src/orders/order-model");

function request(orderType, overrides = {}) {
    return {
        customerName: "Test Müşteri",
        phone: "05000000000",
        orderType,
        items: [{ productId: "product-1", quantity: 1 }],
        ...overrides
    };
}

function storedOrder(type, fulfillment = {}) {
    return {
        schemaVersion: 1,
        tenantId: "ela-doner",
        orderId: "idem_1111111111111111111111111111111111111111",
        status: "pending",
        customer: { name: "Test Müşteri", phone: "+905000000000" },
        fulfillment: {
            type,
            address: "",
            tableNumber: "",
            ...fulfillment
        },
        note: "",
        items: [{
            productId: "product-1",
            name: "Döner",
            price: 100,
            quantity: 1,
            lineTotal: 100
        }],
        total: 100,
        requestHash: "a".repeat(64),
        createdAt: "2026-09-12T10:00:00.000Z",
        updatedAt: "2026-09-12T10:00:00.000Z"
    };
}

test("restaurant order modeli masa, paket, gel-al ve teslimatı geriye uyumlu destekler", () => {
    assert.deepEqual(ORDER_TYPES, ["delivery", "dine_in", "takeaway", "pickup"]);

    const delivery = normalizeOrderRequest(request("delivery", { address: "Atatürk Cd. 1" }));
    assert.deepEqual(delivery.fulfillment, {
        type: "delivery",
        address: "Atatürk Cd. 1",
        tableNumber: ""
    });

    const dineIn = normalizeOrderRequest(request("dine_in", { tableNumber: "M12" }));
    assert.deepEqual(dineIn.fulfillment, {
        type: "dine_in",
        address: "",
        tableNumber: "M12"
    });

    for (const type of ["takeaway", "pickup"]) {
        const normalized = normalizeOrderRequest(request(type));
        assert.deepEqual(normalized.fulfillment, {
            type,
            address: "",
            tableNumber: ""
        });
    }
});

test("fulfillment zorunlulukları fail-closed kalır", () => {
    assert.throws(() => normalizeOrderRequest(request("delivery")), TypeError);
    assert.throws(() => normalizeOrderRequest(request("dine_in")), TypeError);
    assert.throws(() => normalizeOrderRequest(request("courier")), TypeError);
});

test("persisted order normalization dört fulfillment tipini aynı schema ile okur", () => {
    const cases = [
        ["delivery", { address: "Atatürk Cd. 1" }],
        ["dine_in", { tableNumber: "M12" }],
        ["takeaway", {}],
        ["pickup", {}]
    ];
    for (const [type, fulfillment] of cases) {
        const order = storedOrder(type, fulfillment);
        const normalized = normalizePersistedOrder({
            tenantId: "ela-doner",
            orderId: order.orderId,
            data: order
        });
        assert.equal(normalized.schemaVersion, 1);
        assert.equal(normalized.fulfillment.type, type);
    }
});

test("owner sipariş operasyon ekranı dört tipi, filtreleri ve detay akışını sunar", () => {
    const ownerHtml = fs.readFileSync(path.join(__dirname, "../public/owner/index.html"), "utf8");
    const html = fs.readFileSync(path.join(__dirname, "../public/owner/orders.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/orders.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../public/owner/orders.css"), "utf8");

    assert.match(ownerHtml, /href="\/owner\/orders\.html"/);
    assert.match(html, /id="status-filter"/);
    assert.match(html, /id="fulfillment-filter"/);
    assert.match(html, /value="dine_in"[^>]*>Masa</);
    assert.match(html, /value="takeaway"[^>]*>Paket</);
    assert.match(html, /value="pickup"[^>]*>Gel-Al</);
    assert.match(html, /value="delivery"[^>]*>Teslimat</);
    assert.match(html, /id="order-modal"/);
    assert.match(script, /dine_in:\s*"Masa"/);
    assert.match(script, /takeaway:\s*"Paket"/);
    assert.match(script, /pickup:\s*"Gel-Al"/);
    assert.match(script, /delivery:\s*"Teslimat"/);
    assert.match(script, /order\.customer\?\.phone/);
    assert.match(script, /order\.fulfillment\?\.address/);
    assert.match(script, /item\.lineTotal/);
    assert.match(script, /\/orders\/\$\{encodeURIComponent\(order\.orderId\)\}\/status/);
    assert.match(css, /detail-grid/);
});

test("order operations frontend token/parola saklamaz ve güvenli DOM projection kullanır", () => {
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/orders.js"), "utf8");

    assert.match(script, /getIdToken\(\)/);
    assert.match(script, /createElement/);
    assert.match(script, /textContent/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage/);
    assert.doesNotMatch(script, /sessionStorage\.setItem\([^\n]*(password|token)/i);
    assert.doesNotMatch(script, /ORDER_TRANSITIONS\[[^\]]+\]\s*=/);
});
