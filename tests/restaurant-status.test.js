"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const response = (isOpen, extra = {}) => ({
    ok: true,
    json: async () => ({ success: true, isOpen, ...extra })
});

function createPage(fetchImplementation) {
    let now = 0;
    let timerId = 0;
    const timers = new Map();
    const requests = [];
    const events = new Map();
    const badge = { textContent: "", style: {} };
    const buttons = {
        restaurantBtn: { disabled: true },
        packageBtn: { disabled: true }
    };
    const addEventListener = (name, handler) => {
        if (!events.has(name)) events.set(name, []);
        events.get(name).push(handler);
    };
    const context = vm.createContext({
        AbortController,
        console: { log() {}, error() {} },
        navigator: { onLine: true },
        document: {
            readyState: "loading",
            visibilityState: "visible",
            querySelector: selector => selector === ".status .open" ? badge : null,
            getElementById: id => buttons[id] || null,
            addEventListener
        },
        window: { addEventListener },
        setTimeout(handler, delay) {
            timers.set(++timerId, { handler, at: now + delay });
            return timerId;
        },
        clearTimeout: id => timers.delete(id),
        fetch(url, options) {
            requests.push({ url, options, at: now });
            return fetchImplementation(url, options, requests.length);
        }
    });
    vm.runInContext(read("restaurant-status.js"), context);

    return {
        context, badge, buttons, requests, timers,
        status: context.window.eceRestaurantStatus,
        event(name, values = {}) {
            for (const handler of events.get(name) || []) handler(values);
        },
        async advance(ms) {
            const until = now + ms;
            await flush();
            for (;;) {
                const next = [...timers.entries()]
                    .filter(([, timer]) => timer.at <= until)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!next) break;
                now = next[1].at;
                timers.delete(next[0]);
                next[1].handler();
                await flush();
            }
            now = until;
            await flush();
        },
        connectCart() {
            context.firebase = { apps: [{}], firestore: () => ({}) };
            vm.runInContext(read("script.js"), context);
            vm.runInContext("subscribeToRestaurantStatus()", context);
        },
        canOrder: () => vm.runInContext("canPlaceOrder()", context)
    };
}

function waitForAbort(signal) {
    return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
            const error = new Error("Request timed out");
            error.name = "AbortError";
            reject(error);
        }, { once: true });
    });
}

test("status works before Firebase/menu scripts and cart reuses the first response", async () => {
    // Execute the deferred scripts in their real HTML order, pausing the SDKs.
    const scripts = [...read("index.html").matchAll(/<script\b[^>]*src="([^"]+)"/g)]
        .map(match => match[1]);
    assert.equal(scripts[0], "restaurant-status.js");
    const page = createPage(async () => response(true, {
        features: { orderIdempotency: true }
    }));
    await flush();
    assert.equal(page.context.firebase, undefined);
    assert.equal(page.badge.textContent, "🟢 Şu Anda Açık");
    page.connectCart();
    assert.equal(page.requests.length, 1);
    assert.equal(page.buttons.restaurantBtn.disabled, false);
    assert.equal(page.canOrder(), true);
    assert.equal(vm.runInContext("orderIdempotencySupported", page.context), true);
});

for (const isOpen of [true, false]) {
    test(`first request fails, then automatically recovers to ${isOpen ? "open" : "closed"}`, async () => {
        const page = createPage(async (url, options, attempt) => {
            if (attempt === 1) throw new TypeError("Network unavailable");
            return response(isOpen);
        });
        page.connectCart();
        await flush();
        assert.equal(page.canOrder(), false);
        assert.match(page.badge.textContent, /Otomatik Deneniyor/);
        await page.advance(1000);
        assert.equal(page.requests.length, 2);
        assert.equal(page.status.getSnapshot().phase, "ready");
        assert.equal(page.canOrder(), isOpen);
        assert.equal(page.buttons.packageBtn.disabled, !isOpen);
        assert.equal(page.badge.textContent, isOpen ? "🟢 Şu Anda Açık" : "🔴 Şu Anda Kapalı");
        assert.equal(page.requests[0].options.cache, "no-store");
    });
}

for (const failure of [
    { name: "HTTP 503", result: { ok: false } },
    { name: "HTML wake-up page", result: { ok: true, json: async () => { throw new SyntaxError("HTML"); } } },
    { name: "missing isOpen", result: response(undefined) },
    { name: "string isOpen", result: response("true") },
    { name: "unsuccessful response", result: response(true, { success: false }) }
]) {
    test(`${failure.name} invalidates an earlier open result and recovers without reloading`, async () => {
        const page = createPage(async (url, options, attempt) => {
            if (attempt === 2) return failure.result;
            return response(attempt === 1);
        });
        page.connectCart();
        await flush();
        assert.equal(page.canOrder(), true);
        await page.advance(120000);
        assert.equal(page.canOrder(), false);
        assert.equal(page.status.getSnapshot().phase, "retrying");
        await page.advance(1000);
        assert.equal(page.status.getSnapshot().phase, "ready");
        assert.equal(page.canOrder(), false);
        assert.equal(page.badge.textContent, "🔴 Şu Anda Kapalı");
    });
}

for (const stall of ["headers", "body"]) {
    test(`18-second deadline includes stalled ${stall}; retry succeeds automatically`, async () => {
        const page = createPage(async (url, { signal }, attempt) => {
            if (attempt > 1) return response(true);
            if (stall === "headers") return waitForAbort(signal);
            return { ok: true, json: () => waitForAbort(signal) };
        });
        page.connectCart();
        await page.advance(17999);
        assert.equal(page.requests[0].options.signal.aborted, false);
        assert.equal(page.canOrder(), false);
        await page.advance(1);
        assert.equal(page.requests[0].options.signal.aborted, true);
        assert.equal(page.status.getSnapshot().phase, "retrying");
        await page.advance(1000);
        assert.equal(page.canOrder(), true);
        assert.equal(page.timers.size, 1);
    });
}

test("a server that needs over a minute recovers without a manual refresh", async () => {
    const page = createPage(async (url, { signal }, attempt) => {
        if (attempt <= 3) return waitForAbort(signal);
        return response(true);
    });
    await page.advance(61999);
    assert.equal(page.status.getSnapshot().phase, "retrying");
    await page.advance(1);
    assert.equal(page.requests.length, 4);
    assert.equal(page.status.getSnapshot().phase, "ready");
    await page.advance(119999);
    assert.equal(page.requests.length, 4);
});

test("repeated failures back off and success resets the retry delay", async () => {
    const page = createPage(async (url, options, attempt) => {
        if (attempt !== 7 && attempt !== 9) throw new TypeError("Offline server");
        return response(true);
    });
    await page.advance(78000);
    assert.deepEqual(page.requests.map(request => request.at), [0, 1000, 3000, 8000, 18000, 48000, 78000]);
    assert.equal(page.status.getSnapshot().phase, "ready");
    assert.equal(page.timers.size, 1);
    await page.advance(120000);
    assert.equal(page.status.getSnapshot().phase, "retrying");
    await page.advance(1000);
    assert.equal(page.status.getSnapshot().phase, "ready");
});

test("visibility/online events cannot create overlapping requests", async () => {
    let finish;
    const page = createPage(() => new Promise(resolve => { finish = resolve; }));
    const pending = page.status.refresh();
    page.status.refresh();
    page.event("visibilitychange");
    page.event("online");
    page.event("pageshow", { persisted: true });
    assert.equal(page.requests.length, 1);
    finish(response(true));
    await pending;
    assert.equal(page.status.getSnapshot().phase, "ready");
    assert.equal(page.timers.size, 1);
});

test("hidden/offline tabs stop retries and reconnect immediately when usable", async () => {
    const page = createPage(async (url, options, attempt) => {
        if (attempt === 1) throw new TypeError("Network unavailable");
        return response(true);
    });
    page.connectCart();
    await flush();
    page.context.document.visibilityState = "hidden";
    page.event("visibilitychange");
    await page.advance(120000);
    assert.equal(page.requests.length, 1);
    page.context.navigator.onLine = false;
    page.event("offline");
    page.context.document.visibilityState = "visible";
    page.event("visibilitychange");
    assert.equal(page.timers.size, 0);
    assert.equal(page.canOrder(), false);
    assert.match(page.badge.textContent, /İnternet Bağlantısı/);
    page.context.navigator.onLine = true;
    page.event("online");
    await flush();
    assert.equal(page.requests.length, 2);
    assert.equal(page.canOrder(), true);
});

test("offline aborts an active request and reconnecting does not leave a stuck request", async () => {
    const page = createPage(async (url, { signal }, attempt) => {
        if (attempt === 1) return waitForAbort(signal);
        return response(false);
    });
    page.context.navigator.onLine = false;
    page.event("offline");
    await flush();
    assert.equal(page.requests[0].options.signal.aborted, true);
    assert.equal(page.timers.size, 0);
    page.context.navigator.onLine = true;
    page.event("online");
    await flush();
    assert.equal(page.status.getSnapshot().phase, "ready");
    assert.equal(page.badge.textContent, "🔴 Şu Anda Kapalı");
});
