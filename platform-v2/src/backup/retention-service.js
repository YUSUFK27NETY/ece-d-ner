const { requireTenantId } = require("../tenant/tenant-id");
const { assertStorageProvider } = require("../storage/object-storage-provider");
const { tenantBackupPrefix } = require("./backup-key");
const { assertBackupManifest } = require("./backup-manifest");
const { isExpiredBackup, normalizeRetentionDays } = require("./retention-policy");
const { getObjectBody } = require("./tenant-backup-service");

function normalizeListedObjects(result) {
    const objects = Array.isArray(result) ? result : result?.objects;

    if (!Array.isArray(objects)) {
        throw new Error("Storage provider listObjects geçerli object listesi döndürmedi.");
    }

    return objects.map(item => {
        if (typeof item === "string") {
            return { key: item };
        }

        if (!item || typeof item !== "object") {
            throw new Error("Storage provider list item geçersiz.");
        }

        const key = String(item.key ?? "").trim();
        if (!key) throw new Error("Storage provider list item key eksik.");
        return { ...item, key };
    });
}

function createBackupRetentionService({ storageProvider }) {
    const storage = assertStorageProvider(storageProvider);

    async function planTenantRetention({
        tenantId: rawTenantId,
        retentionDays = 30,
        now = new Date()
    }) {
        const tenantId = requireTenantId(rawTenantId);
        const days = normalizeRetentionDays(retentionDays);
        const prefix = tenantBackupPrefix(tenantId);
        const listed = normalizeListedObjects(await storage.listObjects({ prefix }));
        const manifestObjects = listed.filter(item => item.key.endsWith(".enc.manifest.json"));
        const expired = [];
        const retained = [];
        const invalid = [];

        for (const object of manifestObjects) {
            try {
                const body = getObjectBody(await storage.getObject({ key: object.key }));
                const manifest = JSON.parse(body.toString("utf8"));
                assertBackupManifest(manifest, tenantId);

                if (isExpiredBackup({ createdAt: manifest.createdAt, now, retentionDays: days })) {
                    expired.push({ objectKey: manifest.objectKey, manifestKey: manifest.manifestKey });
                } else {
                    retained.push({ objectKey: manifest.objectKey, manifestKey: manifest.manifestKey });
                }
            } catch (error) {
                invalid.push({
                    manifestKey: object.key,
                    code: String(error?.code ?? "INVALID_MANIFEST").slice(0, 80)
                });
            }
        }

        return Object.freeze({
            tenantId,
            retentionDays: days,
            expired: Object.freeze(expired),
            retained: Object.freeze(retained),
            invalid: Object.freeze(invalid)
        });
    }

    async function applyTenantRetention({
        tenantId: rawTenantId,
        retentionDays = 30,
        now = new Date(),
        confirmationTenantId = null
    }) {
        const tenantId = requireTenantId(rawTenantId);
        let confirmed;

        try {
            confirmed = requireTenantId(confirmationTenantId);
        } catch {
            const error = new Error("Retention apply için tenant doğrulaması gerekli.");
            error.code = "RETENTION_CONFIRMATION_FAILED";
            throw error;
        }

        if (confirmed !== tenantId) {
            const error = new Error("Retention apply için tenant doğrulaması başarısız.");
            error.code = "RETENTION_CONFIRMATION_FAILED";
            throw error;
        }

        const plan = await planTenantRetention({ tenantId, retentionDays, now });

        if (plan.invalid.length > 0) {
            const error = new Error("Geçersiz manifest bulunduğu için retention delete durduruldu.");
            error.code = "RETENTION_INVALID_MANIFEST";
            throw error;
        }

        const deleted = [];
        for (const item of plan.expired) {
            await storage.deleteObject({ key: item.objectKey });
            await storage.deleteObject({ key: item.manifestKey });
            deleted.push(item);
        }

        return Object.freeze({
            tenantId,
            deleted: Object.freeze(deleted),
            retained: plan.retained
        });
    }

    return Object.freeze({
        planTenantRetention,
        applyTenantRetention
    });
}

module.exports = {
    normalizeListedObjects,
    createBackupRetentionService
};
