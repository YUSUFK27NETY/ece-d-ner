const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");
const { createBackupKeyringFromEnv } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { requireTenantId } = require("../src/tenant/tenant-id");

let drillStage = "tenant-id";

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
    const code = String(error?.code ?? "UNKNOWN").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
    const kind = error instanceof TypeError ? "TYPE_ERROR" : "ERROR";
    console.error(`BACKUP_DRILL_FAILED stage=${drillStage} code=${code} kind=${kind}`);
    process.exitCode = 1;
});
