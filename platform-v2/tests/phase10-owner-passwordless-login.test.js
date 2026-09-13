const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("owner panel exposes passwordless login for invite-created owners", () => {
    const ownerHtml = read("../public/owner/index.html");
    const loginHtml = read("../public/owner/email-login.html");
    const loginScript = read("../public/owner/email-login.js");

    assert.match(ownerHtml, /\/owner\/email-login\.html/);
    assert.match(loginHtml, /Şifresiz İşletme Girişi/);
    assert.match(loginHtml, /email-login-tenant/);
    assert.match(loginHtml, /email-login-email/);
    assert.match(loginScript, /sendSignInLinkToEmail/);
    assert.match(loginScript, /signInWithEmailLink/);
    assert.match(loginScript, /isSignInWithEmailLink/);
    assert.match(loginScript, /handleCodeInApp:\s*true/);
    assert.match(loginScript, /\/owner\/\?tenant=/);
    assert.doesNotMatch(loginScript, /localStorage|sessionStorage/);
    assert.doesNotMatch(loginScript, /innerHTML\s*=/);
    assert.doesNotMatch(loginScript, /console\./);
});

test("accepted owner handoff uses the tenant query key understood by owner panel", () => {
    const acceptScript = read("../public/owner/accept-invite.js");
    const ownerScript = read("../public/owner/owner.js");

    assert.match(acceptScript, /ownerConsoleLink\.href = `\/owner\/\?tenant=\$\{encodeURIComponent\(inviteState\.tenantId\)\}`/);
    assert.match(ownerScript, /params\.get\("tenant"\)/);
    assert.doesNotMatch(acceptScript, /ownerConsoleLink\.href = `\/owner\/\?tenantId=/);
});

test("passwordless login URL contains tenant only, never raw email", () => {
    const loginScript = read("../public/owner/email-login.js");
    const start = loginScript.indexOf("function ownerLoginUrl");
    const end = loginScript.indexOf("function ownerPanelUrl");
    const loginUrlFunction = loginScript.slice(start, end);

    assert.ok(start >= 0 && end > start);
    assert.match(loginUrlFunction, /searchParams\.set\("tenant", tenantId\)/);
    assert.doesNotMatch(loginUrlFunction, /[?&]email=/i);
    assert.doesNotMatch(loginUrlFunction, /searchParams\.(?:set|append)\(\s*["']email["']/i);
});
