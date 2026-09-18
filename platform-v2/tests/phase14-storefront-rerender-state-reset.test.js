"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../public/storefront/storefront.js"),
    "utf8"
);

function createClassList(initial = []) {
    const values = new Set(initial);
    return {
        add(...names) {
            for (const name of names) values.add(name);
        },
        remove(...names) {
            for (const name of names) values.delete(name);
        },
        contains(name) {
            return values.has(name);
        },
        toggle(name, force) {
            if (force === true) {
                values.add(name);
                return true;
            }
            if (force === false) {
                values.delete(name);
                return false;
            }
            if (values.has(name)) {
                values.delete(name);
                return false;
            }
            values.add(name);
            return true;
        }
    };
}

function createElement(initialClasses = []) {
    const listeners = new Map();
    return {
        classList: createClassList(initialClasses),
        textContent: "",
        value: "",
        href: "",
        src: "",
        disabled: false,
        children: [],
        listeners,
        style: {},
        append(...children) {
            this.children.push(...children);
        },
        replaceChildren(...children) {
            this.children = [...children];
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        setAttribute(name, value) {
            this[name] = String(value);
        },
        removeAttribute(name) {
            if (name === "href" || name === "src") this[name] = "";
            else delete this[name];
        },
        focus() {}
    };
}

function tenantPayload(profile, features = {}) {
    return {
        storefront: {
            tenant: {
                tenantId: "demo-tenant",
                displayName: "Demo Tenant",
                sector: "general",
                features,
                profile
            },
            presentation: null,
            products: []
        }
    };
}

function createHarness(payloads) {
    const queue = [...payloads];
    const elements = new Map();
    const customProperties = new Map();
    const metaTheme = {
        content: "#111827",
        setAttribute(name, value) {
            if (name === "content") this.content = String(value);
        }
    };

    const documentElement = {
        dataset: {},
        style: {
            setProperty(name, value) {
                customProperties.set(name, String(value));
            },
            removeProperty(name) {
                customProperties.delete(name);
            }
        }
    };

    const document = {
        title: "",
        documentElement,
        getElementById(id) {
            if (!elements.has(id)) {
                const initialClasses = [
                    "error-view",
                    "storefront",
                    "logo",
                    "header-whatsapp",
                    "module-section",
                    "catalog-section",
                    "address-card",
                    "phone-card",
                    "website-card",
                    "email-card",
                    "cart-bar",
                    "cart-modal"
                ].includes(id) ? ["hidden"] : [];
                elements.set(id, createElement(initialClasses));
            }
            return elements.get(id);
        },
        createElement() {
            return createElement();
        },
        querySelector(selector) {
            return selector === 'meta[name="theme-color"]' ? metaTheme : null;
        }
    };

    const window = {
        location: {
            pathname: "/m/demo-tenant",
            origin: "https://platform.example",
            href: "https://platform.example/m/demo-tenant"
        },
        setTimeout() {},
        open() {}
    };

    async function fetch() {
        const payload = queue.shift();
        if (!payload) throw new Error("Unexpected fetch");
        return {
            ok: true,
            async json() {
                return payload;
            }
        };
    }

    vm.runInNewContext(source, {
        window,
        document,
        fetch,
        navigator: {},
        URL,
        decodeURIComponent,
        encodeURIComponent,
        console
    });

    return {
        elements,
        customProperties,
        metaTheme,
        async flushInitialLoad() {
            await Promise.resolve();
            await new Promise(resolve => setImmediate(resolve));
            await Promise.resolve();
        },
        async retry() {
            const handler = document.getElementById("retry-button").listeners.get("click");
            assert.equal(typeof handler, "function");
            await handler();
        }
    };
}

test("storefront rerender clears stale branding/contact state and rejects unsafe website schemes", async () => {
    const harness = createHarness([
        tenantPayload({
            brandName: "İlk Marka",
            primaryColor: "#123456",
            logoUrl: "https://cdn.example/logo.png",
            whatsapp: "05070000000",
            address: "Eski adres",
            phone: "05070000000",
            website: "example.com",
            email: "old@example.com"
        }, { whatsapp: true }),
        tenantPayload({
            brandName: "Yeni Marka",
            website: "javascript:alert(1)"
        })
    ]);

    await harness.flushInitialLoad();

    const logo = harness.elements.get("logo");
    assert.equal(typeof logo.onload, "function");
    logo.onload();

    assert.equal(logo.classList.contains("hidden"), false);
    assert.equal(harness.elements.get("logo-fallback").classList.contains("hidden"), true);
    assert.equal(harness.customProperties.get("--brand"), "#123456");
    assert.equal(harness.metaTheme.content, "#123456");
    assert.equal(harness.elements.get("website-card").classList.contains("hidden"), false);
    assert.equal(harness.elements.get("website-link").href, "https://example.com/");
    assert.equal(harness.elements.get("header-whatsapp").classList.contains("hidden"), false);

    await harness.retry();

    assert.equal(logo.classList.contains("hidden"), true);
    assert.equal(logo.src, "");
    assert.equal(logo.onload, null);
    assert.equal(logo.onerror, null);
    assert.equal(harness.elements.get("logo-fallback").classList.contains("hidden"), false);

    assert.equal(harness.customProperties.has("--brand"), false);
    assert.equal(harness.metaTheme.content, "#111827");

    assert.equal(harness.elements.get("address-card").classList.contains("hidden"), true);
    assert.equal(harness.elements.get("address-text").textContent, "");
    assert.equal(harness.elements.get("phone-card").classList.contains("hidden"), true);
    assert.equal(harness.elements.get("phone-text").textContent, "");
    assert.equal(harness.elements.get("website-card").classList.contains("hidden"), true);
    assert.equal(harness.elements.get("website-link").href, "");
    assert.equal(harness.elements.get("email-card").classList.contains("hidden"), true);
    assert.equal(harness.elements.get("email-link").textContent, "");
    assert.equal(harness.elements.get("email-link").href, "");

    assert.equal(harness.elements.get("header-whatsapp").classList.contains("hidden"), true);
    assert.equal(harness.elements.get("header-whatsapp").href, "");
});
