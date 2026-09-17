"use strict";

const DEFAULT_BASE_URL = "https://business-platform-v2-production.onrender.com";
const DEFAULT_TENANT_ID = "ela-doner";
const STOREFRONT_RUNTIME_ASSETS = Object.freeze([
    "/m/storefront.css",
    "/m/presentation.css",
    "/m/design-families.css",
    "/m/checkout.css",
    "/m/media.css",
    "/m/route-guard.js",
    "/m/request-timeout.js",
    "/m/design-family-bridge.js",
    "/m/media.js",
    "/m/storefront.js",
    "/m/share-resilience.js",
    "/m/cart-accessibility.js",
    "/m/appointments-link.js"
]);

function normalizeBaseUrl(value = DEFAULT_BASE_URL) {
    const url = new URL(String(value || DEFAULT_BASE_URL));
    if (url.protocol !== "https:") {
        throw new TypeError("Storefront runtime asset base URL HTTPS olmalı.");
    }
    return url.toString().replace(/\/$/, "");
}

function normalizeTenantId(value = DEFAULT_TENANT_ID) {
    const tenantId = String(value || DEFAULT_TENANT_ID).trim();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(tenantId)) {
        throw new TypeError("Storefront runtime asset tenant ID geçersiz.");
    }
    return tenantId;
}

function normalizePositiveInteger(value, fallback, max) {
    const number = Number(value ?? fallback);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) {
        throw new TypeError("Storefront runtime asset retry ayarı geçersiz.");
    }
    return number;
}

async function fetchWithTimeout(fetchImplementation, url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetchImplementation(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
                Accept: "*/*",
                "User-Agent": "business-platform-v2-runtime-asset-smoke/1.0"
            }
        });
    } finally {
        clearTimeout(timer);
    }
}

function expectedContentType(asset) {
    return asset.endsWith(".css") ? "text/css" : "javascript";
}

async function checkAsset(fetchImplementation, baseUrl, asset, timeoutMs) {
    const response = await fetchWithTimeout(fetchImplementation, `${baseUrl}${asset}`, timeoutMs);
    if (!response?.ok) {
        throw new Error(`Storefront runtime asset HTTP hatası: ${asset} (${response?.status ?? "yanıt yok"})`);
    }
    const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase();
    if (!contentType.includes(expectedContentType(asset))) {
        throw new Error(`Storefront runtime asset content-type geçersiz: ${asset}`);
    }
    const body = await response.text();
    if (!body.trim()) {
        throw new Error(`Storefront runtime asset boş: ${asset}`);
    }
}

async function checkIndexReferences(fetchImplementation, baseUrl, tenantId, timeoutMs) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        `${baseUrl}/m/${encodeURIComponent(tenantId)}`,
        timeoutMs
    );
    if (!response?.ok) {
        throw new Error(`Storefront runtime index HTTP ${response?.status ?? "yanıt yok"}`);
    }
    const html = await response.text();
    for (const asset of STOREFRONT_RUNTIME_ASSETS) {
        if (!html.includes(asset)) {
            throw new Error(`Storefront runtime index asset referansı eksik: ${asset}`);
        }
    }
}

async function checkStorefrontRuntimeAssets({
    fetchImplementation = fetch,
    baseUrl = DEFAULT_BASE_URL,
    tenantId = DEFAULT_TENANT_ID,
    timeoutMs = 18_000
} = {}) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedTenantId = normalizeTenantId(tenantId);
    const safeTimeoutMs = normalizePositiveInteger(timeoutMs, 18_000, 60_000);

    await checkIndexReferences(
        fetchImplementation,
        normalizedBaseUrl,
        normalizedTenantId,
        safeTimeoutMs
    );
    await Promise.all(STOREFRONT_RUNTIME_ASSETS.map(asset =>
        checkAsset(fetchImplementation, normalizedBaseUrl, asset, safeTimeoutMs)
    ));

    return Object.freeze({
        baseUrl: normalizedBaseUrl,
        tenantId: normalizedTenantId,
        assets: STOREFRONT_RUNTIME_ASSETS
    });
}

async function main() {
    const attempts = normalizePositiveInteger(
        process.env.PLATFORM_V2_RUNTIME_ASSET_ATTEMPTS,
        3,
        10
    );
    const retryDelayMs = normalizePositiveInteger(
        process.env.PLATFORM_V2_RUNTIME_ASSET_RETRY_DELAY_MS,
        2_000,
        30_000
    );
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
            const result = await checkStorefrontRuntimeAssets({
                baseUrl: process.env.PLATFORM_V2_SMOKE_BASE_URL || DEFAULT_BASE_URL,
                tenantId: process.env.PLATFORM_V2_SMOKE_TENANT_ID || DEFAULT_TENANT_ID,
                timeoutMs: process.env.PLATFORM_V2_SMOKE_TIMEOUT_MS || 18_000
            });
            console.log(`Storefront runtime assets verified: ${result.assets.length}`);
            return;
        } catch (error) {
            lastError = error;
            console.error(`Storefront runtime asset check failed (${attempt}/${attempts}): ${error.message}`);
            if (attempt < attempts) {
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
            }
        }
    }

    throw lastError || new Error("Storefront runtime asset check failed.");
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}

module.exports = {
    DEFAULT_BASE_URL,
    DEFAULT_TENANT_ID,
    STOREFRONT_RUNTIME_ASSETS,
    checkAsset,
    checkIndexReferences,
    checkStorefrontRuntimeAssets,
    expectedContentType,
    normalizeBaseUrl,
    normalizeTenantId,
    normalizePositiveInteger
};
