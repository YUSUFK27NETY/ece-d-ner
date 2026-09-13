const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("owner landing yalnız işletme girişini gösterir; platform admin linki göstermez", () => {
    const html = read("public/owner/index.html");
    assert.match(html, /<h1>İşletme Paneli<\/h1>/);
    assert.doesNotMatch(html, /href="\/admin\//);
    assert.doesNotMatch(html, /Giriş Merkezi/);
    assert.doesNotMatch(html, /id="customer-entry-form"/);
    assert.doesNotMatch(html, /İşletme kodu/);
    assert.match(html, /id="email"/);
    assert.match(html, /id="password"/);
});

test("owner login tenant kodunu kullanıcıdan istemez ve authenticated session ile çözer", () => {
    const source = read("public/owner/owner.js");
    assert.match(source, /apiRequest\("\/api\/tenant\/session"\)/);
    assert.match(source, /session\.tenantId/);
    assert.match(source, /signInWithEmailAndPassword/);
    assert.doesNotMatch(source, /Geçerli işletme kodu girin/);
    assert.doesNotMatch(source, /params\.get\("tenant"\)/);
    assert.doesNotMatch(source, /elements\.tenantId/);
});

test("tenant session resolver yalnız tek aktif owner-admin binding döndürür", () => {
    const runtime = read("src/http/attach-tenant-member-identity-endpoints.js");
    const repo = read("src/firestore/firestore-tenant-member-binding-repository.js");
    assert.match(runtime, /TENANT_MEMBER_RESOLVE_SESSION_PATH\s*=\s*"\/api\/tenant\/session"/);
    assert.match(runtime, /findActiveBySubject/);
    assert.match(runtime, /tenant_owner/);
    assert.match(runtime, /tenant_admin/);
    assert.match(repo, /collectionGroup\(TENANT_COLLECTIONS\.members\)/);
    assert.match(repo, /where\("subjectRef",\s*"==",\s*subjectRef\)/);
    assert.match(repo, /TENANT_MEMBER_AMBIGUOUS/);
});
