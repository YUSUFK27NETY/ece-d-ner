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

    assert.deepEqual(pkg.overrides, { gaxios: { uuid: "11.1.1" } });

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
    assert.equal(pkg.dependencies["express-rate-limit"], "^8.2.1");
});


test("gaxios scoped uuid 11 override lockfile dependency zincirini güvenli sürüme bağlar", () => {
    const lock = readJson("package-lock.json");
    const storage = lock.packages?.["node_modules/@google-cloud/storage"];
    const gaxios = lock.packages?.["node_modules/gaxios"];
    const uuid = lock.packages?.["node_modules/uuid"];

    assert.equal(storage?.version, "8.1.0");
    assert.equal(storage?.dependencies?.gaxios, "^6.0.2");
    assert.equal(gaxios?.version, "6.7.1");
    assert.equal(gaxios?.dependencies?.uuid, "^9.0.1");
    assert.equal(uuid?.version, "11.1.1");
});

test("gaxios runtime kuruluysa scoped uuid 11 multipart v4 kullanımını bozmuyor", async t => {
    let Gaxios;
    let v4;
    try {
        ({ Gaxios } = require("gaxios"));
        ({ v4 } = require("uuid"));
    } catch (error) {
        if (error?.code === "MODULE_NOT_FOUND") {
            t.skip("Optional Google storage/gaxios runtime bu CI kurulumunda yüklü değil.");
            return;
        }
        throw error;
    }

    const directUuid = v4();
    assert.match(
        directUuid,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );

    let prepared = null;
    const client = new Gaxios();
    const response = await client.request({
        url: "https://example.invalid/upload",
        multipart: [{
            headers: { "Content-Type": "text/plain" },
            content: "compatibility-check"
        }],
        adapter: async options => {
            prepared = options;
            return {
                config: options,
                data: { ok: true },
                headers: new Headers(),
                status: 200,
                statusText: "OK",
                request: { responseURL: String(options.url) }
            };
        }
    });

    assert.equal(response.status, 200);
    assert.ok(prepared);
    const contentType = prepared.headers["Content-Type"] ||
        prepared.headers["content-type"];
    assert.match(
        String(contentType),
        /^multipart\/related; boundary=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
});

test("güncellenen Google production client modülleri Node runtime altında yüklenir", () => {
    const firestore = require("@google-cloud/firestore");
    const firebaseApp = require("firebase-admin/app");

    assert.equal(typeof firestore.Firestore, "function");
    assert.equal(typeof firebaseApp.initializeApp, "function");
    assert.equal(typeof firebaseApp.getApps, "function");
});
