const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminDir = path.join(__dirname, "../public/admin");
const html = fs.readFileSync(path.join(adminDir, "quick-setup.html"), "utf8");
const client = fs.readFileSync(path.join(adminDir, "owner-diagnostic.js"), "utf8");

test("quick setup exposes read-only owner diagnostic action", () => {
    assert.match(html, /id="check-owner-diagnostic"/);
    assert.match(html, /Owner Sorununu Kontrol Et/);
    assert.match(html, /id="owner-diagnostic-status"/);
    assert.match(html, /src="\/admin\/owner-diagnostic\.js"/);
});

test("owner diagnostic client uses authenticated GET endpoint only", () => {
    assert.match(client, /initial-owner-diagnostic/);
    assert.match(client, /method: "GET"/);
    assert.match(client, /getIdToken\(true\)/);
    assert.match(client, /Authorization: "Bearer " \+ token/);
    assert.doesNotMatch(client, /method:\s*"(POST|PUT|PATCH|DELETE)"/);
    assert.doesNotMatch(client, /body\s*:/);
});

test("owner diagnostic UI presents safe state labels without browser persistence", () => {
    for (const code of [
        "READY_FOR_INVITE",
        "INVITE_PENDING",
        "INVITE_EXPIRED",
        "OWNER_BINDING_PARTIAL",
        "OWNER_BOUND_CONSISTENT"
    ]) {
        assert.match(client, new RegExp(code));
    }
    assert.match(client, /Binding:/);
    assert.match(client, /Davet:/);
    assert.match(client, /Bootstrap:/);
    assert.match(client, /Member:/);
    assert.doesNotMatch(client, /localStorage|sessionStorage/);
    assert.doesNotMatch(client, /innerHTML\s*=/);
    assert.doesNotMatch(client, /console\./);
    assert.doesNotMatch(client, /emailHash|tokenHash|subjectRef/);
});
