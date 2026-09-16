const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../public/admin");
const html = fs.readFileSync(path.join(ROOT, "quick-setup.html"), "utf8");
const script = fs.readFileSync(path.join(ROOT, "quick-setup.js"), "utf8");

test("quick setup explicit presentation tier alanı sunar", () => {
    assert.match(html, /id="presentation-tier"/);
    assert.match(html, /value="starter"/);
    assert.match(html, /value="business"/);
    assert.match(html, /value="pro"/);
    assert.match(html, /id="presentation-summary"/);
});

test("quick setup script syntax olarak geçerlidir", () => {
    assert.doesNotThrow(() => new Function(script));
});

test("yeni tenant presentation seçimini explicit olarak POST eder", () => {
    assert.match(
        script,
        /JSON\.stringify\(\{ tenantId, displayName, sector: template\.sector, plan, presentation, features, profile: collectProfile\(\) \}\)/
    );
});

test("mevcut tenant presentationı yalnız explicit değişiklikte PATCH eder", () => {
    assert.match(script, /const patch = \{ displayName, plan, features \};/);
    assert.match(script, /if \(state\.presentationDirty\) patch\.presentation = presentation;/);
    assert.match(script, /state\.presentationDirty = Boolean\(state\.tenant\);/);
});

test("legacy tenant güvenli Starter fallback gösterir ama otomatik migration yapmaz", () => {
    assert.match(script, /el\.presentationTier\.value = "starter";/);
    assert.match(script, /renderPresentationSummary\("legacy_fallback"\);/);
    assert.match(script, /state\.presentationDirty = false;/);
});

test("plan yalnız yeni ve elle değiştirilmemiş presentation için öneri uygular", () => {
    assert.match(script, /if \(state\.tenant \|\| state\.presentationTouched\) return false;/);
    assert.match(script, /suggestedPresentationForPlan/);
});
