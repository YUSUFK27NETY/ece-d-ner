const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const STOREFRONT = path.join(__dirname, "../public/storefront");
const ADMIN = path.join(__dirname, "../public/admin");

const html = fs.readFileSync(path.join(STOREFRONT, "index.html"), "utf8");
const familyCss = fs.readFileSync(path.join(STOREFRONT, "design-families.css"), "utf8");
const familyBridge = fs.readFileSync(path.join(STOREFRONT, "design-family-bridge.js"), "utf8");
const studioHtml = fs.readFileSync(path.join(ADMIN, "presentation-studio.html"), "utf8");
const studioJs = fs.readFileSync(path.join(ADMIN, "presentation-studio.js"), "utf8");

test("storefront design family assets presentation katmanından sonra ve runtime'dan önce yüklenir", () => {
    const presentationCss = html.indexOf('/m/presentation.css');
    const familyCssIndex = html.indexOf('/m/design-families.css');
    const familyBridgeIndex = html.indexOf('/m/design-family-bridge.js');
    const storefrontJs = html.indexOf('/m/storefront.js');

    assert.ok(presentationCss >= 0);
    assert.ok(familyCssIndex > presentationCss);
    assert.ok(familyBridgeIndex > familyCssIndex);
    assert.ok(storefrontJs > familyBridgeIndex);
});

test("altı kontrollü design family vardır; modern mevcut baseline'ı override etmez", () => {
    for (const family of ["warm", "bold", "corporate", "editorial", "minimal"]) {
        assert.match(familyCss, new RegExp(`data-design-family=\\"${family}\\"`));
    }
    assert.doesNotMatch(familyCss, /data-design-family="modern"/);
});

test("design family bridge yalnız same-origin public storefront cevabından family uygular", () => {
    assert.doesNotThrow(() => new Function(familyBridge));
    assert.match(familyBridge, /url\.origin === window\.location\.origin/);
    assert.match(familyBridge, /\/api\\\/public\\\/storefront/);
    assert.match(familyBridge, /response\.clone\(\)\.json\(\)/);
    assert.match(familyBridge, /dataset\.designFamily = family/);
    assert.match(familyBridge, /DEFAULT_FAMILY = "modern"/);
});

test("Presentation Studio admin auth isolation kullanır ve altı family sunar", () => {
    assert.match(studioHtml, /\/admin\/auth-isolation\.js/);
    assert.match(studioHtml, /id="studio-tier"/);
    assert.match(studioHtml, /id="studio-family"/);
    for (const family of ["modern", "warm", "bold", "corporate", "editorial", "minimal"]) {
        assert.match(studioHtml, new RegExp(`value="${family}"`));
    }
    assert.doesNotThrow(() => new Function(studioJs));
});

test("Presentation Studio yalnız presentation patch eder; plan veya feature değiştirmez", () => {
    assert.match(studioJs, /body: JSON\.stringify\(\{ presentation \}\)/);
    assert.doesNotMatch(studioJs, /JSON\.stringify\(\{[^}]*plan:/s);
    assert.doesNotMatch(studioJs, /JSON\.stringify\(\{[^}]*features:/s);
    assert.match(studioJs, /presentation: \{ tier, version: 1, family \}/);
});
