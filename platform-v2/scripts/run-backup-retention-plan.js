"use strict";

const { requireTenantId } = require("../src/tenant/tenant-id");
const {
    normalizeRetentionDays
} = require("../src/backup/retention-policy");
const {
    createBackupRetentionService
} = require("../src/backup/retention-service");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const {
    createR2ObjectStorageProvider
} = require("../src/storage/r2-object-storage-provider");

const RETENTION_TENANT_ENV = "PLATFORM_BACKUP_RETENTION_TENANT_ID";
const RETENTION_DAYS_ENV = "PLATFORM_BACKUP_RETENTION_DAYS";
const DEFAULT_RETENTION_DAYS = 30;

function sanitizeCode(value) {
    return String(value ?? "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 80);
}

function requireDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError("Backup retention plan tarihi geçersiz.");
    }
    return date;
}

function projectPlan(plan, tenantId, retentionDays) {
    if (!plan || typeof plan !== "object" || Array.isArray(plan) ||
        plan.tenantId !== tenantId ||
        plan.retentionDays !== retentionDays ||
        !Array.isArray(plan.expired) ||
        !Array.isArray(plan.retained) ||
        !Array.isArray(plan.invalid)) {
        throw new TypeError("Backup retention plan sonucu geçersiz.");
    }

    return Object.freeze({
        tenantId,
        retentionDays,
        expiredCount: plan.expired.length,
        retainedCount: plan.retained.length,
        invalidCount: plan.invalid.length
    });
}

async function runBackupRetentionPlan({
    env = process.env,
    retentionService = null,
    now = new Date(),
    logger = console
} = {}) {
    const tenantId = requireTenantId(env[RETENTION_TENANT_ENV]);
    const retentionDays = normalizeRetentionDays(
        env[RETENTION_DAYS_ENV] === undefined ||
        String(env[RETENTION_DAYS_ENV]).trim() === ""
            ? DEFAULT_RETENTION_DAYS
            : env[RETENTION_DAYS_ENV]
    );
    const safeNow = requireDate(now);

    let service = retentionService;
    if (service === null) {
        const storageProvider = createR2ObjectStorageProvider(
            loadR2BackupConfig(env)
        );
        service = createBackupRetentionService({ storageProvider });
    }
    if (!service || typeof service.planTenantRetention !== "function") {
        throw new TypeError("Backup retention plan service geçersiz.");
    }

    const plan = await service.planTenantRetention({
        tenantId,
        retentionDays,
        now: safeNow
    });
    const summary = projectPlan(plan, tenantId, retentionDays);

    if (!logger || typeof logger.log !== "function") {
        throw new TypeError("Backup retention logger geçersiz.");
    }
    logger.log(
        "BACKUP_RETENTION_PLAN_OK " +
        `tenant=${summary.tenantId} ` +
        `retentionDays=${summary.retentionDays} ` +
        `expired=${summary.expiredCount} ` +
        `retained=${summary.retainedCount} ` +
        `invalid=${summary.invalidCount}`
    );

    return summary;
}

async function main() {
    try {
        await runBackupRetentionPlan();
    } catch (error) {
        const code = sanitizeCode(error?.code || error?.name || "UNKNOWN");
        console.error(`BACKUP_RETENTION_PLAN_FAILED code=${code}`);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void main();
}

module.exports = {
    RETENTION_TENANT_ENV,
    RETENTION_DAYS_ENV,
    DEFAULT_RETENTION_DAYS,
    projectPlan,
    runBackupRetentionPlan,
    sanitizeCode
};
