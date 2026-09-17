const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");
const {
    attachPublicStorefrontRuntime,
    hasMalformedPathEncoding,
    recoverPublicTenantId
} = require("../src/http/attach-public-storefront-runtime");

function createTestApp() {
    const app = express();
    attachPublicStorefrontRuntime({
        app,
        storefrontService: {
            async get() {
                throw new Error("Bu testte storefront API çağrılmamalı.");
            }
        },
        rateLimiter(req, res, next) {
            next();
        }
    });
    return app;
}

async function withServer(run) {
    const server = createTestApp().listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

test("public tenant recovery only removes invisible/space noise at URL edges", () => {
    assert.equal(recoverPublicTenantId("ela-doner\u2060"), "ela-doner");
    assert.equal(recoverPublicTenantId("\u200Bela-doner"), "ela-doner");
    assert.equal(recoverPublicTenantId(" ela-doner "), "ela-doner");

    assert.equal(recoverPublicTenantId("ela\u2060-doner"), null);
    assert.equal(recoverPublicTenantId("ELA-DONER\u2060"), null);
    assert.equal(recoverPublicTenantId("ela-doner"), null);
});

test("malformed percent encoding path guard fails closed before route decoding", () => {
    assert.equal(hasMalformedPathEncoding("/%E0%A4%A"), true);
    assert.equal(hasMalformedPathEncoding("/ela-doner?src=%E0%A4%A"), false);
    assert.equal(hasMalformedPathEncoding("/ela-doner"), false);
});

test("storefront page redirects a trailing U+2060 to the clean canonical tenant URL", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/m/ela-doner%E2%81%A0`, {
            redirect: "manual"
        });

        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), "/m/ela-doner");
    });
});

test("storefront subroutes preserve their suffix when edge noise is recovered", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/m/%E2%80%8Bela-doner/appointments`, {
            redirect: "manual"
        });

        assert.equal(response.status, 308);
        assert.equal(response.headers.get("location"), "/m/ela-doner/appointments");
    });
});

test("storefront does not recover invisible characters inside a tenant id", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/m/ela%E2%81%A0-doner`, {
            redirect: "manual"
        });

        assert.equal(response.status, 404);
        assert.equal(await response.text(), "İşletme bulunamadı.");
    });
});

test("malformed storefront page path returns controlled 404 before Express param decode", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/m/%E0%A4%A`, {
            redirect: "manual"
        });

        assert.equal(response.status, 404);
        assert.equal(await response.text(), "İşletme bulunamadı.");
    });
});

test("malformed storefront API path returns controlled JSON 400 without calling service", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}/api/public/storefront/%E0%A4%A`, {
            redirect: "manual"
        });
        const body = await response.json();

        assert.equal(response.status, 400);
        assert.deepEqual(body, {
            success: false,
            message: "İşletme bağlantısı geçersiz."
        });
    });
});
