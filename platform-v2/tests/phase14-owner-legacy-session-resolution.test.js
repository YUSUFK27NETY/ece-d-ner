"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const modules = ["quotes", "inventory", "crm", "channels"];

test("legacy owner modules no longer ask for a tenant code", () => {
    for (const moduleName of modules) {
        const html = read(`public/owner/${moduleName}.html`);
        assert.doesNotMatch(html, /id="tenant-id"/);
        assert.doesNotMatch(html, /İşletme kodu/);
        assert.match(html, /src="\/owner\/session-resolver\.js"/);
        assert.match(html, /Hesabınıza bağlı işletme otomatik açılır/);
    }
});

test("shared owner session resolver binds authenticated owner/admin to server session", () => {
    const source = read("public/owner/session-resolver.js");
    assert.match(source, /fetch\("\/api\/tenant\/session"/);
    assert.match(source, /session\?\.tenantId/);
    assert.match(source, /tenant_owner/);
    assert.match(source, /tenant_admin/);
    assert.match(source, /platformOwnerTenantId/);
    assert.doesNotMatch(source, /localStorage/);
});

test("legacy owner modules use shared session resolution instead of tenant URL/storage input", () => {
    for (const moduleName of modules) {
        const source = read(`public/owner/${moduleName}.js`);
        assert.match(source, /OWNER_SESSION_RESOLVER/);
        assert.match(source, /sessionResolver\.resolve\(user\)/);
        assert.match(source, /state\.tenantId = session\.tenantId/);
        assert.doesNotMatch(source, /readTenantId/);
        assert.doesNotMatch(source, /normalizeTenantId/);
        assert.doesNotMatch(source, /el\.tenantId/);
        assert.doesNotMatch(source, /sessionStorage/);
    }
});
