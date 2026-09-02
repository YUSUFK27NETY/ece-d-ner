const { normalizeKeyId, normalizeEncryptionKey } = require("./backup-codec");

function createBackupKeyring({ activeKeyId, keys }) {
    const safeActiveKeyId = normalizeKeyId(activeKeyId);

    if (!keys || typeof keys !== "object" || Array.isArray(keys)) {
        throw new TypeError("Backup keyring keys nesnesi gerekli.");
    }

    const normalized = new Map();

    for (const [rawKeyId, rawKey] of Object.entries(keys)) {
        const keyId = normalizeKeyId(rawKeyId);

        if (normalized.has(keyId)) {
            throw new TypeError("Backup keyring içinde tekrar eden keyId var.");
        }

        normalized.set(keyId, normalizeEncryptionKey(rawKey));
    }

    if (!normalized.has(safeActiveKeyId)) {
        throw new TypeError("Aktif backup keyId keyring içinde bulunamadı.");
    }

    return Object.freeze({
        activeKeyId: safeActiveKeyId,
        keyIds: Object.freeze([...normalized.keys()]),
        getActiveKey() {
            return {
                keyId: safeActiveKeyId,
                key: Buffer.from(normalized.get(safeActiveKeyId))
            };
        },
        getKey(rawKeyId) {
            const keyId = normalizeKeyId(rawKeyId);
            const key = normalized.get(keyId);

            if (!key) {
                const error = new Error("Backup encryption key bulunamadı.");
                error.code = "BACKUP_KEY_NOT_FOUND";
                throw error;
            }

            return Buffer.from(key);
        }
    });
}

function createBackupKeyringFromEnv({
    activeKeyId = process.env.PLATFORM_BACKUP_ACTIVE_KEY_ID,
    keysJson = process.env.PLATFORM_BACKUP_KEYS_JSON
} = {}) {
    if (!String(keysJson ?? "").trim()) {
        throw new TypeError("PLATFORM_BACKUP_KEYS_JSON tanımlı değil.");
    }

    let keys;

    try {
        keys = JSON.parse(keysJson);
    } catch {
        throw new TypeError("PLATFORM_BACKUP_KEYS_JSON geçerli JSON olmalı.");
    }

    return createBackupKeyring({ activeKeyId, keys });
}

module.exports = {
    createBackupKeyring,
    createBackupKeyringFromEnv
};
