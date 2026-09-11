const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(
    path.join(__dirname, "../public/admin/backup-diagnostic.html"),
    "utf8"
);
const JS = fs.readFileSync(
    path.join(__dirname, "../public/admin/backup-diagnostic.js"),
    "utf8"
);

test("mobile backup diagnostic existing Firebase session ve admin endpoint kullanır", () => {
    assert.match(HTML, /Backup \/ R2 Diagnostic/);
    assert.match(HTML, /backup-diagnostic-tenant-id/);
    assert.match(HTML, /backup-diagnostic-run/);
    assert.match(JS, /firebase\.auth\(\)\.currentUser/);
    assert.match(JS, /Authorization/);
    assert.match(JS, /\/backup-diagnostic/);
    assert.match(JS, /listObjects/);
});

test("mobile diagnostic credential/secret/endpoint/object key göstermez", () => {
    for (const marker of [
        "PLATFORM_BACKUP_R2_ACCESS_KEY_ID",
        "PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY",
        "PLATFORM_BACKUP_KEYS_JSON",
        "Authorization: AWS4-HMAC-SHA256"
    ]) {
        assert.equal(HTML.includes(marker), false, marker);
        assert.equal(JS.includes(marker), false, marker);
    }
    assert.equal(JS.includes("innerHTML"), false);
    assert.match(HTML, /Credential, secret, endpoint veya object key göstermez/);
});
