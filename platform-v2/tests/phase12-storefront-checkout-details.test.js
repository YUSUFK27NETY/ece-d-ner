const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("storefront checkout asks for required delivery details and an optional note", () => {
    const html = read("../public/storefront/index.html");

    assert.match(html, /<link rel="stylesheet" href="\/m\/checkout\.css">/);
    assert.match(html, /<input id="customer-name"[^>]*required>/);
    assert.match(html, /<input id="customer-phone"[^>]*required>/);
    assert.match(html, /<textarea id="customer-address"[^>]*required>/);

    const noteTag = html.match(/<textarea id="customer-note"[^>]*>/)?.[0] || "";
    assert.ok(noteTag, "Sipariş notu alanı eksik");
    assert.ok(!/\brequired\b/.test(noteTag), "Sipariş notu zorunlu olmamalı");
});

test("WhatsApp order message includes customer details, cart and optional note", () => {
    const script = read("../public/storefront/storefront.js");
    const start = script.indexOf("function readCheckoutDetails()");
    const end = script.indexOf("async function sharePage()", start);

    assert.ok(start >= 0, "Müşteri bilgisi okuyucusu bulunamadı");
    assert.ok(end > start, "Checkout akışı sınırı bulunamadı");

    const checkoutFlow = script.slice(start, end);
    assert.match(checkoutFlow, /name: el\.customerName\.value\.trim\(\)/);
    assert.match(checkoutFlow, /phone: el\.customerPhone\.value\.trim\(\)/);
    assert.match(checkoutFlow, /address: el\.customerAddress\.value\.trim\(\)/);
    assert.match(checkoutFlow, /note: el\.customerNote\.value\.trim\(\)/);
    assert.match(checkoutFlow, /"🛒 YENİ SİPARİŞ"/);
    assert.match(checkoutFlow, /`👤 İsim: \$\{details\.name\}`/);
    assert.match(checkoutFlow, /`📞 Telefon: \$\{details\.phone\}`/);
    assert.match(checkoutFlow, /`📍 Adres: \$\{details\.address\}`/);
    assert.match(checkoutFlow, /"📦 Sipariş:"/);
    assert.match(checkoutFlow, /`💰 Toplam: \$\{money\(cartSummary\(\)\.total\)\}`/);
    assert.match(checkoutFlow, /if \(details\.note\) lines\.push\(`📝 Not: \$\{details\.note\}`\);/);
    assert.doesNotMatch(checkoutFlow, /Menü:/);
});

test("customer checkout details are not persisted in browser storage", () => {
    const script = read("../public/storefront/storefront.js");
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
});
