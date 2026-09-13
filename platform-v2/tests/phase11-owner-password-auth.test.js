const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("permanent password setup requires a verified exact-tenant owner session", () => {
    const html = read("../public/owner/set-password.html");
    const script = read("../public/owner/set-password.js");

    assert.match(html, /Kalıcı Şifre Belirle/);
    assert.match(html, /minlength="12"/);
    assert.match(script, /\/api\/tenant\/tenants\/\$\{encodeURIComponent\(tenantId\)\}\/owner\/overview/);
    assert.match(script, /body\?\.tenant\?\.tenantId !== tenantId/);
    assert.match(script, /body\?\.session\?\.tenantId !== tenantId/);
    assert.match(script, /body\?\.session\?\.role !== "tenant_owner"/);
    assert.match(script, /verifiedUser\.updatePassword\(password\)/);
    assert.match(script, /password\.length < 12/);
    assert.doesNotMatch(script, /localStorage|sessionStorage/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
});

test("owner login exposes password reset and reset flow returns to the fixed owner login", () => {
    const ownerHtml = read("../public/owner/index.html");
    const resetHtml = read("../public/owner/reset-password.html");
    const resetScript = read("../public/owner/reset-password.js");

    assert.match(ownerHtml, /\/owner\/reset-password\.html/);
    assert.match(resetHtml, /Şifre Sıfırla/);
    assert.match(resetHtml, /id="reset-password-email"/);
    assert.doesNotMatch(resetHtml, /reset-password-tenant|İşletme kodu/);
    assert.match(resetScript, /sendPasswordResetEmail/);
    assert.match(resetScript, /new URL\("\/owner\/", window\.location\.origin\)/);
    assert.doesNotMatch(resetScript, /searchParams\.set\("tenant"|reset-password-tenant|tenantFromUrl/);
    assert.match(resetScript, /auth\/user-not-found/);
    assert.match(resetScript, /Hesap uygunsa şifre sıfırlama bağlantısı e-postana gönderildi/);
    assert.doesNotMatch(resetScript, /localStorage|sessionStorage/);
    assert.doesNotMatch(resetScript, /innerHTML\s*=/);
});

test("passwordless completion and invite acceptance both lead to password setup", () => {
    const loginScript = read("../public/owner/email-login.js");
    const acceptScript = read("../public/owner/accept-invite.js");

    assert.match(loginScript, /window\.location\.replace\(setPasswordUrl\(tenantId\)\)/);
    assert.match(acceptScript, /\/owner\/set-password\.html\?tenant=/);
});
