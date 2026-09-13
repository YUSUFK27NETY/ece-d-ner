const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("owner landing tek giriş merkezinde üç kullanıcı yolunu açıkça sunar", () => {
    const html = read("public/owner/index.html");

    assert.match(html, /<h1 id="entry-title">Giriş Merkezi<\/h1>/);
    assert.match(html, /href="\/admin\/"/);
    assert.match(html, /id="owner-entry-button"/);
    assert.match(html, /id="customer-entry-form"/);
    assert.match(html, /id="customer-tenant-id"/);
    assert.match(html, /src="\/owner\/portal\.js"/);
});

test("müşteri geçişi canonical tenant kodunu path segmentine taşır", () => {
    const source = read("public/owner/portal.js");

    assert.match(source, /TENANT_ID_PATTERN\s*=\s*\/\^\[a-z0-9\]/);
    assert.match(source, /tenantId\.length\s*>=\s*3/);
    assert.match(source, /tenantId\.length\s*<=\s*63/);
    assert.match(source, /window\.location\.assign\(`\/m\/\$\{encodeURIComponent\(tenantId\)\}`\)/);
    assert.doesNotMatch(source, /innerHTML\s*=/);
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /password/i);
    assert.doesNotMatch(source, /email/i);
});

test("giriş merkezi hard-coded tenant müşteri linki üretmez", () => {
    const html = read("public/owner/index.html");
    const source = read("public/owner/portal.js");

    assert.doesNotMatch(html, /href="\/m\/ela-doner"/);
    assert.doesNotMatch(source, /\/m\/ela-doner/);
    assert.match(html, /placeholder="ela-doner"/);
});
