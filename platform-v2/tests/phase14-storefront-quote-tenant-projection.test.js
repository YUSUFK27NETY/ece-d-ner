"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../public/storefront/quote.js"),
    "utf8"
);

function classList(initial = []) {
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
        }
    };
}

function element(initialClasses = []) {
    const listeners = new Map();
    return {
        classList: classList(initialClasses),
        textContent: "",
        className: "",
        value: "",
        href: "",
        disabled: false,
        required: false,
        placeholder: "",
        maxLength: 0,
        min: "",
        max: "",
        step: "",
        type: "",
        dataset: {},
        children: [],
        listeners,
        append(...children) {
            this.children.push(...children);
        },
        addEventListener(type, handler) {
            listeners.set(type, handler);
        },
        querySelectorAll() {
            return [];
        },
        querySelector() {
            return null;
        },
        remove() {}
    };
}

function storefrontPayload(tenantId = "acme-metal", quotes = true) {
    return {
        success: true,
        storefront: {
            tenant: {
                tenantId,
                displayName: "ACME Metal",
                features: { quotes },
                profile: { brandName: "ACME Metal" }
            },
            products: [],
            presentation: null
        }
    };
}

function createHarness(payload) {
    const elements = new Map();
    const disabledControls = [
        { disabled: false },
        { disabled: false },
        { disabled: false }
    ];

    const ids = [
        "quote-form",
        "company-name",
        "country",
        "contact-name",
        "email",
        "phone",
        "note",
        "items",
        "add-item",
        "submit-button",
        "form-message",
        "success-view",
        "quote-code",
        "brand-title",
        "back-link",
        "success-back"
    ];

    for (const id of ids) {
        const initial = id === "success-view" ? ["hidden"] : [];
        elements.set(id, element(initial));
    }
    elements.get("quote-form").querySelectorAll = () => disabledControls;

    const document = {
        getElementById(id) {
            return elements.get(id) || null;
        },
        createElement() {
            return element();
        }
    };

    const window = {
        location: {
            pathname: "/m/acme-metal/quote"
        },
        crypto: {
            randomUUID() {
                return "11111111-1111-4111-8111-111111111111";
            }
        }
    };

    async function fetch(url) {
        assert.equal(url, "/api/public/storefront/acme-metal");
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
        URLSearchParams,
        encodeURIComponent,
        decodeURIComponent,
        Date,
        Math,
        Number,
        String,
        Array,
        Object,
        Set
    });

    return {
        elements,
        disabledControls,
        async flush() {
            await Promise.resolve();
            await new Promise(resolve => setImmediate(resolve));
            await Promise.resolve();
        }
    };
}

test("quote storefront reads quotes and branding from the tenant projection", async () => {
    const harness = createHarness(storefrontPayload());
    await harness.flush();

    assert.equal(
        harness.elements.get("brand-title").textContent,
        "ACME Metal — Teklif Talebi"
    );
    assert.equal(harness.elements.get("form-message").textContent, "");
    assert.equal(harness.disabledControls.some(control => control.disabled), false);
});

test("quote storefront rejects a mismatched tenant payload", async () => {
    const harness = createHarness(storefrontPayload("other-tenant", true));
    await harness.flush();

    assert.equal(
        harness.elements.get("form-message").textContent,
        "Bu işletme teklif talebi kabul etmiyor."
    );
    assert.equal(harness.disabledControls.every(control => control.disabled), true);
});
