const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("storefront module fragment links are classified before DOM href resolution", () => {
    const script = read("../public/storefront/storefront.js");
    const start = script.indexOf("function renderModules()");
    const end = script.indexOf("function categories()", start);

    assert.ok(start >= 0, "renderModules bulunamadı");
    assert.ok(end > start, "renderModules sınırı bulunamadı");

    const renderModules = script.slice(start, end);
    assert.match(renderModules, /const href = key === "orders" && state\.products\.length/);
    assert.match(renderModules, /\? "#catalog-section"/);
    assert.match(renderModules, /action\.href = href;/);
    assert.match(renderModules, /if \(href\.startsWith\("http"\)\)/);
    assert.doesNotMatch(renderModules, /if \(action\.href\.startsWith\("http"\)\)/);
});

test("storefront does not load the temporary module-link normalizer", () => {
    const html = read("../public/storefront/index.html");
    assert.ok(html.includes('/m/storefront.js'), "storefront.js eksik");
    assert.ok(!html.includes('/m/module-links.js'), "geçici module-links.js yüklenmemeli");
});
