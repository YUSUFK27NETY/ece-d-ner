const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
    path.join(__dirname, "../public/storefront/appointments-link.js"),
    "utf8"
);

function createHarness({ catalogHidden = true, contact = "whatsapp" } = {}) {
    let clickHandler = null;
    const assignments = [];
    let fallbackClicks = 0;

    const catalogSection = {
        classList: {
            contains(name) {
                return name === "hidden" && catalogHidden;
            }
        }
    };

    const moduleGrid = {
        addEventListener(type, handler) {
            if (type === "click") clickHandler = handler;
        },
        contains() {
            return true;
        }
    };

    const fallbackLink = contact === "none"
        ? null
        : { click() { fallbackClicks += 1; } };

    const document = {
        getElementById(id) {
            if (id === "module-grid") return moduleGrid;
            if (id === "catalog-section") return catalogSection;
            return null;
        },
        querySelector(selector) {
            if (contact === "whatsapp" && selector.includes("https://wa.me/")) return fallbackLink;
            if (contact === "tel" && selector.includes('href^="tel:"')) return fallbackLink;
            return null;
        }
    };

    const window = {
        location: {
            pathname: "/m/demo-tenant",
            assign(value) {
                assignments.push(value);
            }
        }
    };

    vm.runInNewContext(source, {
        window,
        document,
        decodeURIComponent,
        encodeURIComponent
    });

    function clickModule({ title, hash = "" }) {
        let prevented = false;
        const card = {
            querySelector(selector) {
                return selector === "h3" ? { textContent: title } : null;
            }
        };
        const link = {
            hash,
            closest(selector) {
                return selector === ".module-card" ? card : null;
            }
        };
        const event = {
            target: {
                closest(selector) {
                    return selector === "a" ? link : null;
                }
            },
            preventDefault() {
                prevented = true;
            }
        };
        clickHandler(event);
        return prevented;
    }

    return {
        clickModule,
        assignments,
        get fallbackClicks() {
            return fallbackClicks;
        }
    };
}

test("order module never navigates to a hidden catalog when WhatsApp contact exists", () => {
    const harness = createHarness({ catalogHidden: true, contact: "whatsapp" });
    assert.equal(harness.clickModule({ title: "Sipariş", hash: "#catalog-section" }), true);
    assert.equal(harness.fallbackClicks, 1);
    assert.deepEqual(harness.assignments, []);
});

test("order module falls back to the contact section when no direct contact link exists", () => {
    const harness = createHarness({ catalogHidden: true, contact: "none" });
    assert.equal(harness.clickModule({ title: "Sipariş", hash: "#catalog-section" }), true);
    assert.deepEqual(harness.assignments, ["#contact"]);
});

test("visible catalog keeps the normal order anchor behavior", () => {
    const harness = createHarness({ catalogHidden: false, contact: "whatsapp" });
    assert.equal(harness.clickModule({ title: "Sipariş", hash: "#catalog-section" }), false);
    assert.equal(harness.fallbackClicks, 0);
    assert.deepEqual(harness.assignments, []);
});

test("appointment routing remains unchanged", () => {
    const harness = createHarness();
    assert.equal(harness.clickModule({ title: "Randevu" }), true);
    assert.deepEqual(harness.assignments, ["/m/demo-tenant/appointments"]);
});