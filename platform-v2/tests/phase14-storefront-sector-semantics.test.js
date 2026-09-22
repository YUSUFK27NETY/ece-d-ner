const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SECTOR_PRESENTATION_CATALOG } = require("../src/presentation/sector-presentation-catalog");

const storefrontDir = path.join(__dirname, "../public/storefront");
const bridge = fs.readFileSync(path.join(storefrontDir, "design-family-bridge.js"), "utf8");

const ALLOWED_OFFERING_KINDS = new Set([
    "menu",
    "catalog",
    "services",
    "accommodation",
    "fleet",
    "portfolio",
    "offerings"
]);

test("sector presentation adapterlari storefront offering semantigi icin tam sozlesme tasir", () => {
    for (const [sector, adapter] of Object.entries(SECTOR_PRESENTATION_CATALOG)) {
        assert.equal(adapter.sector, sector);
        assert.ok(ALLOWED_OFFERING_KINDS.has(adapter.offeringKind), `${sector} offeringKind gecersiz`);
        assert.equal(typeof adapter.offeringLabel, "string");
        assert.ok(adapter.offeringLabel.trim().length > 0, `${sector} offeringLabel bos olamaz`);
    }
});

test("presentation bridge katalog semantigini public manifest sector adapterindan alir", () => {
    assert.doesNotThrow(() => new Function(bridge));
    assert.match(bridge, /const storefront = body\?\.storefront/);
    assert.match(bridge, /const responseTenantId = storefront\?\.tenant\?\.tenantId/);
    assert.match(bridge, /\(tenantId && responseTenantId !== tenantId\)/);
    assert.match(bridge, /"\/api\/public\/storefront-host"/);
    assert.match(bridge, /const presentation = storefront\.presentation/);
    assert.match(bridge, /normalizeOffering\(presentation\?\.sector\)/);
    assert.match(bridge, /input\.offeringKind/);
    assert.match(bridge, /input\.offeringLabel/);
    assert.match(bridge, /dataset\.offeringKind = currentOffering\.kind/);
});

test("canonical catalog copy render bittikten sonra guvenli DOM textContent ile uygulanir", () => {
    assert.match(bridge, /new MutationObserver/);
    assert.match(bridge, /attributeFilter: \["class"\]/);
    assert.match(bridge, /section\.classList\.contains\("hidden"\)/);
    assert.match(bridge, /title\.textContent = titleText/);
    assert.match(bridge, /subtitle\.textContent = subtitleText/);
    assert.doesNotMatch(bridge, /innerHTML\s*=/);
});

test("restaurant mevcut katalog copy'sini korurken diger offering turleri generic kalir", () => {
    assert.match(bridge, /case "menu":[\s\S]*"Ürünler & Menü"/);
    assert.match(bridge, /case "services"/);
    assert.match(bridge, /case "catalog"/);
    assert.match(bridge, /case "accommodation"/);
    assert.match(bridge, /case "fleet"/);
    assert.match(bridge, /case "portfolio"/);
});

test("bridge yalnız current-tenant, same-origin ve query'siz storefront cevabını presentation kaynagi yapar", () => {
    assert.match(bridge, /url\.origin === window\.location\.origin/);
    assert.match(bridge, /url\.pathname === expectedStorefrontPath/);
    assert.match(bridge, /url\.search === ""/);
    assert.match(bridge, /response\.clone\(\)\.json\(\)/);
});
