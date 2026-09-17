const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const storefrontHtml = fs.readFileSync(
    path.join(__dirname, "../public/storefront/index.html"),
    "utf8"
);
const storefrontRuntime = fs.readFileSync(
    path.join(__dirname, "../public/storefront/storefront.js"),
    "utf8"
);

test("module contact fallback resolves to a real contact target", () => {
    assert.match(
        storefrontRuntime,
        /return telHref\(profile\.phone\) \|\| "#contact";/,
        "module actions should retain the contact fallback when no phone/WhatsApp is available"
    );
    assert.equal(
        (storefrontHtml.match(/id="contact"/g) || []).length,
        1,
        "the fallback target must exist exactly once"
    );
    assert.match(
        storefrontHtml,
        /<div id="contact" class="info-grid">[\s\S]*id="address-card"[\s\S]*id="phone-card"[\s\S]*id="website-card"[\s\S]*id="email-card"/,
        "the fallback target must point at the actual business contact information"
    );
});
