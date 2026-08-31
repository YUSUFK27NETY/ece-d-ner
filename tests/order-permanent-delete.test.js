"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readProjectFile(filename) {
    return fs.readFileSync(
        path.join(__dirname, "..", filename),
        "utf8"
    );
}

function compact(source) {
    return source.replace(/\s+/g, " ");
}

test("kalıcı sipariş silme endpointi limiter ve admin yetkisi ister", () => {
    const serverSource = compact(readProjectFile("server.js"));

    assert.match(
        serverSource,
        /app\.delete\( "\/api\/orders\/:id\/permanent", adminMutationLimiter, requireAdmin,/
    );
    assert.match(
        serverSource,
        /await orderLookup\.doc\.ref\.delete\(\);/
    );
    assert.match(
        serverSource,
        /permanentOrderDelete: true/
    );
});

test("panel arşivlemenin yanına tek onaylı kalıcı silme ekler", () => {
    const adminSource = compact(readProjectFile("admin.html"));
    const archiveButton = adminSource.indexOf("📦 Arşivle");
    const permanentButton = adminSource.indexOf("🗑️ Siparişi Sil");

    assert.notEqual(archiveButton, -1);
    assert.notEqual(permanentButton, -1);
    assert.ok(permanentButton > archiveButton);
    assert.match(
        adminSource,
        /adminBackendCapabilities\.permanentOrderDelete !== true/
    );
    assert.match(
        adminSource,
        /confirm\( "Bu sipariş kalıcı olarak silinsin mi\? Bu işlem geri alınamaz\." \)/
    );
    assert.doesNotMatch(adminSource, /Onaylamak için SİL yazın/);
    assert.match(
        adminSource,
        /encodeURIComponent\(docId\) \+ "\/permanent"/
    );
});
