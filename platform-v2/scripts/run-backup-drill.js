const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");
const { createBackupKeyringFromEnv } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { requireTenantId } = require("../src/tenant/tenant-id");

async function main() {
    const tenantId = requireTenantId(process.env.PLATFORM_BACKUP_DRILL_TENANT_ID);
    const firebase = createPlatformFirebase();
    const snapshotProvider = createFirestoreTenantSnapshotProvider({ db: firebase.db });
    const storageProvider = createR2ObjectStorageProvider(loadR2BackupConfig());
    const keyring = createBackupKeyringFromEnv();
    const backups = createTenantBackupService({
        storageProvider,
        snapshotProvider,
        keyring,
        retentionDays: 30,
        allowReplaceRestore: false
    });

    const manifest = await backups.createBackup({
        tenantId,
        schemaVersion: 1,
        now: new Date()
    });

    const verification = await backups.verifyBackup({
        tenantId,
        objectKey: manifest.objectKey
    });

    if (verification.valid !== true) {
        throw new Error("Backup verification açık şekilde true dönmedi.");
    }

    const dryRun = await backups.restoreBackup({
        tenantId,
        objectKey: manifest.objectKey,
        apply: false,
        mode: "merge"
    });

    if (dryRun.applied !== false || dryRun.dryRun !== true || dryRun.tenantId !== tenantId) {
        throw new Error("Restore dry-run güvenlik sözleşmesi başarısız.");
    }

    console.log(
        `BACKUP_DRILL_OK tenant=${tenantId} dryRun=true keyId=${verification.header.keyId} object=${manifest.objectKey}`
    );
}

main().catch(error => {
    console.error(`BACKUP_DRILL_FAILED code=${String(error?.code ?? "UNKNOWN").slice(0, 80)}`);
    process.exitCode = 1;
});
