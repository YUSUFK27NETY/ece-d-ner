const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("owner sabit giriş sayfası yalnız işletme girişini gösterir", () => {
    const html = read("public/owner/index.html");
    assert.match(html, /<h1>İşletme Girişi<\/h1>/);
    assert.match(html, /src="\/owner\/login\.js"/);
    assert.match(html, /id="owner-email"/);
    assert.match(html, /id="owner-password"/);
    assert.doesNotMatch(html, /href="\/admin\//);
    assert.doesNotMatch(html, /Giriş Merkezi/);
    assert.doesNotMatch(html, /customer-entry/);
    assert.doesNotMatch(html, /İşletme kodu/);
    assert.doesNotMatch(html, /tenant-id/);
});

test("ortak owner login authenticated hesabı server session ile tenant'a çözer", () => {
    const source = read("public/owner/login.js");
    assert.match(source, /fetch\("\/api\/tenant\/session"/);
    assert.match(source, /session\?\.tenantId/);
    assert.match(source, /signInWithEmailAndPassword/);
    assert.match(source, /\/owner\/panel\.html\?tenant=/);
    assert.match(source, /platformOwnerTenantId/);
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /\/admin\//);
});

test("internal owner panel tenant değerini görünür form alanı olarak istemez", () => {
    const html = read("public/owner/panel.html");
    assert.match(html, /<input id="tenant-id" type="hidden">/);
    assert.doesNotMatch(html, /<label>\s*İşletme kodu/);
    assert.match(html, /src="\/owner\/owner\.js"/);
});

test("tenant session resolver yalnız tek aktif owner-admin binding döndürür", () => {
    const runtime = read("src/http/attach-tenant-member-identity-endpoints.js");
    const repo = read("src/firestore/firestore-tenant-member-binding-repository.js");
    assert.match(runtime, /TENANT_MEMBER_RESOLVE_SESSION_PATH\s*=\s*"\/api\/tenant\/session"/);
    assert.match(runtime, /findActiveBySubject/);
    assert.match(runtime, /tenant_owner/);
    assert.match(runtime, /tenant_admin/);
    assert.match(runtime, /decoded\.platformAdmin\s*===\s*true/);
    assert.match(repo, /collectionGroup\(TENANT_COLLECTIONS\.members\)/);
    assert.match(repo, /where\("subjectRef",\s*"==",\s*subjectRef\)/);
    assert.match(repo, /TENANT_MEMBER_AMBIGUOUS/);
});
