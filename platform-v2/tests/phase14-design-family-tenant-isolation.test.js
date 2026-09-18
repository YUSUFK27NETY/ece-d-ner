"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const bridgeSource = fs.readFileSync(
    path.join(__dirname, "../public/storefront/design-family-bridge.js"),
    "utf8"
);

function presentationPayload(designFamily, offeringKind, offeringLabel) {
    return {
        storefront: {
            presentation: {
                designFamily,
                sector: { offeringKind, offeringLabel }
            }
        }
    };
}

function createResponse(payload) {
    return {
        ok: true,
        clone() {
            return {
                async json() {
                    return payload;
                }
            };
        }
    };
}

async function flushAsyncBridge() {
    await Promise.resolve();
    await new Promise(resolve => setImmediate(resolve));
}

test("design family bridge only consumes the current tenant storefront response", async () => {
    const dataset = {};
    const window = {
        location: {
            origin: "https://platform.example",
            pathname: "/m/ela-doner"
        },
        async fetch(input) {
            const raw = String(input);
            if (raw.includes("other-tenant")) {
                return createResponse(presentationPayload("bold", "services", "Başka Tenant"));
            }
            if (raw.includes("preview=1")) {
                return createResponse(presentationPayload("editorial", "portfolio", "Sorgulu Yanıt"));
            }
            if (raw.startsWith("https://other.example")) {
                return createResponse(presentationPayload("minimal", "fleet", "Başka Origin"));
            }
            return createResponse(presentationPayload("warm", "menu", "Menü"));
        }
    };
    const document = {
        documentElement: { dataset },
        getElementById() {
            return null;
        }
    };

    vm.runInNewContext(bridgeSource, {
        window,
        document,
        URL,
        decodeURIComponent,
        encodeURIComponent,
        MutationObserver: undefined,
        Set,
        Object,
        String,
        Array
    });

    assert.equal(dataset.designFamily, "modern");
    assert.equal(dataset.offeringKind, "offerings");

    await window.fetch("/api/public/storefront/other-tenant");
    await flushAsyncBridge();
    assert.equal(dataset.designFamily, "modern");
    assert.equal(dataset.offeringKind, "offerings");

    await window.fetch("/api/public/storefront/ela-doner?preview=1");
    await flushAsyncBridge();
    assert.equal(dataset.designFamily, "modern");
    assert.equal(dataset.offeringKind, "offerings");

    await window.fetch("https://other.example/api/public/storefront/ela-doner");
    await flushAsyncBridge();
    assert.equal(dataset.designFamily, "modern");
    assert.equal(dataset.offeringKind, "offerings");

    await window.fetch("/api/public/storefront/ela-doner");
    await flushAsyncBridge();
    assert.equal(dataset.designFamily, "warm");
    assert.equal(dataset.offeringKind, "menu");
});
