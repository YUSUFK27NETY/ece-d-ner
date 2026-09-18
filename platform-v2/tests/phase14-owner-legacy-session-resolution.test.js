"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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


function loadResolver({ response }) {
    const stored = new Map();
    const context = {
        fetch: async () => ({
            ok: response.ok,
            status: response.status,
            async json() { return response.body; }
        }),
        window: {
            sessionStorage: {
                setItem(key, value) { stored.set(key, value); }
            }
        },
        Set,
        Object,
        String,
        Error
    };
    vm.createContext(context);
    vm.runInContext(read("public/owner/session-resolver.js"), context);
    return { resolver: context.window.OWNER_SESSION_RESOLVER, stored };
}

test("shared resolver accepts exact owner tenant session and persists convenience tenant id", async () => {
    const { resolver, stored } = loadResolver({
        response: {
            ok: true,
            status: 200,
            body: { session: { tenantId: "ela-doner", role: "tenant_owner" } }
        }
    });
    const user = { async getIdToken() { return "owner-token"; } };
    const session = await resolver.resolve(user);
    assert.equal(session.tenantId, "ela-doner");
    assert.equal(session.role, "tenant_owner");
    assert.equal(stored.get("platformOwnerTenantId"), "ela-doner");
});

test("shared resolver rejects non-owner tenant roles fail-closed", async () => {
    const { resolver, stored } = loadResolver({
        response: {
            ok: true,
            status: 200,
            body: { session: { tenantId: "ela-doner", role: "staff" } }
        }
    });
    const user = { async getIdToken() { return "staff-token"; } };
    await assert.rejects(() => resolver.resolve(user), /İşletme hesabı doğrulanamadı/);
    assert.equal(stored.has("platformOwnerTenantId"), false);
});
