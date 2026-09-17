const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const storefront = fs.readFileSync(
    path.join(__dirname, "../public/storefront/storefront.js"),
    "utf8"
);

test("module contact actions only use WhatsApp when the feature is enabled", () => {
    assert.match(
        storefront,
        /function moduleContactHref\(title\)[\s\S]*state\.tenant\.features\?\.whatsapp === true[\s\S]*whatsappHref\(/[\s\S]*return telHref\(profile\.phone\) \|\| "#contact";/
    );
});

test("cart WhatsApp send path is guarded at runtime, not only by UI visibility", () => {
    assert.match(
        storefront,
        /function sendCartToWhatsApp\(\) \{\s*if \(!canUseWhatsAppCart\(\) \|\| !state\.cart\.size\) return;/
    );
});

test("existing explicit WhatsApp surfaces remain feature gated", () => {
    assert.match(storefront, /if \(wa && tenant\.features\?\.whatsapp\)/);
    assert.match(storefront, /if \(wa && features\.whatsapp\) el\.contactChips\.append/);
    assert.match(
        storefront,
        /state\.tenant\?\.features\?\.orders === true &&\s*state\.tenant\?\.features\?\.whatsapp === true/
    );
});
