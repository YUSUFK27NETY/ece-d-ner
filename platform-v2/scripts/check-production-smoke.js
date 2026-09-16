"use strict";

const DEFAULT_BASE_URL = "https://business-platform-v2-production.onrender.com";
const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const GIT_COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const PRESENTATION_TIERS = new Set(["starter", "business", "pro"]);
const PRESENTATION_SOURCES = new Set(["configured", "legacy_fallback"]);
const DESIGN_FAMILIES = new Set(["modern", "warm", "bold", "corporate", "editorial", "minimal"]);
const DESIGN_FAMILY_SOURCES = new Set(["configured", "tier_default"]);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
    const url = new URL(String(value || DEFAULT_BASE_URL));
    if (url.protocol !== "https:") {
        throw new TypeError("Platform V2 smoke base URL HTTPS olmalı.");
    }
    return url.toString().replace(/\/$/, "");
}

function normalizeTenantId(value) {
    const tenantId = String(value || "").trim();
    if (tenantId.length < 3 || !TENANT_ID_PATTERN.test(tenantId)) {
        throw new TypeError("Platform V2 smoke tenant ID geçersiz.");
    }
    return tenantId;
}

function normalizeCommit(value, { required = false } = {}) {
    const commit = String(value || "").trim().toLowerCase();
    if (!commit && !required) return null;
    if (!GIT_COMMIT_PATTERN.test(commit)) {
        throw new TypeError("Platform V2 smoke commit SHA geçersiz.");
    }
    return commit;
}

function normalizePositiveInteger(value, fallback, max) {
    const parsed = Number(value ?? fallback);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) {
        throw new TypeError("Platform V2 smoke retry ayarı geçersiz.");
    }
    return parsed;
}

async function fetchWithTimeout(fetchImplementation, url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImplementation(url, {
            redirect: "follow",
            signal: controller.signal,
            headers: {
                Accept: "*/*",
                "User-Agent": "business-platform-v2-production-smoke/1.0"
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

function assertOk(response, label) {
    if (!response?.ok) {
        throw new Error(`${label} HTTP ${response?.status ?? "yanıt yok"}`);
    }
}

async function checkHealth(fetchImplementation, baseUrl, timeoutMs) {
    const response = await fetchWithTimeout(fetchImplementation, `${baseUrl}/health`, timeoutMs);
    assertOk(response, "Platform health");
    const body = await response.json();
    if (body?.success !== true || body?.status !== "ok" ||
        body?.service !== "platform-v2-admin-api") {
        throw new Error("Platform health yanıtı beklenen sözleşmede değil.");
    }
}

async function checkDeployment(fetchImplementation, baseUrl, timeoutMs, expectedCommit) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/api/public/deployment`,
        timeoutMs
    );
    assertOk(response, "Deployment revision");
    const body = await response.json();
    const deployedCommit = normalizeCommit(body?.deployment?.commit, { required: true });
    if (body?.success !== true) {
        throw new Error("Deployment revision yanıtı başarısız.");
    }
    if (expectedCommit && deployedCommit !== expectedCommit) {
        throw new Error(`Production commit henüz beklenen SHA değil: ${deployedCommit}`);
    }
    return deployedCommit;
}

async function checkStorefrontApi(fetchImplementation, baseUrl, tenantId, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/api/public/storefront/${encodeURIComponent(tenantId)}`,
        timeoutMs
    );
    assertOk(response, "Public storefront API");
    const body = await response.json();
    const storefront = body?.storefront;
    const presentation = storefront?.presentation;
    if (body?.success !== true || storefront?.tenant?.tenantId !== tenantId ||
        !Array.isArray(storefront?.products) || !presentation ||
        !PRESENTATION_TIERS.has(presentation.tier) ||
        !PRESENTATION_SOURCES.has(presentation.source) ||
        !DESIGN_FAMILIES.has(presentation.designFamily) ||
        !DESIGN_FAMILY_SOURCES.has(presentation.designFamilySource) ||
        typeof presentation.sector !== "object" || presentation.sector === null ||
        typeof presentation.components !== "object" || presentation.components === null ||
        !Array.isArray(presentation.sections)) {
        throw new Error("Public storefront API presentation sözleşmesi doğrulanamadı.");
    }
}

async function checkStorefrontPage(fetchImplementation, baseUrl, tenantId, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/m/${encodeURIComponent(tenantId)}`,
        timeoutMs
    );
    assertOk(response, "Public storefront page");
    const html = await response.text();
    for (const marker of [
        'id="storefront"',
        '/m/storefront.css',
        '/m/presentation.css',
        '/m/design-families.css',
        '/m/design-family-bridge.js',
        '/m/storefront.js'
    ]) {
        if (!html.includes(marker)) {
            throw new Error(`Public storefront page marker eksik: ${marker}`);
        }
    }
}

async function checkPresentationStylesheet(fetchImplementation, baseUrl, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/m/presentation.css`,
        timeoutMs
    );
    assertOk(response, "Presentation stylesheet");
    const css = await response.text();
    if (!css.includes('data-presentation-hero="featured"') ||
        !css.includes('data-presentation-hero="immersive"')) {
        throw new Error("Presentation stylesheet beklenen Business/Pro tokenlarını içermiyor.");
    }
}

async function checkDesignFamilyStylesheet(fetchImplementation, baseUrl, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/m/design-families.css`,
        timeoutMs
    );
    assertOk(response, "Design family stylesheet");
    const css = await response.text();
    for (const family of ["warm", "bold", "corporate", "editorial", "minimal"]) {
        if (!css.includes(`data-design-family="${family}"`)) {
            throw new Error(`Design family stylesheet eksik: ${family}`);
        }
    }
}

async function checkDesignFamilyBridge(fetchImplementation, baseUrl, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/m/design-family-bridge.js`,
        timeoutMs
    );
    assertOk(response, "Design family bridge");
    const source = await response.text();
    if (!source.includes("designFamily") || !source.includes("data-design-family") &&
        !source.includes("dataset.designFamily")) {
        throw new Error("Design family bridge beklenen runtime markerlarını içermiyor.");
    }
}

async function runOnce({ fetchImplementation, baseUrl, tenantId, timeoutMs, expectedCommit }) {
    const results = await Promise.all([
        checkHealth(fetchImplementation, baseUrl, timeoutMs),
        checkDeployment(fetchImplementation, baseUrl, timeoutMs, expectedCommit),
        checkStorefrontApi(fetchImplementation, baseUrl, tenantId, timeoutMs),
        checkStorefrontPage(fetchImplementation, baseUrl, tenantId, timeoutMs),
        checkPresentationStylesheet(fetchImplementation, baseUrl, timeoutMs),
        checkDesignFamilyStylesheet(fetchImplementation, baseUrl, timeoutMs),
        checkDesignFamilyBridge(fetchImplementation, baseUrl, timeoutMs)
    ]);
    return Object.freeze({
        success: true,
        checkedAt: new Date().toISOString(),
        baseUrl,
        tenantId,
        deployedCommit: results[1],
        endpoints: 7
    });
}

async function checkPlatformV2Production({
    fetchImplementation = globalThis.fetch,
    baseUrl = DEFAULT_BASE_URL,
    tenantId,
    expectedCommit = null,
    timeoutMs = 18_000,
    attempts = 1,
    retryDelayMs = 1_000
} = {}) {
    if (typeof fetchImplementation !== "function") {
        throw new TypeError("Fetch desteği gerekli.");
    }
    const safeBaseUrl = normalizeBaseUrl(baseUrl);
    const safeTenantId = normalizeTenantId(tenantId);
    const safeExpectedCommit = normalizeCommit(expectedCommit);
    const safeTimeoutMs = normalizePositiveInteger(timeoutMs, 18_000, 60_000);
    const safeAttempts = normalizePositiveInteger(attempts, 1, 30);
    const safeRetryDelayMs = normalizePositiveInteger(retryDelayMs, 1_000, 60_000);

    let lastError = null;
    for (let attempt = 1; attempt <= safeAttempts; attempt += 1) {
        try {
            return await runOnce({
                fetchImplementation,
                baseUrl: safeBaseUrl,
                tenantId: safeTenantId,
                timeoutMs: safeTimeoutMs,
                expectedCommit: safeExpectedCommit
            });
        } catch (error) {
            lastError = error;
            if (attempt < safeAttempts) await sleep(safeRetryDelayMs);
        }
    }
    throw lastError;
}

async function main() {
    try {
        const result = await checkPlatformV2Production({
            baseUrl: process.env.PLATFORM_V2_SMOKE_BASE_URL || DEFAULT_BASE_URL,
            tenantId: process.env.PLATFORM_V2_SMOKE_TENANT_ID,
            expectedCommit: process.env.PLATFORM_V2_SMOKE_EXPECTED_COMMIT || null,
            timeoutMs: process.env.PLATFORM_V2_SMOKE_TIMEOUT_MS || 18_000,
            attempts: process.env.PLATFORM_V2_SMOKE_ATTEMPTS || 1,
            retryDelayMs: process.env.PLATFORM_V2_SMOKE_RETRY_DELAY_MS || 1_000
        });
        console.log(JSON.stringify({ event: "platform_v2_production_smoke", ...result }));
    } catch (error) {
        console.error(JSON.stringify({
            event: "platform_v2_production_smoke_failed",
            checkedAt: new Date().toISOString(),
            message: error?.message || "Bilinmeyen smoke hatası"
        }));
        process.exitCode = 1;
    }
}

if (require.main === module) main();

module.exports = {
    DEFAULT_BASE_URL,
    checkPlatformV2Production,
    normalizeBaseUrl,
    normalizeCommit,
    normalizeTenantId,
    runOnce
};
