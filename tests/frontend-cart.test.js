"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadFrontendScript() {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "script.js"),
        "utf8"
    );

    const context = {
        console: {
            log() {},
            error() {}
        },
        firebase: {
            apps: [{}],
            initializeApp() {},
            firestore() {
                return {};
            }
        },
        document: {
            readyState: "loading",
            addEventListener() {},
            createElement() {
                return {
                    className: "",
                    dataset: {},
                    innerHTML: ""
                };
            }
        },
        window: {},
        setTimeout,
        clearTimeout
    };

    vm.createContext(context);
    vm.runInContext(source, context);

    return context;
}

test("ürün kartı Firestore belge kimliğini sepete ekle düğmesine taşır", () => {
    const context = loadFrontendScript();

    vm.runInContext(
        `
            const card = createProductCard(
                { name: "Ayran", price: 30 },
                "product-1"
            );
            globalThis.cardHtml = card.innerHTML;
        `,
        context
    );

    assert.match(
        context.cardHtml,
        /data-product-id="product-1"/
    );
});

test("sepet ürünleri ada göre değil ürün kimliğine göre ayırır", () => {
    const context = loadFrontendScript();

    vm.runInContext(
        `
            addToCart("product-1", "Ayran", 30);
            addToCart("product-1", "Ayran", 30);
            addToCart("product-2", "Ayran", 35);
            globalThis.cartSnapshot = JSON.parse(JSON.stringify(cart));
            globalThis.backendItems = getBackendOrderItems();
        `,
        context
    );

    assert.equal(context.cartSnapshot.length, 2);
    assert.equal(context.cartSnapshot[0].quantity, 2);
    assert.deepEqual(
        JSON.parse(JSON.stringify(context.backendItems)),
        [
            {
                productId: "product-1",
                name: "Ayran",
                price: 30,
                quantity: 2
            },
            {
                productId: "product-2",
                name: "Ayran",
                price: 35,
                quantity: 1
            }
        ]
    );
});

test("restoran durumu doğrulanmadan sipariş düğmesini etkinleştirmez", () => {
    const context = loadFrontendScript();

    vm.runInContext(
        `
            finishOrderBtn = {
                disabled: false,
                style: {}
            };
            cart = [
                {
                    productId: "product-1",
                    name: "Ayran",
                    price: 30,
                    quantity: 1
                }
            ];

            restaurantIsOpen = true;
            restaurantStatusLoaded = false;
            restaurantStatusError = false;
            updateCart();
            globalThis.disabledWhileUnknown = finishOrderBtn.disabled;

            restaurantStatusLoaded = true;
            updateCart();
            globalThis.disabledWhenOpen = finishOrderBtn.disabled;

            restaurantStatusError = true;
            updateCart();
            globalThis.disabledOnStatusError = finishOrderBtn.disabled;
        `,
        context
    );

    assert.equal(context.disabledWhileUnknown, true);
    assert.equal(context.disabledWhenOpen, false);
    assert.equal(context.disabledOnStatusError, true);
});

test("WhatsApp URL'sini güvenli biçimde kodlar", () => {
    const context = loadFrontendScript();

    vm.runInContext(
        `
            globalThis.whatsAppUrl = buildWhatsAppUrl(
                "Ayran & Döner = 120₺"
            );
        `,
        context
    );

    assert.equal(
        context.whatsAppUrl,
        "https://api.whatsapp.com/send?phone=905315006996&text=Ayran%20%26%20D%C3%B6ner%20%3D%20120%E2%82%BA"
    );
});

test("hazırlanan pencere varsa WhatsApp'ı orada, yoksa aynı sekmede açar", () => {
    const context = loadFrontendScript();
    const navigations = [];

    context.preparedWindow = {
        closed: false,
        location: {
            replace(url) {
                navigations.push(["prepared", url]);
            }
        }
    };

    context.window.location = {
        assign(url) {
            navigations.push(["same-tab", url]);
        }
    };

    vm.runInContext(
        `
            openWhatsApp("Birinci", preparedWindow);
            openWhatsApp("İkinci", null);
        `,
        context
    );

    assert.equal(navigations.length, 2);
    assert.equal(navigations[0][0], "prepared");
    assert.equal(navigations[1][0], "same-tab");
});

test("hazırlanan pencere yönlendirilemezse aynı sekmeye geri düşer", () => {
    const context = loadFrontendScript();
    const navigations = [];

    context.brokenWindow = {
        closed: false,
        location: {
            replace() {
                throw new Error("blocked");
            }
        },
        close() {}
    };

    context.window.location = {
        assign(url) {
            navigations.push(url);
        }
    };

    vm.runInContext(
        `
            globalThis.opened = openWhatsApp(
                "Sipariş",
                brokenWindow
            );
        `,
        context
    );

    assert.equal(context.opened, true);
    assert.equal(navigations.length, 1);
});
