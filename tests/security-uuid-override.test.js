"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readJson(relativePath) {
    return JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8")
    );
}

test("transitive uuid security override stays pinned to patched 11.1.1", () => {
    const pkg = readJson("package.json");
    const lock = readJson("package-lock.json");

    assert.equal(pkg.overrides?.uuid, "11.1.1");

    const uuidVersions = Object.entries(lock.packages || {})
        .filter(([location]) => /node_modules\/uuid$/.test(location))
        .map(([, descriptor]) => descriptor?.version)
        .filter(Boolean);

    assert.deepEqual(uuidVersions, ["11.1.1"]);
});

test("fast-xml-parser remains above its patched 5.7.0 line", () => {
    const lock = readJson("package-lock.json");
    const descriptor = lock.packages?.["node_modules/fast-xml-parser"];

    assert.ok(descriptor);
    const [major, minor, patch] = String(descriptor.version)
        .split(".")
        .map(Number);

    assert.ok(
        major > 5 ||
        major === 5 && (minor > 7 || minor === 7 && patch >= 0),
        `fast-xml-parser sürümü güvenli eşik altında: ${descriptor.version}`
    );
});
