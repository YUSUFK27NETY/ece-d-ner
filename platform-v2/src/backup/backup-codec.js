const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { requireTenantId } = require("../tenant/tenant-id");

const MAGIC = Buffer.from("PV2BKP1\n", "ascii");
const FORMAT_VERSION = 1;
const HEADER_LIMIT_BYTES = 16 * 1024;
const DEFAULT_MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;

function sha256Hex(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeKeyId(value) {
    const keyId = String(value ?? "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/.test(keyId)) {
        throw new TypeError("Geçerli bir backup keyId gerekli.");
    }

    return keyId;
}

function normalizeEncryptionKey(value) {
    let key;

    if (Buffer.isBuffer(value)) {
        key = Buffer.from(value);
    } else if (typeof value === "string") {
        const raw = value.trim();

        if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
            throw new TypeError("Backup encryption key geçerli base64 olmalı.");
        }

        key = Buffer.from(raw, "base64");
    } else {
        throw new TypeError("Backup encryption key gerekli.");
    }

    if (key.length !== 32) {
        throw new TypeError("Backup encryption key tam olarak 32 byte olmalı.");
    }

    return key;
}

function normalizeSchemaVersion(value = 1) {
    const version = Number(value);

    if (!Number.isInteger(version) || version < 1 || version > 1_000_000) {
        throw new TypeError("Backup schemaVersion pozitif tam sayı olmalı.");
    }

    return version;
}

function normalizeDate(value = new Date()) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

    if (Number.isNaN(date.getTime())) {
        throw new TypeError("Geçerli backup tarihi gerekli.");
    }

    return date;
}

function assertSnapshot(snapshot, tenantId) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
        throw new TypeError("Backup snapshot nesne olmalı.");
    }

    if (snapshot.tenantId !== undefined && requireTenantId(snapshot.tenantId) !== tenantId) {
        throw new TypeError("Backup snapshot farklı tenant kimliği içeriyor.");
    }

    return snapshot;
}

function encodeBackup({
    tenantId: rawTenantId,
    snapshot,
    encryptionKey,
    keyId: rawKeyId,
    schemaVersion = 1,
    createdAt = new Date()
}) {
    const tenantId = requireTenantId(rawTenantId);
    const keyId = normalizeKeyId(rawKeyId);
    const key = normalizeEncryptionKey(encryptionKey);
    const safeSchemaVersion = normalizeSchemaVersion(schemaVersion);
    const safeCreatedAt = normalizeDate(createdAt).toISOString();
    const safeSnapshot = assertSnapshot(snapshot, tenantId);

    const payload = {
        tenantId,
        schemaVersion: safeSchemaVersion,
        createdAt: safeCreatedAt,
        snapshot: safeSnapshot
    };
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const compressed = zlib.gzipSync(plaintext, { level: 9 });
    const iv = crypto.randomBytes(IV_BYTES);
    const header = {
        formatVersion: FORMAT_VERSION,
        tenantId,
        schemaVersion: safeSchemaVersion,
        createdAt: safeCreatedAt,
        keyId,
        compression: "gzip",
        encryption: "aes-256-gcm",
        plaintextSha256: sha256Hex(plaintext),
        iv: iv.toString("base64")
    };
    const headerBytes = Buffer.from(JSON.stringify(header), "utf8");

    if (headerBytes.length < 2 || headerBytes.length > HEADER_LIMIT_BYTES) {
        throw new Error("Backup header boyutu geçersiz.");
    }

    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv, {
        authTagLength: AUTH_TAG_BYTES
    });
    cipher.setAAD(headerBytes);
    const ciphertext = Buffer.concat([
        cipher.update(compressed),
        cipher.final()
    ]);
    const authTag = cipher.getAuthTag();
    const headerLength = Buffer.allocUnsafe(4);
    headerLength.writeUInt32BE(headerBytes.length, 0);

    return {
        body: Buffer.concat([
            MAGIC,
            headerLength,
            headerBytes,
            authTag,
            ciphertext
        ]),
        header: Object.freeze({ ...header })
    };
}

function parseContainer(body, maxBackupBytes = DEFAULT_MAX_BACKUP_BYTES) {
    if (!Buffer.isBuffer(body)) {
        throw new TypeError("Backup body Buffer olmalı.");
    }

    const maxBytes = Number(maxBackupBytes);

    if (!Number.isInteger(maxBytes) || maxBytes < 1024) {
        throw new TypeError("maxBackupBytes geçersiz.");
    }

    if (body.length > maxBytes) {
        throw new Error("Backup izin verilen maksimum boyutu aşıyor.");
    }

    const minimumSize = MAGIC.length + 4 + 2 + AUTH_TAG_BYTES + 1;

    if (body.length < minimumSize || !body.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new Error("Backup format imzası geçersiz.");
    }

    const headerLengthOffset = MAGIC.length;
    const headerLength = body.readUInt32BE(headerLengthOffset);

    if (headerLength < 2 || headerLength > HEADER_LIMIT_BYTES) {
        throw new Error("Backup header uzunluğu geçersiz.");
    }

    const headerStart = headerLengthOffset + 4;
    const headerEnd = headerStart + headerLength;
    const tagEnd = headerEnd + AUTH_TAG_BYTES;

    if (tagEnd >= body.length) {
        throw new Error("Backup container eksik veya bozuk.");
    }

    const headerBytes = body.subarray(headerStart, headerEnd);
    let header;

    try {
        header = JSON.parse(headerBytes.toString("utf8"));
    } catch {
        throw new Error("Backup header JSON geçersiz.");
    }

    validateHeader(header);

    return {
        header,
        headerBytes,
        authTag: body.subarray(headerEnd, tagEnd),
        ciphertext: body.subarray(tagEnd)
    };
}

function validateHeader(header) {
    if (!header || typeof header !== "object" || Array.isArray(header)) {
        throw new Error("Backup header nesnesi geçersiz.");
    }

    if (header.formatVersion !== FORMAT_VERSION) {
        throw new Error("Desteklenmeyen backup formatVersion.");
    }

    requireTenantId(header.tenantId);
    normalizeSchemaVersion(header.schemaVersion);
    normalizeDate(header.createdAt);
    normalizeKeyId(header.keyId);

    if (header.compression !== "gzip" || header.encryption !== "aes-256-gcm") {
        throw new Error("Desteklenmeyen backup codec ayarı.");
    }

    if (!/^[a-f0-9]{64}$/.test(String(header.plaintextSha256 ?? ""))) {
        throw new Error("Backup checksum metadata geçersiz.");
    }

    const iv = Buffer.from(String(header.iv ?? ""), "base64");

    if (iv.length !== IV_BYTES) {
        throw new Error("Backup IV geçersiz.");
    }
}

function decodeBackup({
    body,
    encryptionKey,
    keyResolver = null,
    expectedTenantId = null,
    maxBackupBytes = DEFAULT_MAX_BACKUP_BYTES
}) {
    const parsed = parseContainer(body, maxBackupBytes);
    const { header, headerBytes, authTag, ciphertext } = parsed;

    if (expectedTenantId !== null && expectedTenantId !== undefined) {
        const tenantId = requireTenantId(expectedTenantId);

        if (header.tenantId !== tenantId) {
            throw new Error("Backup farklı tenant kimliğine ait.");
        }
    }

    const resolvedKey = keyResolver
        ? keyResolver(header.keyId)
        : encryptionKey;
    const key = normalizeEncryptionKey(resolvedKey);
    const iv = Buffer.from(header.iv, "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv, {
        authTagLength: AUTH_TAG_BYTES
    });
    decipher.setAAD(headerBytes);
    decipher.setAuthTag(authTag);

    let compressed;

    try {
        compressed = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
    } catch {
        throw new Error("Backup kimlik doğrulaması başarısız; veri veya anahtar geçersiz.");
    }

    let plaintext;

    try {
        plaintext = zlib.gunzipSync(compressed);
    } catch {
        throw new Error("Backup sıkıştırılmış içeriği bozuk.");
    }

    if (sha256Hex(plaintext) !== header.plaintextSha256) {
        throw new Error("Backup checksum doğrulaması başarısız.");
    }

    let payload;

    try {
        payload = JSON.parse(plaintext.toString("utf8"));
    } catch {
        throw new Error("Backup payload JSON geçersiz.");
    }

    if (requireTenantId(payload?.tenantId) !== header.tenantId ||
        normalizeSchemaVersion(payload?.schemaVersion) !== header.schemaVersion ||
        normalizeDate(payload?.createdAt).toISOString() !== header.createdAt) {
        throw new Error("Backup header ve payload metadata uyuşmuyor.");
    }

    assertSnapshot(payload.snapshot, header.tenantId);

    return {
        header: Object.freeze({ ...header }),
        snapshot: payload.snapshot
    };
}

module.exports = {
    MAGIC,
    FORMAT_VERSION,
    DEFAULT_MAX_BACKUP_BYTES,
    sha256Hex,
    normalizeKeyId,
    normalizeEncryptionKey,
    normalizeSchemaVersion,
    encodeBackup,
    decodeBackup
};
