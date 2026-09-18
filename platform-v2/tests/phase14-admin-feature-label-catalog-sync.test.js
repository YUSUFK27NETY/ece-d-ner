"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FEATURE_CATALOG } = require("../src/tenant/feature-catalog");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function featureLabelKeys(source) {
    const start = source.indexOf("const FEATURE_LABELS = Object.freeze({");
    const end = source.indexOf("\n    });", start);
    assert.ok(start >= 0, "FEATURE_LABELS bulunamadı");
    assert.ok(end > start, "FEATURE_LABELS sınırı bulunamadı");

    const block = source.slice(start, end);
    const keys = [];
    for (const match of block.matchAll(/\b([a-z][a-z0-9-]*):\s*"/g)) {
        keys.push(match[1]);
    }
    return [...new Set(keys)];
}

for (const relativePath of [
    "public/admin/quick-setup.js",
    "public/admin/sector-templates.js"
]) {
    test(`${relativePath} feature labels stay in exact sync with canonical catalog`, () => {
        const keys = featureLabelKeys(read(relativePath)).sort();
        assert.deepEqual(keys, Object.keys(FEATURE_CATALOG).sort());
    });
}

test("admin feature labels localize extended modules", () => {
    const combined = [
        read("public/admin/quick-setup.js"),
        read("public/admin/sector-templates.js")
    ].join("\n");

    for (const [feature, label] of Object.entries({
        delivery: "Teslimat",
        campaigns: "Kampanyalar",
        loyalty: "Sadakat",
        staff: "Personel",
        reviews: "Yorumlar",
        analytics: "Analitik"
    })) {
        assert.match(combined, new RegExp(`\\b${feature}:\\s*"${label}"`));
    }
});
