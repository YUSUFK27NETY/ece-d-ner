function requireNonEmpty(value, name) {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
        const error = new Error(`${name} gerekli.`);
        error.code = "R2_CONFIG_MISSING";
        throw error;
    }
    return normalized;
}

function normalizeR2Endpoint(value) {
    const raw = requireNonEmpty(value, "PLATFORM_BACKUP_R2_ENDPOINT");
    let url;

    try {
        url = new URL(raw);
    } catch {
        throw new TypeError("PLATFORM_BACKUP_R2_ENDPOINT geçerli bir HTTPS URL olmalı.");
    }

    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        throw new TypeError("PLATFORM_BACKUP_R2_ENDPOINT yalnız HTTPS origin olmalı.");
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
}

function normalizeBucketName(value) {
    const bucket = requireNonEmpty(value, "PLATFORM_BACKUP_R2_BUCKET");
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
        throw new TypeError("PLATFORM_BACKUP_R2_BUCKET geçerli bucket adı olmalı.");
    }
    return bucket;
}

function loadR2BackupConfig(env = process.env) {
    return Object.freeze({
        endpoint: normalizeR2Endpoint(env.PLATFORM_BACKUP_R2_ENDPOINT),
        bucket: normalizeBucketName(env.PLATFORM_BACKUP_R2_BUCKET),
        accessKeyId: requireNonEmpty(env.PLATFORM_BACKUP_R2_ACCESS_KEY_ID, "PLATFORM_BACKUP_R2_ACCESS_KEY_ID"),
        secretAccessKey: requireNonEmpty(env.PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY, "PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY"),
        region: String(env.PLATFORM_BACKUP_R2_REGION ?? "auto").trim() || "auto"
    });
}

module.exports = {
    normalizeR2Endpoint,
    normalizeBucketName,
    loadR2BackupConfig
};
