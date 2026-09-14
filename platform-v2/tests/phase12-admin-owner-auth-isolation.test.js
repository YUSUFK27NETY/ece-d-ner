const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, relativePath), "utf8");
}

test("Platform Admin auth uses a dedicated Firebase app namespace", () => {
    const script = read("../public/admin/auth-isolation.js");
    const defaultAuth = { kind: "default" };
    const adminAuth = { kind: "platform-admin" };
    const explicitAuth = { kind: "explicit" };
    const apps = [];

    function authFactory(app) {
        if (!app) return defaultAuth;
        if (app.name === "platform-admin-auth") return adminAuth;
        return explicitAuth;
    }
    authFactory.Auth = Object.freeze({
        Persistence: Object.freeze({ LOCAL: "local", SESSION: "session" })
    });

    const firebase = {
        apps,
        auth: authFactory,
        initializeApp(_config, name) {
            const app = { name: name || "[DEFAULT]" };
            apps.push(app);
            return app;
        }
    };
    const window = {
        PLATFORM_BOOTSTRAP: { firebase: { projectId: "test-project" } }
    };

    vm.runInNewContext(script, {
        window,
        firebase,
        Object,
        Array,
        Proxy,
        Reflect
    });

    assert.equal(apps.length, 1);
    assert.equal(apps[0].name, "platform-admin-auth");
    assert.equal(firebase.auth(), adminAuth);
    assert.equal(window.PLATFORM_ADMIN_AUTH, adminAuth);
    assert.equal(firebase.auth.Auth.Persistence.SESSION, "session");

    const otherApp = { name: "other-app" };
    assert.equal(firebase.auth(otherApp), explicitAuth);
});

test("all Platform Admin auth pages load isolation before their page auth logic", () => {
    const pages = [
        ["../public/admin/index.html", "/admin/admin.js"],
        ["../public/admin/quick-setup.html", "/admin/quick-setup.js"],
        ["../public/admin/bootstrap-owner.html", "/admin/bootstrap-owner.js"],
        ["../public/admin/backup-diagnostic.html", "/admin/backup-diagnostic.js"],
        ["../public/admin/security-review.html", "/admin/security-review.js"]
    ];

    for (const [relativePath, pageScript] of pages) {
        const html = read(relativePath);
        const configIndex = html.indexOf('/admin/config.js');
        const isolationIndex = html.indexOf('/admin/auth-isolation.js');
        const pageScriptIndex = html.indexOf(pageScript);

        assert.ok(configIndex >= 0, `${relativePath}: config.js eksik`);
        assert.ok(isolationIndex > configIndex, `${relativePath}: isolation config'den sonra yüklenmeli`);
        assert.ok(pageScriptIndex > isolationIndex, `${relativePath}: isolation auth kodundan önce yüklenmeli`);
    }
});

test("owner auth stays on its own default Firebase namespace", () => {
    const login = read("../public/owner/login.js");
    const panel = read("../public/owner/owner.js");

    assert.doesNotMatch(login, /platform-admin-auth|PLATFORM_ADMIN_AUTH/);
    assert.doesNotMatch(panel, /platform-admin-auth|PLATFORM_ADMIN_AUTH/);
    assert.match(login, /firebase\.auth\(\)/);
    assert.match(panel, /firebase\.auth\(\)/);
});
