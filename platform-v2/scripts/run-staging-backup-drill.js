const { requireTenantId } = require("../src/tenant/tenant-id");
const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { createBackupKeyringFromEnv } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");

function requireDrillTenant(value = process.env.PLATFORM_BACKUP_DRILL_TENANT_ID) {
    const tenantId = requireTenantId(value);
    if (!tenantId.startsWith("backup-drill-")) {
        const error = new Error("Backup drill yalnız backup-drill-* tenant kimliklerinde çalışır.");
        error.code = "BACKUP_DRILL_TENANT_REQUIRED";
        throw error;
    }
    return tenantId;
}

async function main() {
    const tenantId = requireDrillTenant();
    const schemaVersion = Number(process.env.PLATFORM_BACKUP_SCHEMA_VERSION || 1);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
        throw new TypeError("PLATFORM_BACKUP_SCHEMA_VERSION pozitif tam sayı olmalı.");
    }

    const { db } = createPlatformFirebase();
    const snapshotProvider = createFirestoreTenantSnapshotProvider({ db });
    const keyring = createBackupKeyringFromEnv();
    const storageProvider = createR2ObjectStorageProvider(loadR2BackupConfig());
    const backupService = createTenantBackupService({
        storageProvider,
        snapshotProvider,
        keyring,
        retentionDays: 30,
        allowReplaceRestore: false
    });

    const manifest = await backupService.createBackup({ tenantId, schemaVersion });
    const verified = await backupService.verifyBackup({
        tenantId,
        objectKey: manifest.objectKey
    });

    if (verified.valid !== true) {
        throw new Error("Backup verify true dönmedi.");
    }

    const dryRun = await backupService.restoreBackup({
        tenantId,
        objectKey: manifest.objectKey,
        apply: false,
        mode: "merge"
    });

    if (dryRun.applied !== false || dryRun.dryRun !== true) {
        throw new Error("Restore dry-run güvenlik beklentisi karşılanmadı.");
    }

    console.log(`BACKUP_DRILL_OK tenant=${tenantId}`);
    console.log(`BACKUP_OBJECT=${manifest.objectKey}`);
    console.log(`BACKUP_KEY_ID=${manifest.keyId}`);
    console.log(`BACKUP_SCHEMA_VERSION=${manifest.schemaVersion}`);
    console.log("BACKUP_VERIFY_OK=true");
    console.log("RESTORE_DRY_RUN_OK=true");
}

main().catch(error => {
    console.error(`BACKUP_DRILL_FAILED code=${String(error?.code ?? "UNKNOWN").slice(0, 80)}`);
    process.exitCode = 1;
});
