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

test("uuid güvenlik yaması production paketlerini yükseltmeden scoped override kullanır", () => {
    const pkg = readJson("package.json");

    assert.equal(pkg.dependencies["@google-cloud/firestore"], "8.7.1");
    assert.equal(pkg.dependencies["firebase-admin"], "14.3.0");
    assert.equal(pkg.dependencies["express-rate-limit"], "^8.2.1");
    assert.deepEqual(pkg.overrides, {
        gaxios: { uuid: "11.1.1" },
        "teeny-request": { uuid: "11.1.1" }
    });
});

test("lockfile içindeki tüm uuid çözümü patched 11.1.1 sürümündedir", () => {
    const lock = readJson("package-lock.json");
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

test("vulnerable iki transitive hat aynı patched uuid override altında kalır", () => {
    const lock = readJson("package-lock.json");
    const gaxios = lock.packages?.["node_modules/gaxios"];
    const teenyRequest = lock.packages?.["node_modules/teeny-request"];
    const uuid = lock.packages?.["node_modules/uuid"];

    assert.equal(gaxios?.version, "6.7.1");
    assert.equal(gaxios?.dependencies?.uuid, "^9.0.1");
    assert.equal(teenyRequest?.version, "9.0.0");
    assert.equal(teenyRequest?.dependencies?.uuid, "^9.0.0");
    assert.equal(uuid?.version, "11.1.1");
});

test("uuid 11 CommonJS v4 runtime uyumluluğu korunur", () => {
    const { v4 } = require("uuid");
    assert.match(
        v4(),
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
});

test("gaxios ve teeny-request patched uuid override ile yüklenebilir", () => {
    for (const moduleName of ["gaxios", "teeny-request"]) {
        const loaded = require(moduleName);
        assert.ok(loaded);
    }
});
