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
const mediaBridge = fs.readFileSync(
    path.join(__dirname, "../public/storefront/media.js"),
    "utf8"
);

test("media bridge is installed before storefront runtime initiates the public fetch", () => {
    const familyBridge = storefrontHtml.indexOf('/m/design-family-bridge.js');
    const media = storefrontHtml.indexOf('/m/media.js');
    const storefront = storefrontHtml.indexOf('/m/storefront.js');

    assert.ok(familyBridge >= 0, "design family bridge must be loaded");
    assert.ok(media > familyBridge, "media bridge must compose after the design family bridge");
    assert.ok(storefront > media, "media bridge must be installed before storefront runtime");
});

test("storefront runtime remains the only initiator of the public storefront request", () => {
    assert.match(
        storefrontRuntime,
        /const endpoint = hostMode/
    );
    assert.match(
        storefrontRuntime,
        /"\/api\/public\/storefront-host"/
    );
    assert.match(
        storefrontRuntime,
        /`\/api\/public\/storefront\/\$\{encodeURIComponent\(state\.tenantId\)\}`/
    );
    assert.match(storefrontRuntime, /const response = await fetch\(endpoint/);
    assert.doesNotMatch(mediaBridge, /\bfetch\s*\(/);
    assert.doesNotMatch(mediaBridge, /async function load\s*\(/);
    assert.match(mediaBridge, /const originalFetch = window\.fetch\.bind\(window\);/);
    assert.match(mediaBridge, /window\.fetch = async \(\.\.\.args\) =>/);
    assert.match(mediaBridge, /response\.clone\(\)\.json\(\)/);
});

test("media response reuse is exact-tenant, same-origin and fail-closed", () => {
    assert.match(mediaBridge, /window\.location\.pathname === "\/"/);
    assert.match(mediaBridge, /"\/api\/public\/storefront-host"/);
    assert.match(
        mediaBridge,
        /url\.origin === window\.location\.origin &&\s*url\.pathname === expectedStorefrontPath &&\s*url\.search === ""/
    );
    assert.match(mediaBridge, /const responseTenantId = storefront\?\.tenant\?\.tenantId/);
    assert.match(mediaBridge, /\(tenantId && responseTenantId !== tenantId\)/);
    assert.match(mediaBridge, /!Array\.isArray\(storefront\.products\)/);
    assert.match(
        mediaBridge,
        /state\.galleryEnabled = storefront\.tenant\?\.features\?\.gallery === true/
    );
});

test("media decoration keeps the existing HTTPS-only and privacy-safe image contract", () => {
    assert.match(mediaBridge, /product\.imageUrl\.startsWith\("https:\/\/"\)/);
    assert.match(mediaBridge, /image\.loading = "lazy";/);
    assert.match(mediaBridge, /image\.decoding = "async";/);
    assert.match(mediaBridge, /image\.referrerPolicy = "no-referrer";/);
    assert.match(mediaBridge, /new MutationObserver\(\(\) => decorate\(\)\)/);
    assert.doesNotMatch(mediaBridge, /innerHTML\s*=/);
    assert.doesNotMatch(mediaBridge, /localStorage/);
});
