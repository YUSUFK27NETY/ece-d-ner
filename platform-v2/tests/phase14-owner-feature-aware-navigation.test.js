"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("owner panel navigation declares exact feature dependencies", () => {
    const html = read("public/owner/panel.html");

    const exact = new Map([
        ["/owner/media.html", "catalog"],
        ["/owner/orders.html", "orders"],
        ["/owner/appointments.html", "appointments"],
        ["/owner/quotes.html", "quotes"],
        ["/owner/crm.html", "crm"]
    ]);

    for (const [href, feature] of exact) {
        assert.match(
            html,
            new RegExp(`href="${href.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"[^>]*data-feature="${feature}"`)
        );
    }

    assert.match(
        html,
        /href="\/owner\/inventory\.html"[^>]*data-feature-any="inventory orders"/
    );
    assert.match(
        html,
        /data-view="products"[^>]*data-feature="catalog"/
    );

    const channels = html.match(/<a class="tab" href="\/owner\/channels\.html"[^>]*>/)?.[0] || "";
    assert.ok(channels);
    assert.doesNotMatch(channels, /data-feature(?:-any)?=/);
});

test("owner panel renders feature-aware navigation and falls back from hidden active view", () => {
    const source = read("public/owner/owner.js");

    assert.match(source, /featureNavigation:\s*\[\.\.\.document\.querySelectorAll\("\[data-feature\], \[data-feature-any\]"\)\]/);
    assert.match(source, /function renderFeatureNavigation\(\)/);
    assert.match(source, /features\[exactFeature\] === true/);
    assert.match(source, /anyFeatures\.some\(feature => features\[feature\] === true\)/);
    assert.match(source, /item\.hidden = !visible/);
    assert.match(source, /if \(activeTab\) setView\("dashboard"\)/);
    assert.match(source, /renderFeatureList\(\);\s*renderFeatureNavigation\(\);/);
});

test("owner reset hides feature-dependent navigation until tenant overview is verified", () => {
    const source = read("public/owner/owner.js");
    assert.match(source, /for \(const item of elements\.featureNavigation\) item\.hidden = true;/);
    assert.match(source, /setView\("dashboard"\);/);
});
