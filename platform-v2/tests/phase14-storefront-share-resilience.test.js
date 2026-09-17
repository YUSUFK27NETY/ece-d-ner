const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../public/storefront/share-resilience.js"),
    "utf8"
);
const indexSource = fs.readFileSync(
    path.join(__dirname, "../public/storefront/index.html"),
    "utf8"
);

function createHarness({ share, clipboardWrite } = {}) {
    let currentButton = null;
    let clickHandler = null;
    const toastClasses = new Set();
    const toast = {
        textContent: "",
        classList: {
            add(name) { toastClasses.add(name); },
            remove(name) { toastClasses.delete(name); }
        }
    };

    const resilientButton = {
        addEventListener(type, handler) {
            if (type === "click") clickHandler = handler;
        }
    };
    const originalButton = {
        cloneNode() {
            return resilientButton;
        },
        replaceWith(node) {
            currentButton = node;
        }
    };

    const document = {
        title: "Demo | Dijital İşletme",
        getElementById(id) {
            if (id === "share-button") return originalButton;
            if (id === "toast") return toast;
            if (id === "header-brand") return { textContent: "Demo İşletme" };
            return null;
        }
    };

    const navigator = {};
    if (share) navigator.share = share;
    if (clipboardWrite) navigator.clipboard = { writeText: clipboardWrite };

    const window = {
        location: { href: "https://example.test/m/demo-tenant" },
        setTimeout(callback) {
            callback();
            return 1;
        }
    };

    vm.runInNewContext(source, { document, navigator, window });

    return {
        async click() {
            assert.equal(currentButton, resilientButton);
            assert.equal(typeof clickHandler, "function");
            clickHandler();
            await new Promise(resolve => setImmediate(resolve));
        },
        toast,
        toastClasses
    };
}

test("resilient share handler loads after the storefront runtime", () => {
    const storefrontIndex = indexSource.indexOf('/m/storefront.js');
    const shareIndex = indexSource.indexOf('/m/share-resilience.js');
    const cartIndex = indexSource.indexOf('/m/cart-accessibility.js');
    assert.ok(storefrontIndex >= 0);
    assert.ok(shareIndex > storefrontIndex);
    assert.ok(cartIndex > shareIndex);
});

test("native share success does not trigger clipboard fallback", async () => {
    const calls = [];
    const harness = createHarness({
        share: async payload => { calls.push(["share", payload]); },
        clipboardWrite: async value => { calls.push(["clipboard", value]); }
    });

    await harness.click();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], "share");
    assert.equal(calls[0][1].title, "Demo İşletme");
    assert.equal(calls[0][1].url, "https://example.test/m/demo-tenant");
    assert.equal(harness.toast.textContent, "");
});

test("cancelled native share stays silent and does not copy", async () => {
    let clipboardCalls = 0;
    const harness = createHarness({
        share: async () => {
            const error = new Error("cancelled");
            error.name = "AbortError";
            throw error;
        },
        clipboardWrite: async () => { clipboardCalls += 1; }
    });

    await harness.click();
    assert.equal(clipboardCalls, 0);
    assert.equal(harness.toast.textContent, "");
});

test("failed native share falls back to clipboard with visible confirmation", async () => {
    let copied = "";
    const harness = createHarness({
        share: async () => {
            const error = new Error("share unavailable");
            error.name = "NotAllowedError";
            throw error;
        },
        clipboardWrite: async value => { copied = value; }
    });

    await harness.click();
    assert.equal(copied, "https://example.test/m/demo-tenant");
    assert.equal(harness.toast.textContent, "Bağlantı kopyalandı.");
});

test("clipboard failure ends in a visible manual-share fallback", async () => {
    const harness = createHarness({
        clipboardWrite: async () => { throw new Error("clipboard denied"); }
    });

    await harness.click();
    assert.equal(
        harness.toast.textContent,
        "Bağlantıyı adres çubuğundan paylaşabilirsiniz."
    );
});

test("share resilience bridge avoids browser persistence and HTML injection sinks", () => {
    assert.equal(source.includes("localStorage"), false);
    assert.equal(source.includes("sessionStorage"), false);
    assert.equal(source.includes("innerHTML"), false);
    assert.match(source, /cloneNode\(true\)/);
    assert.match(source, /replaceWith\(resilientButton\)/);
});
