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
