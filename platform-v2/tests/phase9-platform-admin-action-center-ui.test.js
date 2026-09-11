const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../public/admin");
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const actions = fs.readFileSync(path.join(root, "admin-actions.js"), "utf8");
const prefill = fs.readFileSync(path.join(root, "tenant-query-prefill.js"), "utf8");

function read(name) {
    return fs.readFileSync(path.join(root, name), "utf8");
}

test("Merkezi Yönetim seçili tenant hızlı işlem merkezini yükler", () => {
    assert.match(index, /<script defer src="\/admin\/admin-actions\.js"><\/script>/);
    for (const marker of [
        "admin-action-center",
        "admin-action-owner-uid",
        "admin-action-assign-owner",
        "admin-action-security-review",
        "admin-action-backup-diagnostic",
        "admin-action-activate",
        "admin-action-suspend",
        "admin-action-resume",
        "admin-action-archive"
    ]) {
        assert.match(actions, new RegExp(marker), marker);
    }
    assert.match(actions, /tenantForm\.insertBefore\(panel, operationsPanel\)/);
    assert.match(actions, /tenantForm\.classList\.contains\("hidden"\)/);
    assert.match(actions, /!tenantIdInput\.disabled/);
});

test("initial owner ataması exact tenant endpointini kullanır ve UID saklamaz", () => {
    assert.match(
        actions,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenant\.tenantId\)\}\/admin-bootstrap\/initial-owner/
    );
    assert.match(actions, /firebaseUid\.length > 128/);
    assert.match(actions, /\[\\u0000-\\u001f\\u007f\]/);
    assert.match(actions, /elements\.ownerUid\.value = ""/);
    assert.match(actions, /result\?\.role !== "tenant_owner"/);
    assert.match(actions, /result\?\.adminBootstrap !== "verified"/);
    assert.doesNotMatch(actions, /localStorage|sessionStorage|indexedDB/);
    assert.doesNotMatch(actions, /password\s*=|credential\s*=|secret\s*=/i);
});

test("lifecycle butonları yalnız kontrollü action endpointlerini çağırır", () => {
    assert.match(actions, /const LIFECYCLE_RESULT = Object\.freeze/);
    for (const action of ["activate", "suspend", "resume", "archive"]) {
        assert.match(actions, new RegExp(`${action}:`));
        assert.match(actions, new RegExp(`runLifecycle\\(\\"${action}\\"\\)`));
    }
    assert.match(
        actions,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenant\.tenantId\)\}\/lifecycle\/\$\{action\}/
    );
    assert.match(actions, /\{ method: "POST" \}/);
    assert.doesNotMatch(actions, /lifecycle\/[\s\S]{0,200}body\s*:/);
    assert.match(actions, /window\.confirm\([^)]*askıya almak/s);
    assert.match(actions, /window\.confirm\([^)]*arşivlemek/s);
    assert.match(actions, /readinessCanActivate\.textContent\.trim\(\) !== "Evet"/);
});

test("security ve backup araçları seçili tenant ile açılır", () => {
    assert.match(actions, /new Set\(\["security-review", "backup-diagnostic"\]\)/);
    assert.match(
        actions,
        /\/admin\/\$\{tool\}\.html\?tenantId=\$\{encodeURIComponent\(tenant\.tenantId\)\}/
    );
    assert.match(prefill, /new URLSearchParams\(window\.location\.search\)\.get\("tenantId"\)/);
    assert.match(prefill, /TENANT|bootstrap-tenant-id|security-review-tenant-id/);
    assert.match(prefill, /backup-diagnostic-tenant-id/);
    assert.doesNotMatch(prefill, /fetch\(|submit\(|click\(/);
});

test("standalone onboarding araçları tenant query prefill scriptini yükler", () => {
    for (const file of [
        "bootstrap-owner.html",
        "security-review.html",
        "backup-diagnostic.html"
    ]) {
        assert.match(
            read(file),
            /<script defer src="\/admin\/tenant-query-prefill\.js"><\/script>/,
            file
        );
    }
});

test("action center güvenli DOM ve mevcut form sözleşmesini korur", () => {
    assert.doesNotMatch(actions, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    assert.match(actions, /document\.createElement/);
    assert.match(actions, /\.textContent\s*=/);
    assert.match(actions, /button\.type = "button"/);
    assert.doesNotMatch(actions, /method:\s*"PATCH"[\s\S]*status/);
    assert.doesNotMatch(actions, /tenantForm\.addEventListener\("submit"/);
});
