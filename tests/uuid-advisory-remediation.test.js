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

test("uuid advisory remediation patched CommonJS hattını override eder", () => {
    const pkg = readJson("package.json");
    const lock = readJson("package-lock.json");

    assert.deepEqual(pkg.overrides, { uuid: "11.1.1" });

    const uuidEntries = Object.entries(lock.packages || {})
        .filter(([location]) =>
            location === "node_modules/uuid" || location.endsWith("/node_modules/uuid")
        )
        .map(([location, descriptor]) => ({
            location,
            version: descriptor?.version,
            resolved: descriptor?.resolved,
            integrity: descriptor?.integrity
        }));

    assert.deepEqual(uuidEntries, [{
        location: "node_modules/uuid",
        version: "11.1.1",
        resolved: "https://registry.npmjs.org/uuid/-/uuid-11.1.1.tgz",
        integrity: "sha512-vIYxrBCC/N/K+Js3qSN88go7kIfNPssr/hHCesKCQNAjmgvYS2oqr69kIufEG+O4+PfezOH4EbIeHCfFov8ZgQ=="
    }]);
});

test("firebase-admin dependency group güvenlik güncellemesi korunur", () => {
    const pkg = readJson("package.json");

    assert.equal(pkg.dependencies["@google-cloud/firestore"], "9.1.0");
    assert.equal(pkg.dependencies["firebase-admin"], "14.4.0");
    assert.equal(pkg.dependencies["express-rate-limit"], "^8.7.0");
});
