const test = require("node:test");
const assert = require("node:assert/strict");

const {
    STOREFRONT_RUNTIME_ASSETS,
    checkStorefrontRuntimeAssets,
    expectedContentType,
    normalizeBaseUrl,
    normalizeTenantId
} = require("../scripts/check-storefront-runtime-assets");

function fakeResponse({ status = 200, contentType = "text/plain", body = "ok" } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get(name) {
                return String(name).toLowerCase() === "content-type" ? contentType : null;
            }
        },
        async text() {
            return body;
        }
    };
}

test("runtime asset smoke storefront index ve tüm kritik assetleri doğrular", async () => {
    const calls = [];
    const indexHtml = STOREFRONT_RUNTIME_ASSETS.map(asset => `src-or-href="${asset}"`).join("\n");

    const result = await checkStorefrontRuntimeAssets({
        baseUrl: "https://example.test",
        tenantId: "ela-doner",
        timeoutMs: 1000,
        async fetchImplementation(url) {
            calls.push(url);
            if (url.endsWith("/m/ela-doner")) {
                return fakeResponse({ contentType: "text/html", body: indexHtml });
            }
            const asset = STOREFRONT_RUNTIME_ASSETS.find(item => url.endsWith(item));
            assert.ok(asset, `unexpected URL: ${url}`);
            return fakeResponse({
                contentType: expectedContentType(asset),
                body: `asset:${asset}`
            });
        }
    });

    assert.equal(result.assets.length, STOREFRONT_RUNTIME_ASSETS.length);
    assert.equal(calls.length, STOREFRONT_RUNTIME_ASSETS.length + 1);
    for (const asset of STOREFRONT_RUNTIME_ASSETS) {
        assert.ok(calls.includes(`https://example.test${asset}`), `${asset} must be fetched`);
    }
});

test("runtime asset smoke index referansı eksikse fail-closed olur", async () => {
    await assert.rejects(
        () => checkStorefrontRuntimeAssets({
            baseUrl: "https://example.test",
            tenantId: "ela-doner",
            timeoutMs: 1000,
            async fetchImplementation(url) {
                if (url.endsWith("/m/ela-doner")) {
                    return fakeResponse({
                        contentType: "text/html",
                        body: STOREFRONT_RUNTIME_ASSETS
                            .filter(asset => asset !== "/m/share-resilience.js")
                            .join("\n")
                    });
                }
                throw new Error("asset fetch should not run after missing index marker");
            }
        }),
        /share-resilience\.js/
    );
});

test("runtime asset smoke yanlış content-type veya HTTP hatasını kabul etmez", async () => {
    const indexHtml = STOREFRONT_RUNTIME_ASSETS.join("\n");
    await assert.rejects(
        () => checkStorefrontRuntimeAssets({
            baseUrl: "https://example.test",
            tenantId: "ela-doner",
            timeoutMs: 1000,
            async fetchImplementation(url) {
                if (url.endsWith("/m/ela-doner")) {
                    return fakeResponse({ contentType: "text/html", body: indexHtml });
                }
                const asset = STOREFRONT_RUNTIME_ASSETS.find(item => url.endsWith(item));
                return fakeResponse({
                    contentType: asset === "/m/cart-accessibility.js"
                        ? "text/plain"
                        : expectedContentType(asset),
                    body: "asset"
                });
            }
        }),
        /content-type geçersiz/
    );
});

test("runtime asset smoke yalnız HTTPS base URL ve canonical tenant kabul eder", () => {
    assert.equal(normalizeBaseUrl("https://example.test/"), "https://example.test");
    assert.equal(normalizeTenantId("ela-doner"), "ela-doner");
    assert.throws(() => normalizeBaseUrl("http://example.test"), TypeError);
    assert.throws(() => normalizeTenantId("ELA DONER"), TypeError);
});
