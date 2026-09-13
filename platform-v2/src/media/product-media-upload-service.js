const { requireTenantId } = require("../tenant/tenant-id");
const { requireProductId } = require("../catalog/product-model");
const {
    loadMediaR2Config,
    normalizeHttpsOrigin
} = require("../config/media-r2-config");
const { loadR2BackupConfig } = require("../config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../storage/r2-object-storage-provider");

const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_CONTENT_TYPES = Object.freeze([
    "image/jpeg",
    "image/png",
    "image/webp"
]);
const MEDIA_CONFIG_KEYS = Object.freeze([
    "PLATFORM_MEDIA_R2_ENDPOINT",
    "PLATFORM_MEDIA_R2_BUCKET",
    "PLATFORM_MEDIA_R2_ACCESS_KEY_ID",
    "PLATFORM_MEDIA_R2_SECRET_ACCESS_KEY",
    "PLATFORM_MEDIA_PUBLIC_BASE_URL"
]);
const BACKUP_STORAGE_CONFIG_KEYS = Object.freeze([
    "PLATFORM_BACKUP_R2_ENDPOINT",
    "PLATFORM_BACKUP_R2_BUCKET",
    "PLATFORM_BACKUP_R2_ACCESS_KEY_ID",
    "PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY"
]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Media tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Media tenantId geçersiz.");
    return tenantId;
}

function requireContentType(value) {
    const contentType = String(value ?? "").trim().toLowerCase().split(";", 1)[0];
    if (!MEDIA_CONTENT_TYPES.includes(contentType)) {
        throw safeError("MEDIA_TYPE_UNSUPPORTED", "Yalnız JPEG, PNG veya WebP yüklenebilir.");
    }
    return contentType;
}

function matchesSignature(body, contentType) {
    if (!Buffer.isBuffer(body)) return false;
    if (contentType === "image/jpeg") {
        return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
    }
    if (contentType === "image/png") {
        return body.length >= 8 && body.subarray(0, 8).equals(
            Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
        );
    }
    if (contentType === "image/webp") {
        return body.length >= 12 &&
            body.subarray(0, 4).toString("ascii") === "RIFF" &&
            body.subarray(8, 12).toString("ascii") === "WEBP";
    }
    return false;
}

function requireImageBody(value, contentType) {
    if (!Buffer.isBuffer(value) || value.length < 12 || value.length > MAX_MEDIA_BYTES) {
        throw safeError("MEDIA_SIZE_INVALID", "Görsel boyutu geçersiz.");
    }
    if (!matchesSignature(value, contentType)) {
        throw safeError("MEDIA_SIGNATURE_INVALID", "Görsel dosyası doğrulanamadı.");
    }
    return value;
}

function encodeObjectPath(value) {
    return String(value).split("/").map(segment => encodeURIComponent(segment)).join("/");
}

function mediaObjectKey(tenantId, productId) {
    return `media/${tenantId}/products/${productId}`;
}

function publicUrl(baseUrl, key) {
    return `${baseUrl}/${encodeObjectPath(key)}`;
}

function createProductMediaUploadService({ storageProvider, publicBaseUrl } = {}) {
    if (!storageProvider || typeof storageProvider.putObject !== "function") {
        throw new TypeError("Media object storage provider gerekli.");
    }
    let base;
    try {
        base = new URL(String(publicBaseUrl));
    } catch {
        throw new TypeError("Media public base URL geçersiz.");
    }
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
        throw new TypeError("Media public base URL HTTPS olmalı.");
    }
    const normalizedBaseUrl = base.toString().replace(/\/$/, "");

    return Object.freeze({
        async uploadProductImage({ tenantId: rawTenantId, productId: rawProductId, body, contentType } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const productId = requireProductId(rawProductId);
            const safeContentType = requireContentType(contentType);
            const payload = requireImageBody(body, safeContentType);
            const key = mediaObjectKey(tenantId, productId);

            try {
                await storageProvider.putObject({
                    key,
                    body: payload,
                    contentType: safeContentType,
                    metadata: {
                        tenant: tenantId,
                        product: productId
                    }
                });
            } catch {
                throw safeError("MEDIA_STORAGE_UNAVAILABLE", "Görsel depolama şu anda kullanılamıyor.");
            }

            return Object.freeze({
                imageUrl: publicUrl(normalizedBaseUrl, key),
                contentType: safeContentType,
                size: payload.length
            });
        },

        async readProductImage({ tenantId: rawTenantId, productId: rawProductId } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const productId = requireProductId(rawProductId);
            if (typeof storageProvider.getObject !== "function") {
                throw safeError("MEDIA_STORAGE_UNAVAILABLE", "Görsel depolama şu anda kullanılamıyor.");
            }

            let stored;
            try {
                stored = await storageProvider.getObject({
                    key: mediaObjectKey(tenantId, productId)
                });
            } catch (error) {
                if (error?.code === "NOT_FOUND") {
                    throw safeError("MEDIA_NOT_FOUND", "Görsel bulunamadı.");
                }
                throw safeError("MEDIA_STORAGE_UNAVAILABLE", "Görsel depolama şu anda kullanılamıyor.");
            }

            try {
                const safeContentType = requireContentType(stored?.contentType);
                const payload = requireImageBody(stored?.body, safeContentType);
                return Object.freeze({
                    body: payload,
                    contentType: safeContentType
                });
            } catch {
                throw safeError("MEDIA_STORAGE_UNAVAILABLE", "Görsel depolama şu anda kullanılamıyor.");
            }
        }
    });
}

function configuredKeys(env, keys) {
    return keys.filter(key => String(env[key] ?? "").trim().length > 0);
}

function createConfiguredProductMediaUploadService({ env = process.env } = {}) {
    const configuredMediaKeys = configuredKeys(env, MEDIA_CONFIG_KEYS);
    if (configuredMediaKeys.length > 0) {
        const config = loadMediaR2Config(env);
        return createProductMediaUploadService({
            storageProvider: createR2ObjectStorageProvider(config),
            publicBaseUrl: config.publicBaseUrl
        });
    }

    const configuredBackupKeys = configuredKeys(env, BACKUP_STORAGE_CONFIG_KEYS);
    if (configuredBackupKeys.length === 0) return null;

    const backupConfig = loadR2BackupConfig(env);
    const runtimePublicOrigin = env.PLATFORM_PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL;
    const publicBaseUrl = normalizeHttpsOrigin(
        runtimePublicOrigin,
        "PLATFORM_PUBLIC_ORIGIN veya RENDER_EXTERNAL_URL"
    );
    return createProductMediaUploadService({
        storageProvider: createR2ObjectStorageProvider(backupConfig),
        publicBaseUrl
    });
}

module.exports = {
    MAX_MEDIA_BYTES,
    MEDIA_CONTENT_TYPES,
    MEDIA_CONFIG_KEYS,
    BACKUP_STORAGE_CONFIG_KEYS,
    createConfiguredProductMediaUploadService,
    createProductMediaUploadService,
    matchesSignature,
    mediaObjectKey,
    publicUrl
};
