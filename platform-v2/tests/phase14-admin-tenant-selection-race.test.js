"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("admin busy state locks tenant switching and cancel actions", () => {
    const source = read("public/admin/admin.js");

    assert.match(source, /busy:\s*false/);
    assert.match(source, /state\.busy = isBusy/);
    assert.match(source, /elements\.cancelButton\.disabled = isBusy/);
    assert.match(
        source,
        /elements\.tenantList\.querySelectorAll\("\.tenant-card"\)[\s\S]*button\.disabled = isBusy/
    );
    assert.match(source, /button\.disabled = state\.busy/);
});

test("admin save keeps tenant mutation and UI response bound to submit context", () => {
    const source = read("public/admin/admin.js");

    assert.match(source, /const modeAtSubmit = state\.mode/);
    assert.match(source, /const selectedTenantIdAtSubmit = state\.selectedTenantId/);
    assert.match(
        source,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(selectedTenantIdAtSubmit\)\}/
    );
    assert.match(
        source,
        /state\.mode !== modeAtSubmit\s*\|\|\s*state\.selectedTenantId !== selectedTenantIdAtSubmit/
    );
    assert.match(
        source,
        /body\.tenant\.tenantId !== selectedTenantIdAtSubmit/
    );
    assert.match(
        source,
        /findIndex\(item => item\.tenantId === selectedTenantIdAtSubmit\)/
    );
});

test("admin create canonicalizes tenant id and verifies the returned tenant", () => {
    const source = read("public/admin/admin.js");

    assert.match(source, /const TENANT_ID_PATTERN = \/\^\[a-z0-9\]/);
    assert.match(source, /function canonicalTenantId\(value\)/);
    assert.match(
        source,
        /const requestedTenantId = canonicalTenantId\(elements\.tenantId\.value\)/
    );
    assert.match(source, /elements\.tenantId\.value = requestedTenantId/);
    assert.match(source, /tenantId: requestedTenantId/);
    assert.match(source, /body\.tenant\.tenantId !== requestedTenantId/);
});
