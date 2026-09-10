const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminDir = path.join(__dirname, "../public/admin");
const html = fs.readFileSync(path.join(adminDir, "bootstrap-owner.html"), "utf8");
const client = fs.readFileSync(path.join(adminDir, "bootstrap-owner.js"), "utf8");

test("mobile initial-owner bootstrap page uses self-hosted client script and existing Firebase session", () => {
    assert.match(html, /id="bootstrap-owner-form"/);
    assert.match(html, /id="bootstrap-tenant-id"/);
    assert.match(html, /id="bootstrap-firebase-uid"/);
    assert.match(html, /src="\/admin\/config\.js"/);
    assert.match(html, /src="\/admin\/bootstrap-owner\.js"/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);

    assert.match(client, /firebase\.auth\(\)\.onAuthStateChanged/);
    assert.match(client, /user\.getIdToken\(\)/);
    assert.match(client, /headers\.set\("Authorization", `Bearer \$\{token\}`\)/);
});

test("mobile initial-owner bootstrap sends only Firebase UID to the controlled endpoint", () => {
    assert.match(
        client,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenantId\)\}\/admin-bootstrap\/initial-owner/
    );
    assert.match(client, /body: JSON\.stringify\(\{ firebaseUid \}\)/);
    assert.match(client, /firebaseUidInput\.value = ""/);
    assert.doesNotMatch(client, /localStorage|sessionStorage|console\./);
    assert.doesNotMatch(client, /JSON\.stringify\(\{[^}]*role\s*:/s);
});

test("mobile initial-owner bootstrap verifies safe response and refreshes readiness", () => {
    assert.match(client, /result\?\.role !== "tenant_owner"/);
    assert.match(client, /result\?\.state !== "active"/);
    assert.match(client, /result\?\.adminBootstrap !== "verified"/);
    assert.match(
        client,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenantId\)\}\/readiness/
    );
    assert.match(client, /readiness\?\.checks\?\.adminBootstrap\?\.status/);
});
