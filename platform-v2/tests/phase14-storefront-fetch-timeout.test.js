const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const storefrontHtml = fs.readFileSync(
    path.join(__dirname, "../public/storefront/index.html"),
    "utf8"
);
const timeoutBridge = fs.readFileSync(
    path.join(__dirname, "../public/storefront/request-timeout.js"),
    "utf8"
);
const storefrontRuntime = fs.readFileSync(
    path.join(__dirname, "../public/storefront/storefront.js"),
    "utf8"
);

function createRuntime({ immediateTimeout = false } = {}) {
    const fetchCalls = [];
    const timeoutCalls = [];
    const clearCalls = [];
    let nextTimerId = 1;

    const window = {
        location: {
            origin: "https://example.com",
            pathname: "/m/ela-doner"
        },
        async fetch(input, init = {}) {
            fetchCalls.push({ input, init });
            if (init.signal?.aborted) {
                const error = new Error("native fetch aborted");
                error.name = "AbortError";
                throw error;
            }
            return { ok: true, status: 200 };
        },
        setTimeout(callback, delay) {
            const id = nextTimerId++;
            timeoutCalls.push({ id, delay });
            if (immediateTimeout) callback();
            return id;
        },
        clearTimeout(id) {
            clearCalls.push(id);
        }
    };

    vm.runInNewContext(timeoutBridge, {
        window,
        URL,
        AbortController,
        Request: globalThis.Request,
        encodeURIComponent,
        decodeURIComponent,
        Error
    });

    return { window, fetchCalls, timeoutCalls, clearCalls };
}

test("timeout bridge loads before every storefront fetch observer", () => {
    const timeout = storefrontHtml.indexOf('/m/request-timeout.js');
    const family = storefrontHtml.indexOf('/m/design-family-bridge.js');
    const media = storefrontHtml.indexOf('/m/media.js');
    const storefront = storefrontHtml.indexOf('/m/storefront.js');

    assert.ok(timeout >= 0, "request timeout bridge must be loaded");
    assert.ok(family > timeout, "design family bridge must wrap the timeout-aware fetch");
    assert.ok(media > family, "media bridge must compose after design family bridge");
    assert.ok(storefront > media, "storefront runtime must initiate fetch after all bridges");
});

test("current tenant storefront request has an 18 second fail-closed timeout", async () => {
    const { window, fetchCalls, timeoutCalls, clearCalls } = createRuntime({ immediateTimeout: true });

    await assert.rejects(
        () => window.fetch("/api/public/storefront/ela-doner", {
            headers: { Accept: "application/json" }
        }),
        /İşletme sayfası zaman aşımına uğradı\. Tekrar deneyin\./
    );

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.signal instanceof AbortSignal, true);
    assert.equal(fetchCalls[0].init.signal.aborted, true);
    assert.deepEqual(timeoutCalls.map(item => item.delay), [18_000]);
    assert.deepEqual(clearCalls, [timeoutCalls[0].id]);
});

test("timeout guard only applies to exact same-origin current tenant storefront request", async () => {
    const { window, fetchCalls, timeoutCalls } = createRuntime();

    await window.fetch("/api/public/storefront/other-tenant");
    await window.fetch("/api/public/storefront/ela-doner?preview=1");
    await window.fetch("https://other.example/api/public/storefront/ela-doner");
    await window.fetch("/health");

    assert.equal(fetchCalls.length, 4);
    assert.equal(timeoutCalls.length, 0);
});

test("existing caller AbortSignal is preserved instead of being replaced", async () => {
    const { window, fetchCalls, timeoutCalls } = createRuntime();
    const controller = new AbortController();

    await window.fetch("/api/public/storefront/ela-doner", { signal: controller.signal });

    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].init.signal, controller.signal);
    assert.equal(timeoutCalls.length, 0);
});

test("timeout bridge keeps retry path and avoids browser persistence sinks", () => {
    assert.match(timeoutBridge, /const STOREFRONT_TIMEOUT_MS = 18_000;/);
    assert.match(timeoutBridge, /new AbortController\(\)/);
    assert.match(timeoutBridge, /window\.clearTimeout\(timer\)/);
    assert.match(timeoutBridge, /url\.origin === window\.location\.origin/);
    assert.match(timeoutBridge, /url\.pathname === expectedStorefrontPath/);
    assert.match(timeoutBridge, /url\.search === ""/);
    assert.match(storefrontRuntime, /el\.retry\.addEventListener\("click", load\)/);
    assert.doesNotMatch(timeoutBridge, /localStorage|sessionStorage|innerHTML\s*=/);
});
