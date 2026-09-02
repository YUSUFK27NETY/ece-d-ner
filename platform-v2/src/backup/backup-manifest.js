const { requireTenantId } = require("../tenant/tenant-id");
const { tenantBackupPrefix } = require("./backup-key");
const { sha256Hex, normalizeKeyId, normalizeSchemaVersion } = require("./backup-codec");

const MANIFEST_VERSION = 1;

function buildManifestKey(objectKey) {
    const key = String(objectKey ?? "").trim();

    if (!key || key.includes("..") || !key.startsWith("backups/") || !key.endsWith(".enc")) {
        throw new TypeError("Geçerli backup object key gerekli.");
    }

    return `${key}.manifest.json`;
}

function buildBackupManifest({
    tenantId: rawTenantId,
    objectKey,
    header,
    body,
    verifiedAt = new Date()
}) {
    const tenantId = requireTenantId(rawTenantId);
    const key = String(objectKey ?? "").trim();

    if (!key.startsWith(tenantBackupPrefix(tenantId))) {
        throw new TypeError("Backup object key tenant sınırı dışında.");
    }

    if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new TypeError("Backup body gerekli.");
    }

    if (!header || header.tenantId !== tenantId) {
        throw new TypeError("Backup header tenant kimliği uyuşmuyor.");
    }

    const date = verifiedAt instanceof Date ? verifiedAt : new Date(verifiedAt);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError("Manifest verifiedAt geçersiz.");
    }

    const manifest = {
        manifestVersion: MANIFEST_VERSION,
        status: "verified",
        tenantId,
        objectKey: key,
        manifestKey: buildManifestKey(key),
        createdAt: new Date(header.createdAt).toISOString(),
        verifiedAt: date.toISOString(),
        schemaVersion: normalizeSchemaVersion(header.schemaVersion),
        keyId: normalizeKeyId(header.keyId),
        formatVersion: header.formatVersion,
        sizeBytes: body.length,
        containerSha256: sha256Hex(body),
        plaintextSha256: header.plaintextSha256
    };

    return Object.freeze(manifest);
}

function assertBackupManifest(manifest, expectedTenantId = null) {
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new TypeError("Backup manifest nesnesi gerekli.");
    }

    if (manifest.manifestVersion !== MANIFEST_VERSION || manifest.status !== "verified") {
        throw new Error("Desteklenmeyen veya doğrulanmamış backup manifest.");
    }

    const tenantId = requireTenantId(manifest.tenantId);

    if (expectedTenantId !== null && tenantId !== requireTenantId(expectedTenantId)) {
        throw new Error("Backup manifest farklı tenant kimliğine ait.");
    }

    if (!String(manifest.objectKey ?? "").startsWith(tenantBackupPrefix(tenantId))) {
        throw new Error("Backup manifest object key tenant sınırı dışında.");
    }

    if (manifest.manifestKey !== buildManifestKey(manifest.objectKey)) {
        throw new Error("Backup manifest key uyuşmuyor.");
    }

    normalizeSchemaVersion(manifest.schemaVersion);
    normalizeKeyId(manifest.keyId);

    if (!Number.isInteger(manifest.sizeBytes) || manifest.sizeBytes < 1 ||
        !/^[a-f0-9]{64}$/.test(String(manifest.containerSha256 ?? "")) ||
        !/^[a-f0-9]{64}$/.test(String(manifest.plaintextSha256 ?? ""))) {
        throw new Error("Backup manifest integrity metadata geçersiz.");
    }

    for (const field of ["createdAt", "verifiedAt"]) {
        if (Number.isNaN(new Date(manifest[field]).getTime())) {
            throw new Error(`Backup manifest ${field} geçersiz.`);
        }
    }

    return manifest;
}

module.exports = {
    MANIFEST_VERSION,
    buildManifestKey,
    buildBackupManifest,
    assertBackupManifest
};
