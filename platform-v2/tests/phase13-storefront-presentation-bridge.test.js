const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../public/storefront");
const script = fs.readFileSync(path.join(ROOT, "storefront.js"), "utf8");
const styles = fs.readFileSync(path.join(ROOT, "storefront.css"), "utf8");

test("storefront presentation bridge syntax olarak geçerlidir", () => {
    assert.doesNotThrow(() => new Function(script));
});

test("storefront public presentation manifestini güvenli tier fallback ile okur", () => {
    assert.match(script, /const PRESENTATION_TIERS = new Set\(\["starter", "business", "pro"\]\);/);
    assert.match(script, /presentation: null,/);
    assert.match(script, /PRESENTATION_TIERS\.has\(input\.tier\) \? input\.tier : "starter"/);
    assert.match(script, /const source = input\.source === "configured" \? "configured" : "legacy_fallback";/);
    assert.match(script, /applyPresentationBridge\(storefront\.presentation\);/);
});

test("presentation bridge yalnız doğrulanmış tier metadata'sı yayınlar", () => {
    assert.match(
        script,
        /document\.documentElement\.dataset\.presentationTier = state\.presentation\.tier;/
    );
});

test("frontend tier seçimini commercial plandan türetmez", () => {
    assert.doesNotMatch(script, /state\.tenant(?:\?|\.)?\.plan/);
});

test("visual tier override yalnız Business ve Pro için uygulanır; Starter mevcut görünümü korur", () => {
    assert.match(styles, /:root\[data-presentation-tier="business"\]/);
    assert.match(styles, /:root\[data-presentation-tier="pro"\]/);
    assert.doesNotMatch(styles, /data-presentation-tier="starter"/);
    assert.match(styles, /prefers-reduced-motion:no-preference/);
});
