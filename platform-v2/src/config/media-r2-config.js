function requireNonEmpty(value, name) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
        const error = new Error(`${name} gerekli.`);
        error.code = "MEDIA_R2_CONFIG_MISSING";
        throw error;
    }
    return normalized;
}

function normalizeHttpsOrigin(value, name) {
    const raw = requireNonEmpty(value, name);
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw new TypeError(`${name} geçerli bir HTTPS URL olmalı.`);
    }
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new TypeError(`${name} yalnız HTTPS origin/base URL olmalı.`);
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

function normalizeBucketName(value) {
    const bucket = requireNonEmpty(value, "PLATFORM_MEDIA_R2_BUCKET");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
        throw new TypeError("PLATFORM_MEDIA_R2_BUCKET geçerli bucket adı olmalı.");
    }
    return bucket;
}

function loadMediaR2Config(env = process.env) {
    return Object.freeze({
        endpoint: normalizeHttpsOrigin(env.PLATFORM_MEDIA_R2_ENDPOINT, "PLATFORM_MEDIA_R2_ENDPOINT"),
        bucket: normalizeBucketName(env.PLATFORM_MEDIA_R2_BUCKET),
        accessKeyId: requireNonEmpty(env.PLATFORM_MEDIA_R2_ACCESS_KEY_ID, "PLATFORM_MEDIA_R2_ACCESS_KEY_ID"),
        secretAccessKey: requireNonEmpty(env.PLATFORM_MEDIA_R2_SECRET_ACCESS_KEY, "PLATFORM_MEDIA_R2_SECRET_ACCESS_KEY"),
        publicBaseUrl: normalizeHttpsOrigin(env.PLATFORM_MEDIA_PUBLIC_BASE_URL, "PLATFORM_MEDIA_PUBLIC_BASE_URL"),
        region: String(env.PLATFORM_MEDIA_R2_REGION ?? "auto").trim() || "auto"
    });
}

module.exports = {
    loadMediaR2Config,
    normalizeHttpsOrigin,
    normalizeBucketName
};
