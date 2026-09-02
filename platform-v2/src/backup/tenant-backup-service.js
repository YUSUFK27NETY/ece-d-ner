const { requireTenantId } = require("../tenant/tenant-id");
const { assertStorageProvider } = require("../storage/object-storage-provider");
const { buildBackupKey } = require("./backup-key");
const { encodeBackup, decodeBackup, sha256Hex } = require("./backup-codec");
const {
    buildManifestKey,
    buildBackupManifest,
    assertBackupManifest
} = require("./backup-manifest");

function assertSnapshotProvider(provider) {
    const required = ["exportTenant", "validateTenantSnapshot", "restoreTenant"];

    for (const method of required) {
        if (!provider || typeof provider[method] !== "function") {
            throw new TypeError(`Snapshot provider ${method} metodunu uygulamalı.`);
        }
    }

    return provider;
}

function assertKeyring(keyring) {
    if (!keyring || typeof keyring.getActiveKey !== "function" ||
        typeof keyring.getKey !== "function") {
        throw new TypeError("Backup keyring getActiveKey/getKey metodlarını uygulamalı.");
    }

    return keyring;
}

function getObjectBody(result) {
    if (Buffer.isBuffer(result)) {
        return result;
    }

    if (result && Buffer.isBuffer(result.body)) {
        return result.body;
    }

    if (result && typeof result.body === "string") {
        return Buffer.from(result.body, "utf8");
    }

    throw new Error("Storage provider geçerli object body döndürmedi.");
}

function createTenantBackupService({
    storageProvider,
    snapshotProvider,
    keyring,
    retentionDays = 30,
    allowReplaceRestore = false
}) {
    const storage = assertStorageProvider(storageProvider);
    const snapshots = assertSnapshotProvider(snapshotProvider);
    const keys = assertKeyring(keyring);

    if (!Number.isInteger(Number(retentionDays)) || Number(retentionDays) < 1 || Number(retentionDays) > 3650) {
        throw new TypeError("Backup retentionDays 1-3650 arasında olmalı.");
    }

    async function readAndVerify({ tenantId: rawTenantId, objectKey }) {
        const tenantId = requireTenantId(rawTenantId);
        const manifestKey = buildManifestKey(objectKey);
        const [objectResult, manifestResult] = await Promise.all([
            storage.getObject({ key: objectKey }),
            storage.getObject({ key: manifestKey })
        ]);
        const body = getObjectBody(objectResult);
        const manifestBody = getObjectBody(manifestResult);
        let manifest;

        try {
            manifest = JSON.parse(manifestBody.toString("utf8"));
        } catch {
            throw new Error("Backup manifest JSON geçersiz.");
        }

        assertBackupManifest(manifest, tenantId);

        if (manifest.objectKey !== objectKey || manifest.sizeBytes !== body.length ||
            manifest.containerSha256 !== sha256Hex(body)) {
            throw new Error("Backup manifest ile object bütünlüğü uyuşmuyor.");
        }

        const decoded = decodeBackup({
            body,
            expectedTenantId: tenantId,
            keyResolver: keyId => keys.getKey(keyId)
        });

        if (decoded.header.plaintextSha256 !== manifest.plaintextSha256 ||
            decoded.header.keyId !== manifest.keyId ||
            decoded.header.schemaVersion !== manifest.schemaVersion) {
            throw new Error("Backup codec metadata ile manifest uyuşmuyor.");
        }

        const validation = await snapshots.validateTenantSnapshot({
            tenantId,
            snapshot: decoded.snapshot,
            schemaVersion: decoded.header.schemaVersion
        });

        if (validation !== true) {
            throw new Error("Backup snapshot doğrulaması açık şekilde true dönmedi.");
        }

        return {
            manifest: Object.freeze({ ...manifest }),
            header: decoded.header,
            snapshot: decoded.snapshot
        };
    }

    return Object.freeze({
        async createBackup({
            tenantId: rawTenantId,
            schemaVersion = 1,
            now = new Date()
        }) {
            const tenantId = requireTenantId(rawTenantId);
            const snapshot = await snapshots.exportTenant({ tenantId });
            const sourceValidation = await snapshots.validateTenantSnapshot({ tenantId, snapshot, schemaVersion });

            if (sourceValidation !== true) {
                throw new Error("Kaynak tenant snapshot doğrulaması başarısız.");
            }

            const active = keys.getActiveKey();
            const encoded = encodeBackup({
                tenantId,
                snapshot,
                encryptionKey: active.key,
                keyId: active.keyId,
                schemaVersion,
                createdAt: now
            });
            const objectKey = buildBackupKey({ tenantId, date: now });
            const manifestKey = buildManifestKey(objectKey);
            let objectWritten = false;

            try {
                await storage.putObject({
                    key: objectKey,
                    body: encoded.body,
                    contentType: "application/octet-stream",
                    metadata: {
                        tenantId,
                        keyId: encoded.header.keyId,
                        schemaVersion: String(encoded.header.schemaVersion),
                        formatVersion: String(encoded.header.formatVersion)
                    }
                });
                objectWritten = true;

                const stored = getObjectBody(await storage.getObject({ key: objectKey }));
                const decoded = decodeBackup({
                    body: stored,
                    expectedTenantId: tenantId,
                    keyResolver: keyId => keys.getKey(keyId)
                });

                if (decoded.header.plaintextSha256 !== encoded.header.plaintextSha256) {
                    throw new Error("Yazılan backup doğrulaması kaynak checksum ile uyuşmuyor.");
                }

                const manifest = buildBackupManifest({
                    tenantId,
                    objectKey,
                    header: decoded.header,
                    body: stored,
                    verifiedAt: new Date()
                });

                await storage.putObject({
                    key: manifestKey,
                    body: Buffer.from(JSON.stringify(manifest), "utf8"),
                    contentType: "application/json",
                    metadata: {
                        tenantId,
                        status: "verified"
                    }
                });

                return manifest;
            } catch (error) {
                if (objectWritten) {
                    await Promise.allSettled([
                        storage.deleteObject({ key: objectKey }),
                        storage.deleteObject({ key: manifestKey })
                    ]);
                }

                throw error;
            }
        },

        async verifyBackup({ tenantId, objectKey }) {
            const verified = await readAndVerify({ tenantId, objectKey });

            return {
                valid: true,
                manifest: verified.manifest,
                header: verified.header
            };
        },

        async restoreBackup({
            tenantId: rawTenantId,
            objectKey,
            apply = false,
            confirmationTenantId = null,
            mode = "merge"
        }) {
            const tenantId = requireTenantId(rawTenantId);
            const safeMode = String(mode ?? "").trim().toLowerCase();

            if (!new Set(["merge", "replace"]).has(safeMode)) {
                throw new TypeError("Restore mode merge veya replace olmalı.");
            }

            if (safeMode === "replace" && !allowReplaceRestore) {
                const error = new Error("Replace restore bu ortamda kapalı.");
                error.code = "REPLACE_RESTORE_DISABLED";
                throw error;
            }

            const verified = await readAndVerify({ tenantId, objectKey });

            if (apply !== true) {
                return {
                    applied: false,
                    dryRun: true,
                    tenantId,
                    mode: safeMode,
                    manifest: verified.manifest
                };
            }

            let confirmedTenantId;

            try {
                confirmedTenantId = requireTenantId(confirmationTenantId);
            } catch {
                const error = new Error("Restore apply için tenant doğrulaması gerekli.");
                error.code = "RESTORE_CONFIRMATION_FAILED";
                throw error;
            }

            if (confirmedTenantId !== tenantId) {
                const error = new Error("Restore apply için tenant doğrulaması başarısız.");
                error.code = "RESTORE_CONFIRMATION_FAILED";
                throw error;
            }

            const result = await snapshots.restoreTenant({
                tenantId,
                snapshot: verified.snapshot,
                schemaVersion: verified.header.schemaVersion,
                mode: safeMode
            });

            return {
                applied: true,
                dryRun: false,
                tenantId,
                mode: safeMode,
                manifest: verified.manifest,
                result: result ?? null
            };
        },

        retentionDays: Number(retentionDays)
    });
}

module.exports = {
    assertSnapshotProvider,
    assertKeyring,
    getObjectBody,
    createTenantBackupService
};
