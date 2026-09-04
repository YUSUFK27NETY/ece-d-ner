const crypto = require("node:crypto");

const { requireTenantId } = require("../src/tenant/tenant-id");
const { tenantSettingsDocument } = require("../src/firestore/tenant-paths");
const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { createBackupKeyringFromEnv } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");

const DRILL_TENANT_PREFIX = "backup-drill-";
const DRILL_MARKER_ID = "phase5-backup-restore-drill";

function createDrillError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireDrillTenant(value = process.env.PLATFORM_BACKUP_DRILL_TENANT_ID) {
    const tenantId = requireTenantId(value);
    if (!tenantId.startsWith(DRILL_TENANT_PREFIX)) {
        throw createDrillError(
            "Backup drill yalnız backup-drill-* tenant kimliklerinde çalışır.",
            "BACKUP_DRILL_TENANT_REQUIRED"
        );
    }
    return tenantId;
}

function normalizeSchemaVersion(value = 1) {
    const schemaVersion = Number(value);
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || schemaVersion > 1_000_000) {
        throw new TypeError("PLATFORM_BACKUP_SCHEMA_VERSION pozitif tam sayı olmalı.");
    }
    return schemaVersion;
}

function expectedStagingConfirmation(tenantId) {
    return `staging:${requireDrillTenant(tenantId)}:restore-apply`;
}

function resolveApplyAuthorization({ tenantId: rawTenantId, env = process.env }) {
    const tenantId = requireDrillTenant(rawTenantId);
    const rawApply = String(env.PLATFORM_BACKUP_DRILL_APPLY ?? "").trim();

    if (!rawApply || rawApply === "false") {
        return Object.freeze({ apply: false, confirmationTenantId: null });
    }

    if (rawApply !== "true") {
        throw createDrillError(
            "PLATFORM_BACKUP_DRILL_APPLY yalnız true veya false olabilir.",
            "BACKUP_DRILL_APPLY_FLAG_INVALID"
        );
    }

    if (String(env.PLATFORM_BACKUP_DRILL_ENVIRONMENT ?? "").trim() !== "staging") {
        throw createDrillError(
            "Restore apply yalnız açık staging ortam onayıyla çalışır.",
            "BACKUP_DRILL_STAGING_REQUIRED"
        );
    }

    let confirmationTenantId;
    try {
        confirmationTenantId = requireTenantId(env.PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID);
    } catch {
        throw createDrillError(
            "Restore apply için exact tenant onayı gerekli.",
            "BACKUP_DRILL_TENANT_CONFIRMATION_FAILED"
        );
    }

    if (confirmationTenantId !== tenantId) {
        throw createDrillError(
            "Restore apply tenant onayı hedef tenant ile uyuşmuyor.",
            "BACKUP_DRILL_TENANT_CONFIRMATION_FAILED"
        );
    }

    if (String(env.PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION ?? "").trim() !==
        expectedStagingConfirmation(tenantId)) {
        throw createDrillError(
            "Restore apply staging onayı hedef tenant ile uyuşmuyor.",
            "BACKUP_DRILL_STAGING_CONFIRMATION_FAILED"
        );
    }

    return Object.freeze({ apply: true, confirmationTenantId });
}

function assertMarkerSnapshot(snapshot, expected) {
    const data = snapshot?.exists === true && typeof snapshot.data === "function"
        ? snapshot.data()
        : null;

    if (!data || data.tenantId !== expected.tenantId || data.drillRunId !== expected.drillRunId ||
        data.markerValue !== expected.markerValue || data.state !== expected.state) {
        throw createDrillError(
            "Backup drill marker doğrulaması başarısız.",
            "BACKUP_DRILL_MARKER_VERIFY_FAILED"
        );
    }

    return data;
}

async function runStagingBackupDrill({
    tenantId: rawTenantId,
    schemaVersion = 1,
    env = process.env,
    db,
    backupService,
    now = () => new Date(),
    randomUUID = () => crypto.randomUUID()
}) {
    const tenantId = requireDrillTenant(rawTenantId);
    const safeSchemaVersion = normalizeSchemaVersion(schemaVersion);
    const authorization = resolveApplyAuthorization({ tenantId, env });

    if (!db || typeof db.doc !== "function") {
        throw new TypeError("Backup drill için Firestore db gerekli.");
    }
    if (!backupService || typeof backupService.createBackup !== "function" ||
        typeof backupService.verifyBackup !== "function" ||
        typeof backupService.restoreBackup !== "function") {
        throw new TypeError("Backup drill için backup service gerekli.");
    }

    const markerRef = db.doc(tenantSettingsDocument(tenantId, DRILL_MARKER_ID));
    let sourceMarker = null;

    if (authorization.apply) {
        const startedAt = now();
        if (!(startedAt instanceof Date) || Number.isNaN(startedAt.getTime())) {
            throw new TypeError("Backup drill clock geçersiz.");
        }

        const drillRunId = String(randomUUID());
        if (!/^[a-f0-9-]{16,64}$/i.test(drillRunId)) {
            throw new TypeError("Backup drill run id geçersiz.");
        }

        sourceMarker = Object.freeze({
            tenantId,
            drillRunId,
            markerValue: `backup-source:${drillRunId}`,
            state: "backup-source",
            updatedAt: startedAt.toISOString()
        });
        await markerRef.set(sourceMarker, { merge: true });
        assertMarkerSnapshot(await markerRef.get(), sourceMarker);
    }

    const manifest = await backupService.createBackup({
        tenantId,
        schemaVersion: safeSchemaVersion
    });
    const verified = await backupService.verifyBackup({
        tenantId,
        objectKey: manifest.objectKey
    });

    if (verified.valid !== true) {
        throw createDrillError("Backup verify true dönmedi.", "BACKUP_DRILL_VERIFY_FAILED");
    }

    const dryRun = await backupService.restoreBackup({
        tenantId,
        objectKey: manifest.objectKey,
        apply: false,
        mode: "merge"
    });

    if (dryRun.applied !== false || dryRun.dryRun !== true) {
        throw createDrillError(
            "Restore dry-run güvenlik beklentisi karşılanmadı.",
            "BACKUP_DRILL_DRY_RUN_FAILED"
        );
    }

    if (!authorization.apply) {
        return Object.freeze({
            tenantId,
            manifest,
            verified,
            dryRun,
            restoreApply: null,
            applyRequested: false,
            markerRestored: false
        });
    }

    const mutatedAt = now();
    if (!(mutatedAt instanceof Date) || Number.isNaN(mutatedAt.getTime())) {
        throw new TypeError("Backup drill clock geçersiz.");
    }
    const mutatedMarker = {
        ...sourceMarker,
        markerValue: `mutated-after-backup:${sourceMarker.drillRunId}`,
        state: "mutated-after-backup",
        updatedAt: mutatedAt.toISOString()
    };
    await markerRef.set(mutatedMarker, { merge: true });
    assertMarkerSnapshot(await markerRef.get(), mutatedMarker);

    const restoreApply = await backupService.restoreBackup({
        tenantId,
        objectKey: manifest.objectKey,
        apply: true,
        confirmationTenantId: authorization.confirmationTenantId,
        mode: "merge"
    });

    if (restoreApply.applied !== true || restoreApply.dryRun !== false || restoreApply.mode !== "merge") {
        throw createDrillError(
            "Restore apply güvenlik beklentisi karşılanmadı.",
            "BACKUP_DRILL_RESTORE_APPLY_FAILED"
        );
    }

    assertMarkerSnapshot(await markerRef.get(), sourceMarker);

    return Object.freeze({
        tenantId,
        manifest,
        verified,
        dryRun,
        restoreApply,
        applyRequested: true,
        markerRestored: true
    });
}

async function main() {
    const tenantId = requireDrillTenant();
    const schemaVersion = normalizeSchemaVersion(process.env.PLATFORM_BACKUP_SCHEMA_VERSION || 1);
    resolveApplyAuthorization({ tenantId });
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
    const result = await runStagingBackupDrill({
        tenantId,
        schemaVersion,
        db,
        backupService
    });

    console.log(`BACKUP_DRILL_OK tenant=${tenantId}`);
    console.log(`BACKUP_OBJECT=${result.manifest.objectKey}`);
    console.log(`BACKUP_KEY_ID=${result.manifest.keyId}`);
    console.log(`BACKUP_SCHEMA_VERSION=${result.manifest.schemaVersion}`);
    console.log("BACKUP_VERIFY_OK=true");
    console.log("RESTORE_DRY_RUN_OK=true");

    if (result.applyRequested) {
        console.log("BACKUP_APPLY_DRILL_OK=true");
        console.log("RESTORE_APPLY_OK=true");
        console.log("MARKER_RESTORED_OK=true");
    } else {
        console.log("RESTORE_APPLY_SKIPPED=true");
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(`BACKUP_DRILL_FAILED code=${String(error?.code ?? "UNKNOWN").slice(0, 80)}`);
        process.exitCode = 1;
    });
}

module.exports = {
    DRILL_TENANT_PREFIX,
    DRILL_MARKER_ID,
    requireDrillTenant,
    normalizeSchemaVersion,
    expectedStagingConfirmation,
    resolveApplyAuthorization,
    assertMarkerSnapshot,
    runStagingBackupDrill,
    main
};
