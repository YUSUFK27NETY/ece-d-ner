const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("storefront loads module link normalization after the renderer", () => {
    const html = read("../public/storefront/index.html");
    const storefrontIndex = html.indexOf('/m/storefront.js');
    const moduleLinksIndex = html.indexOf('/m/module-links.js');

    assert.ok(storefrontIndex >= 0, "storefront.js eksik");
    assert.ok(moduleLinksIndex > storefrontIndex, "module-links.js storefront renderer sonrasında yüklenmeli");
});

test("fragment module links stay in the same tab", () => {
    const script = read("../public/storefront/module-links.js");
    let mutationCallback = null;
    let clickHandler = null;

    const link = {
        nodeType: 1,
        attributes: new Map([
            ["href", "#catalog-section"],
            ["target", "_blank"],
            ["rel", "noopener"]
        ]),
        matches(selector) {
            return selector === 'a[href^="#"]';
        },
        querySelectorAll() {
            return [];
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        },
        closest(selector) {
            return selector === 'a[href^="#"]' ? this : null;
        }
    };

    const card = {
        nodeType: 1,
        matches() {
            return false;
        },
        querySelectorAll(selector) {
            return selector === 'a[href^="#"]' ? [link] : [];
        }
    };

    const moduleGrid = {
        matches() {
            return false;
        },
        querySelectorAll() {
            return [];
        },
        addEventListener(type, handler) {
            if (type === "click") clickHandler = handler;
        },
        contains(node) {
            return node === link;
        }
    };

    class FakeMutationObserver {
        constructor(callback) {
            mutationCallback = callback;
        }
        observe(target, options) {
            assert.equal(target, moduleGrid);
            assert.deepEqual(options, { childList: true, subtree: true });
        }
    }

    vm.runInNewContext(script, {
        document: {
            getElementById(id) {
                return id === "module-grid" ? moduleGrid : null;
            }
        },
        MutationObserver: FakeMutationObserver,
        Node: { ELEMENT_NODE: 1 }
    });

    assert.equal(typeof mutationCallback, "function");
    mutationCallback([{ addedNodes: [card] }]);
    assert.equal(link.attributes.has("target"), false);
    assert.equal(link.attributes.has("rel"), false);

    link.attributes.set("target", "_blank");
    link.attributes.set("rel", "noopener");
    assert.equal(typeof clickHandler, "function");
    clickHandler({ target: link });
    assert.equal(link.attributes.has("target"), false);
    assert.equal(link.attributes.has("rel"), false);
});
