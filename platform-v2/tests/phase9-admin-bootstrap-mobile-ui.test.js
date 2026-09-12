const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const adminDir = path.join(__dirname, "../public/admin");
const html = fs.readFileSync(path.join(adminDir, "bootstrap-owner.html"), "utf8");
const client = fs.readFileSync(path.join(adminDir, "bootstrap-owner.js"), "utf8");

test("mobile initial-owner page uses self-hosted email invite client and existing Firebase admin session", () => {
    assert.match(html, /id="bootstrap-owner-form"/);
    assert.match(html, /id="bootstrap-tenant-id"/);
    assert.match(html, /id="bootstrap-owner-email"/);
    assert.match(html, /Owner Daveti/);
    assert.match(html, /src="\/admin\/config\.js"/);
    assert.match(html, /src="\/admin\/bootstrap-owner\.js"/);
    assert.doesNotMatch(html, /Firebase User UID/);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);

    assert.match(client, /firebase\.auth\(\)\.onAuthStateChanged/);
    assert.match(client, /user\.getIdToken\(true\)/);
    assert.match(client, /headers\.set\("Authorization", `Bearer \$\{token\}`\)/);
});

test("mobile initial-owner page creates server-owned invite then sends Firebase email link", () => {
    assert.match(
        client,
        /admin-bootstrap\/initial-owner-invite/
    );
    assert.match(client, /body: JSON\.stringify\(\{ email \}\)/);
    assert.match(client, /sendSignInLinkToEmail/);
    assert.match(client, /handleCodeInApp: true/);
    assert.match(client, /\/owner\/accept-invite\.html/);
    assert.match(client, /inviteToken/);
    assert.doesNotMatch(client, /firebaseUid/);
    assert.doesNotMatch(client, /localStorage|sessionStorage|console\./);
    assert.doesNotMatch(client, /JSON\.stringify\(\{[^}]*role\s*:/s);
});

test("mobile initial-owner page never places invited email in continuation URL", () => {
    const landingFunction = client.slice(
        client.indexOf("function inviteLandingUrl"),
        client.indexOf("function firebaseMessage")
    );
    assert.match(landingFunction, /tenantId/);
    assert.match(landingFunction, /inviteToken/);
    assert.doesNotMatch(landingFunction, /email/i);
});
