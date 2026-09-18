"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const modules = ["orders", "appointments", "media"];

test("owner module pages load shared server-session resolver before page logic", () => {
    for (const moduleName of modules) {
        const html = read(`public/owner/${moduleName}.html`);
        const resolverIndex = html.indexOf('/owner/session-resolver.js');
        const moduleIndex = html.indexOf(`/owner/${moduleName}.js`);
        assert.ok(resolverIndex >= 0, `${moduleName}: session resolver eksik`);
        assert.ok(moduleIndex > resolverIndex, `${moduleName}: resolver modül kodundan önce yüklenmeli`);
    }
});

test("orders, appointments and media bind tenant from authenticated server session only", () => {
    for (const moduleName of modules) {
        const source = read(`public/owner/${moduleName}.js`);
        assert.match(source, /OWNER_SESSION_RESOLVER/);
        assert.match(source, /sessionResolver\.resolve\(user\)/);
        assert.match(source, /state\.tenantId = session\.tenantId/);
        assert.doesNotMatch(source, /initialTenantId/);
        assert.doesNotMatch(source, /normalizeTenantId/);
        assert.doesNotMatch(source, /sessionStorage/);
        assert.doesNotMatch(source, /URLSearchParams\(window\.location\.search\)/);
    }
});

test("resolved owner modules keep a direct verified tenant back-link to the panel", () => {
    for (const moduleName of modules) {
        const source = read(`public/owner/${moduleName}.js`);
        assert.match(
            source,
            /\/owner\/panel\.html\?tenant=\$\{encodeURIComponent\(state\.tenantId\)\}/
        );
    }
});
