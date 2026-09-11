const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");
const { createBackupKeyringFromEnv } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { requireTenantId } = require("../src/tenant/tenant-id");

let drillStage = "tenant-id";

function sanitizeCode(value) {
    return String(value ?? "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

function classifyKeyringTypeError(error) {
    const message = String(error?.message ?? "");
    const known = [
        ["PLATFORM_BACKUP_KEYS_JSON tanımlı değil.", "BACKUP_KEYS_JSON_MISSING"],
        ["PLATFORM_BACKUP_KEYS_JSON geçerli JSON olmalı.", "BACKUP_KEYS_JSON_INVALID"],
        ["Backup keyring keys nesnesi gerekli.", "BACKUP_KEYRING_KEYS_INVALID"],
        ["Geçerli bir backup keyId gerekli.", "BACKUP_KEY_ID_INVALID"],
        ["Backup keyring içinde tekrar eden keyId var.", "BACKUP_KEY_ID_DUPLICATE"],
        ["Backup encryption key geçerli base64 olmalı.", "BACKUP_KEY_INVALID_BASE64"],
        ["Backup encryption key tam olarak 32 byte olmalı.", "BACKUP_KEY_INVALID_LENGTH"],
        ["Aktif backup keyId keyring içinde bulunamadı.", "BACKUP_ACTIVE_KEY_NOT_FOUND"]
    ];
    return known.find(([expected]) => message === expected)?.[1] ?? "BACKUP_KEYRING_INVALID";
}

function safeFailureCode(error, stage) {
    if (error?.code) return sanitizeCode(error.code);
    if (stage === "keyring" && error instanceof TypeError) {
        return classifyKeyringTypeError(error);
    }
    return "UNKNOWN";
}

async function main() {
    drillStage = "tenant-id";
    const tenantId = requireTenantId(process.env.PLATFORM_BACKUP_DRILL_TENANT_ID);

    drillStage = "firebase";
    const firebase = createPlatformFirebase();

    drillStage = "snapshot-provider";
    const snapshotProvider = createFirestoreTenantSnapshotProvider({ db: firebase.db });

    drillStage = "r2-config";
    const storageProvider = createR2ObjectStorageProvider(loadR2BackupConfig());

    drillStage = "keyring";
    const keyring = createBackupKeyringFromEnv();

    drillStage = "backup-service";
    const backups = createTenantBackupService({
        storageProvider,
        snapshotProvider,
        keyring,
        retentionDays: 30,
        allowReplaceRestore: false
    });

    drillStage = "create-backup";
    const manifest = await backups.createBackup({
        tenantId,
        schemaVersion: 1,
        now: new Date()
    });

    drillStage = "verify-backup";
    const verification = await backups.verifyBackup({
        tenantId,
        objectKey: manifest.objectKey
    });

    if (verification.valid !== true) {
        throw new Error("Backup verification açık şekilde true dönmedi.");
    }

    drillStage = "restore-dry-run";
    const dryRun = await backups.restoreBackup({
        tenantId,
        objectKey: manifest.objectKey,
        apply: false,
        mode: "merge"
    });

    if (dryRun.applied !== false || dryRun.dryRun !== true || dryRun.tenantId !== tenantId) {
        throw new Error("Restore dry-run güvenlik sözleşmesi başarısız.");
    }

    drillStage = "complete";
    console.log(
        `BACKUP_DRILL_OK tenant=${tenantId} dryRun=true keyId=${verification.header.keyId} object=${manifest.objectKey}`
    );
}

main().catch(error => {
    const code = safeFailureCode(error, drillStage);
    const kind = error instanceof TypeError ? "TYPE_ERROR" : "ERROR";
    console.error(`BACKUP_DRILL_FAILED stage=${drillStage} code=${code} kind=${kind}`);
    process.exitCode = 1;
});
