"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FEATURE_CATALOG } = require("../src/tenant/feature-catalog");

const source = fs.readFileSync(
    path.join(__dirname, "../public/owner/owner.js"),
    "utf8"
);

function ownerFeatureLabelKeys() {
    const start = source.indexOf("const FEATURE_LABELS = Object.freeze({");
    const end = source.indexOf("\n    });", start);
    assert.ok(start >= 0, "FEATURE_LABELS bulunamadı");
    assert.ok(end > start, "FEATURE_LABELS sınırı bulunamadı");

    const block = source.slice(start, end);
    const keys = [];
    for (const match of block.matchAll(/^\s{8}([a-z][a-z0-9-]*):/gm)) {
        keys.push(match[1]);
    }
    return keys;
}

test("owner dashboard feature labels stay in exact sync with the canonical feature catalog", () => {
    assert.deepEqual(
        ownerFeatureLabelKeys().sort(),
        Object.keys(FEATURE_CATALOG).sort()
    );
});

test("owner dashboard exposes labels for all extended feature modules", () => {
    for (const feature of [
        "crm",
        "delivery",
        "campaigns",
        "loyalty",
        "staff",
        "reviews",
        "analytics"
    ]) {
        assert.match(source, new RegExp(`\\b${feature}:\\s*"`));
    }
});
