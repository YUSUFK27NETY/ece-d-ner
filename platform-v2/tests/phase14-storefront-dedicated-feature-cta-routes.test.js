"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "../public/storefront/storefront.js"),
    "utf8"
);

test("appointments and quotes use their dedicated public storefront routes", () => {
    const start = source.indexOf("function featureActionHref");
    const end = source.indexOf("function renderBrand", start);
    assert.ok(start >= 0, "featureActionHref bulunamadı");
    assert.ok(end > start, "featureActionHref sınırı bulunamadı");

    const helper = source.slice(start, end);
    assert.match(
        helper,
        /feature === "appointments"[\s\S]*\/m\/\$\{encodeURIComponent\(state\.tenantId\)\}\/appointments/
    );
    assert.match(
        helper,
        /feature === "quotes"[\s\S]*\/m\/\$\{encodeURIComponent\(state\.tenantId\)\}\/quote/
    );
    assert.match(helper, /return moduleContactHref\(title\)/);
});

test("hero CTA uses dedicated routes only for implemented feature flows", () => {
    const start = source.indexOf("function renderHeroActions");
    const end = source.indexOf("function renderModules", start);
    assert.ok(start >= 0, "renderHeroActions bulunamadı");
    assert.ok(end > start, "renderHeroActions sınırı bulunamadı");

    const hero = source.slice(start, end);
    assert.match(
        hero,
        /actionLink\("Randevu İste", featureActionHref\("appointments", "Randevu"\)/
    );
    assert.match(
        hero,
        /actionLink\("Teklif İste", featureActionHref\("quotes", "Teklif"\)/
    );
    assert.match(
        hero,
        /actionLink\("Rezervasyon İste", moduleContactHref\("Rezervasyon"\)/
    );
});

test("module cards share the same dedicated feature action contract", () => {
    const start = source.indexOf("function renderModules");
    const end = source.indexOf("function categories", start);
    assert.ok(start >= 0, "renderModules bulunamadı");
    assert.ok(end > start, "renderModules sınırı bulunamadı");

    const modules = source.slice(start, end);
    assert.match(modules, /key === "orders" && state\.products\.length/);
    assert.match(modules, /\? "#catalog-section"/);
    assert.match(modules, /: featureActionHref\(key, module\.title\)/);
});
