const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const storefrontHtml = fs.readFileSync(
    path.join(__dirname, "../public/storefront/index.html"),
    "utf8"
);
const bridge = fs.readFileSync(
    path.join(__dirname, "../public/storefront/cart-accessibility.js"),
    "utf8"
);

class FakeClassList {
    constructor(...values) {
        this.values = new Set(values);
    }
    contains(value) { return this.values.has(value); }
    add(value) { this.values.add(value); }
    remove(value) { this.values.delete(value); }
}

class FakeElement {
    constructor(id, ownerDocument) {
        this.id = id;
        this.ownerDocument = ownerDocument;
        this.classList = new FakeClassList();
        this.listeners = new Map();
        this.attributes = new Map();
        this.hidden = false;
        this.isConnected = true;
        this.focusables = [];
    }
    addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
    }
    emit(type, event = {}) {
        for (const handler of this.listeners.get(type) || []) handler(event);
    }
    click() {
        this.emit("click", { target: this });
    }
    focus() {
        this.ownerDocument.activeElement = this;
    }
    getAttribute(name) {
        return this.attributes.get(name) ?? null;
    }
    querySelectorAll() {
        return this.focusables;
    }
    contains(element) {
        return element === this || this.focusables.includes(element);
    }
}

function createRuntime() {
    const document = {
        activeElement: null,
        listeners: new Map(),
        elements: new Map(),
        getElementById(id) { return this.elements.get(id) || null; },
        addEventListener(type, handler) {
            const handlers = this.listeners.get(type) || [];
            handlers.push(handler);
            this.listeners.set(type, handlers);
        },
        emit(type, event) {
            for (const handler of this.listeners.get(type) || []) handler(event);
        }
    };

    const modal = new FakeElement("cart-modal", document);
    const openButton = new FakeElement("cart-open", document);
    const closeButton = new FakeElement("cart-close", document);
    const nameInput = new FakeElement("customer-name", document);
    const checkoutButton = new FakeElement("cart-whatsapp", document);
    const outside = new FakeElement("outside", document);

    modal.classList.add("hidden");
    modal.focusables = [closeButton, nameInput, checkoutButton];
    for (const element of [modal, openButton, closeButton]) {
        document.elements.set(element.id, element);
    }

    // Existing storefront listeners execute before the accessibility bridge.
    openButton.addEventListener("click", () => modal.classList.remove("hidden"));
    closeButton.addEventListener("click", () => modal.classList.add("hidden"));
    modal.addEventListener("click", event => {
        if (event.target === modal) modal.classList.add("hidden");
    });

    const window = {
        queueMicrotask(callback) { callback(); }
    };

    vm.runInNewContext(bridge, {
        document,
        window,
        HTMLElement: FakeElement
    });

    return { document, modal, openButton, closeButton, nameInput, checkoutButton, outside };
}

function keyEvent(key, { shiftKey = false } = {}) {
    return {
        key,
        shiftKey,
        prevented: false,
        preventDefault() { this.prevented = true; }
    };
}

test("cart accessibility bridge loads after storefront runtime", () => {
    const storefront = storefrontHtml.indexOf('/m/storefront.js');
    const accessibility = storefrontHtml.indexOf('/m/cart-accessibility.js');
    const appointments = storefrontHtml.indexOf('/m/appointments-link.js');

    assert.ok(storefront >= 0, "storefront runtime must be loaded");
    assert.ok(accessibility > storefront, "accessibility bridge must observe storefront listeners after runtime setup");
    assert.ok(appointments > accessibility, "appointments enhancement should remain after cart accessibility setup");
});

test("opening cart moves focus into dialog and Escape restores trigger focus", () => {
    const { document, modal, openButton, closeButton } = createRuntime();

    openButton.focus();
    openButton.click();
    assert.equal(modal.classList.contains("hidden"), false);
    assert.equal(document.activeElement, closeButton);

    const escape = keyEvent("Escape");
    document.emit("keydown", escape);
    assert.equal(escape.prevented, true);
    assert.equal(modal.classList.contains("hidden"), true);
    assert.equal(document.activeElement, openButton);
});

test("Tab and Shift+Tab stay inside the open cart dialog", () => {
    const { document, openButton, closeButton, checkoutButton } = createRuntime();

    openButton.focus();
    openButton.click();

    checkoutButton.focus();
    const forward = keyEvent("Tab");
    document.emit("keydown", forward);
    assert.equal(forward.prevented, true);
    assert.equal(document.activeElement, closeButton);

    closeButton.focus();
    const backward = keyEvent("Tab", { shiftKey: true });
    document.emit("keydown", backward);
    assert.equal(backward.prevented, true);
    assert.equal(document.activeElement, checkoutButton);
});

test("focus cannot escape from dialog and overlay close restores cart trigger", () => {
    const { document, modal, openButton, closeButton, outside } = createRuntime();

    openButton.focus();
    openButton.click();
    outside.focus();
    const tab = keyEvent("Tab");
    document.emit("keydown", tab);
    assert.equal(tab.prevented, true);
    assert.equal(document.activeElement, closeButton);

    modal.emit("click", { target: modal });
    assert.equal(modal.classList.contains("hidden"), true);
    assert.equal(document.activeElement, openButton);
});

test("cart accessibility bridge remains local and persistence-free", () => {
    assert.doesNotThrow(() => new Function(bridge));
    assert.match(bridge, /event\.key === "Escape"/);
    assert.match(bridge, /event\.key !== "Tab"/);
    assert.match(bridge, /closeButton\.focus\(\)/);
    assert.match(bridge, /restoreFocus\.focus\(\)/);
    assert.doesNotMatch(bridge, /fetch\s*\(|localStorage|sessionStorage|innerHTML\s*=/);
});
