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

test("presentation component tokenları normalize edilir ve Starter component fallbackleri korunur", () => {
    assert.match(script, /const PRESENTATION_TOKEN_PATTERN = \/\^\[a-z\]\[a-z-\]\{0,31\}\$\//);
    assert.match(script, /const PRESENTATION_COMPONENT_DEFAULTS = Object\.freeze\(\{/);
    assert.match(script, /navigation: "simple"/);
    assert.match(script, /hero: "compact"/);
    assert.match(script, /offering: "standard"/);
    assert.match(script, /density: "compact"/);
    assert.match(script, /motion: "minimal"/);
    assert.match(script, /typography: "system"/);
    assert.match(script, /function normalizePresentationComponents\(value\)/);
});

test("presentation bridge tier ve component metadata'sını ayrı yayınlar", () => {
    assert.match(script, /dataset\.presentationTier = state\.presentation\.tier;/);
    assert.match(script, /dataset\.presentationNavigation = components\.navigation;/);
    assert.match(script, /dataset\.presentationHero = components\.hero;/);
    assert.match(script, /dataset\.presentationOffering = components\.offering;/);
    assert.match(script, /dataset\.presentationDensity = components\.density;/);
    assert.match(script, /dataset\.presentationMotion = components\.motion;/);
    assert.match(script, /dataset\.presentationTypography = components\.typography;/);
});

test("frontend presentation seçimini commercial plandan türetmez", () => {
    assert.doesNotMatch(script, /state\.tenant(?:\?|\.)?\.plan/);
});

test("görsel katman tier adına değil reusable component varyantlarına bağlıdır", () => {
    assert.match(styles, /data-presentation-hero="featured"/);
    assert.match(styles, /data-presentation-hero="immersive"/);
    assert.match(styles, /data-presentation-offering="advanced"/);
    assert.match(styles, /data-presentation-offering="signature"/);
    assert.match(styles, /data-presentation-density="comfortable"/);
    assert.match(styles, /data-presentation-density="luxury"/);
    assert.match(styles, /data-presentation-motion="functional"/);
    assert.match(styles, /data-presentation-motion="refined"/);
    assert.doesNotMatch(styles, /data-presentation-tier="business"/);
    assert.doesNotMatch(styles, /data-presentation-tier="pro"/);
    assert.doesNotMatch(styles, /data-presentation-tier="starter"/);
    assert.match(styles, /prefers-reduced-motion:no-preference/);
});
