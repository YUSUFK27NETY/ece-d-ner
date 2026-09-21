const test = require("node:test");
const assert = require("node:assert/strict");

const {
    checkPlatformV2Production,
    normalizeBaseUrl,
    normalizeCommit,
    normalizeTenantId
} = require("../scripts/check-production-smoke");

const COMMIT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const COMMIT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function response({ status = 200, json = null, text = "" } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return json; },
        async text() { return text; },
        clone() { return response({ status, json, text }); }
    };
}

function createHealthyFetch({
    tier = "starter",
    source = "legacy_fallback",
    designFamily = "modern",
    designFamilySource = "tier_default",
    deployedCommit = COMMIT_A
} = {}) {
    const calls = [];
    const fetchImplementation = async url => {
        calls.push(url);
        if (url.endsWith("/health")) {
            return response({
                json: { success: true, status: "ok", service: "platform-v2-admin-api" }
            });
        }
        if (url.endsWith("/ready")) {
            return response({
                json: {
                    success: true,
                    status: "ready",
                    service: "platform-v2-admin-api",
                    checks: { firestore: { status: "ready" } }
                }
            });
        }
        if (url.endsWith("/api/public/deployment")) {
            return response({
                json: { success: true, deployment: { commit: deployedCommit } }
            });
        }
        if (url.includes("/api/public/storefront/")) {
            return response({
                json: {
                    success: true,
                    storefront: {
                        tenant: { tenantId: "ela-doner" },
                        products: [],
                        presentation: {
                            tier,
                            source,
                            designFamily,
                            designFamilySource,
                            sector: { sector: "restaurant", offeringKind: "menu" },
                            components: { hero: "compact" },
                            sections: []
                        }
                    }
                }
            });
        }
        if (url.endsWith("/m/ela-doner")) {
            return response({
                text: '<div id="storefront"></div><link href="/m/storefront.css"><link href="/m/presentation.css"><link href="/m/design-families.css"><script src="/m/design-family-bridge.js"></script><script src="/m/storefront.js"></script>'
            });
        }
        if (url.endsWith("/m/presentation.css")) {
            return response({
                text: [
                    ':root[data-presentation-hero="featured"]{}',
                    ':root[data-presentation-typography="professional"]{}',
                    ':root[data-presentation-footer="expanded"]{}'
                ].join("\n")
            });
        }
        if (url.endsWith("/m/storefront.css")) {
            return response({
                text: [
                    ':root[data-presentation-hero="featured"]{}',
                    ':root[data-presentation-hero="immersive"]{}',
                    ':root[data-presentation-typography="editorial"]{}',
                    ':root[data-presentation-offering="advanced"]{}',
                    ':root[data-presentation-density="luxury"]{}'
                ].join("\n")
            });
        }
        if (url.endsWith("/m/design-families.css")) {
            return response({
                text: ["warm", "bold", "corporate", "editorial", "minimal"]
                    .map(family => `:root[data-design-family="${family}"]{}`)
                    .join("\n")
            });
        }
        if (url.endsWith("/m/design-family-bridge.js")) {
            return response({ text: "const designFamily = true; document.documentElement.dataset.designFamily = 'modern';" });
        }
        if (url.endsWith("/admin/support-dashboard.html")) {
            return response({
                text: '<h1>Destek Merkezi</h1><th>Otomatik alarm</th><link href="/admin/support-dashboard.css"><script src="/admin/support-dashboard.js"></script>'
            });
        }
        if (url.endsWith("/admin/support-dashboard.js")) {
            return response({
                text: 'const adminAuth = window.PLATFORM_ADMIN_AUTH; fetch("/api/platform/support-overview?limit=200"); function operationalAlertText() {}'
            });
        }
        if (url.endsWith("/owner/support.html")) {
            return response({
                text: '<h1>Destek Taleplerim</h1><link href="/owner/support.css"><script src="/owner/support.js"></script>'
            });
        }
        if (url.endsWith("/owner/support.js")) {
            return response({
                text: 'window.OWNER_SESSION_RESOLVER.resolve(user); fetch("/owner/support/tickets"); element.textContent = value;'
            });
        }
        if (url.endsWith("/owner/settings.html")) {
            return response({
                text: '<h1>İşletme Ayarları</h1><link href="/owner/settings.css"><script src="/owner/settings.js"></script>'
            });
        }
        if (url.endsWith("/owner/settings.js")) {
            return response({
                text: 'window.OWNER_SESSION_RESOLVER.resolve(user); fetch("/owner/settings"); element.textContent = value;'
            });
        }
        if (url.endsWith("/admin/support-tickets.html")) {
            return response({
                text: '<h1>Destek Talepleri</h1><link href="/admin/support-tickets.css"><script src="/admin/support-tickets.js"></script>'
            });
        }
        if (url.endsWith("/admin/support-tickets.js")) {
            return response({
                text: 'const adminAuth = window.PLATFORM_ADMIN_AUTH; fetch("/api/platform/support/tickets"); element.textContent = value;'
            });
        }
        return response({ status: 404 });
    };
    return { calls, fetchImplementation };
}

test("production smoke exact revision, storefront ve design family assetlerini doğrular", async () => {
    const { calls, fetchImplementation } = createHealthyFetch();
    const result = await checkPlatformV2Production({
        fetchImplementation,
        baseUrl: "https://example.com/",
        tenantId: "ela-doner",
        expectedCommit: COMMIT_A,
        timeoutMs: 1000
    });

    assert.equal(result.success, true);
    assert.equal(result.baseUrl, "https://example.com");
    assert.equal(result.tenantId, "ela-doner");
    assert.equal(result.deployedCommit, COMMIT_A);
    assert.equal(result.endpoints, 17);
    assert.deepEqual(new Set(calls), new Set([
        "https://example.com/health",
        "https://example.com/ready",
        "https://example.com/api/public/deployment",
        "https://example.com/api/public/storefront/ela-doner",
        "https://example.com/m/ela-doner",
        "https://example.com/m/presentation.css",
        "https://example.com/m/storefront.css",
        "https://example.com/m/design-families.css",
        "https://example.com/m/design-family-bridge.js",
        "https://example.com/admin/support-dashboard.html",
        "https://example.com/admin/support-dashboard.js",
        "https://example.com/owner/support.html",
        "https://example.com/owner/support.js",
        "https://example.com/owner/settings.html",
        "https://example.com/owner/settings.js",
        "https://example.com/admin/support-tickets.html",
        "https://example.com/admin/support-tickets.js"
    ]));
});

test("presentation tokenları gerçek asset dağılımında doğrulanır", async () => {
    const { fetchImplementation } = createHealthyFetch();
    await assert.doesNotReject(() => checkPlatformV2Production({
        fetchImplementation,
        baseUrl: "https://example.com",
        tenantId: "ela-doner",
        expectedCommit: COMMIT_A,
        timeoutMs: 1000
    }));
});

test("Pro immersive tokenı core storefront CSS'te yoksa smoke fail closed olur", async () => {
    const { fetchImplementation: healthyFetch } = createHealthyFetch();
    const fetchImplementation = async url => {
        if (url.endsWith("/m/storefront.css")) {
            return response({
                text: [
                    ':root[data-presentation-hero="featured"]{}',
                    ':root[data-presentation-typography="editorial"]{}',
                    ':root[data-presentation-offering="advanced"]{}',
                    ':root[data-presentation-density="luxury"]{}'
                ].join("\n")
            });
        }
        return healthyFetch(url);
    };

    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_A,
            timeoutMs: 1000
        }),
        /Core storefront stylesheet eksik presentation tokenı/
    );
});

test("production eski committeyse smoke fail closed olur", async () => {
    const { fetchImplementation } = createHealthyFetch({ deployedCommit: COMMIT_A });
    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_B,
            timeoutMs: 1000
        }),
        /beklenen SHA değil/
    );
});

test("configured Business + bold family geçerli production sözleşmesidir", async () => {
    const { fetchImplementation } = createHealthyFetch({
        tier: "business",
        source: "configured",
        designFamily: "bold",
        designFamilySource: "configured"
    });
    await assert.doesNotReject(() => checkPlatformV2Production({
        fetchImplementation,
        baseUrl: "https://example.com",
        tenantId: "ela-doner",
        expectedCommit: COMMIT_A,
        timeoutMs: 1000
    }));
});

test("bozuk presentation veya family manifesti fail closed olur", async () => {
    const invalidTier = createHealthyFetch({ tier: "enterprise", source: "configured" });
    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation: invalidTier.fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_A,
            timeoutMs: 1000
        }),
        /presentation sözleşmesi doğrulanamadı/
    );

    const invalidFamily = createHealthyFetch({ designFamily: "clone-template" });
    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation: invalidFamily.fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_A,
            timeoutMs: 1000
        }),
        /presentation sözleşmesi doğrulanamadı/
    );
});

test("health sözleşmesi bozuksa smoke başarısız olur", async () => {
    const { fetchImplementation: healthyFetch } = createHealthyFetch();
    const fetchImplementation = async url => {
        if (url.endsWith("/health")) {
            return response({ json: { success: true, status: "ok", service: "wrong-service" } });
        }
        return healthyFetch(url);
    };

    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_A,
            timeoutMs: 1000
        }),
        /health yanıtı beklenen sözleşmede değil/
    );
});

test("V2 Firestore readiness hazır değilse production smoke fail closed olur", async () => {
    const { fetchImplementation: healthyFetch } = createHealthyFetch();
    const fetchImplementation = async url => {
        if (url.endsWith("/ready")) {
            return response({
                status: 503,
                json: {
                    success: false,
                    status: "not_ready",
                    service: "platform-v2-admin-api",
                    checks: { firestore: { status: "unavailable" } }
                }
            });
        }
        return healthyFetch(url);
    };

    await assert.rejects(
        () => checkPlatformV2Production({
            fetchImplementation,
            baseUrl: "https://example.com",
            tenantId: "ela-doner",
            expectedCommit: COMMIT_A,
            timeoutMs: 1000
        }),
        /Platform readiness HTTP 503/
    );
});

test("smoke yalnız HTTPS base URL, canonical tenant ve 40 hex commit kabul eder", () => {
    assert.equal(normalizeBaseUrl("https://example.com/"), "https://example.com");
    assert.equal(normalizeTenantId("ela-doner"), "ela-doner");
    assert.equal(normalizeCommit(COMMIT_A), COMMIT_A);
    assert.throws(() => normalizeBaseUrl("http://example.com"), /HTTPS/);
    assert.throws(() => normalizeTenantId("ELA DONER"), /tenant ID geçersiz/);
    assert.throws(() => normalizeCommit("deadbeef"), /commit SHA geçersiz/);
});
