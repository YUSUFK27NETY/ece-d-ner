const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { createBackupKeyring } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { createBackupRetentionService } = require("../src/backup/retention-service");

function createMemoryStorage() {
    const objects = new Map();
    return {
        objects,
        async putObject({ key, body }) { objects.set(key, Buffer.from(body)); },
        async getObject({ key }) {
            if (!objects.has(key)) throw Object.assign(new Error("not found"), { code: "NOT_FOUND" });
            return { body: Buffer.from(objects.get(key)) };
        },
        async listObjects({ prefix = "" } = {}) {
            return [...objects.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key }));
        },
        async deleteObject({ key }) { objects.delete(key); }
    };
}

function createSnapshotProvider() {
    return {
        async exportTenant({ tenantId }) { return { tenantId, collections: {} }; },
        async validateTenantSnapshot({ tenantId, snapshot }) { return snapshot.tenantId === tenantId; },
        async restoreTenant() { return { writes: 0 }; }
    };
}

test("retention plan expired ve retained backup'ları tenant bazında ayırır", async () => {
    const storage = createMemoryStorage();
    const keyring = createBackupKeyring({
        activeKeyId: "key-a",
        keys: { "key-a": crypto.randomBytes(32).toString("base64") }
    });
    const backup = createTenantBackupService({
        storageProvider: storage,
        snapshotProvider: createSnapshotProvider(),
        keyring
    });
    const oldManifest = await backup.createBackup({
        tenantId: "tenant-a",
        now: new Date("2026-08-01T00:00:00.000Z")
    });
    const recentManifest = await backup.createBackup({
        tenantId: "tenant-a",
        now: new Date("2026-09-01T00:00:00.000Z")
    });
    const retention = createBackupRetentionService({ storageProvider: storage });
    const plan = await retention.planTenantRetention({
        tenantId: "tenant-a",
        retentionDays: 7,
        now: new Date("2026-09-02T00:00:00.000Z")
    });

    assert.deepEqual(plan.expired.map(item => item.objectKey), [oldManifest.objectKey]);
    assert.deepEqual(plan.retained.map(item => item.objectKey), [recentManifest.objectKey]);
});

test("retention delete tenant confirmation olmadan çalışmaz", async () => {
    const storage = createMemoryStorage();
    const retention = createBackupRetentionService({ storageProvider: storage });

    await assert.rejects(
        retention.applyTenantRetention({
            tenantId: "tenant-a",
            confirmationTenantId: "tenant-b"
        }),
        error => error.code === "RETENTION_CONFIRMATION_FAILED"
    );
});

test("retention apply yalnız expired object ve manifest çiftini siler", async () => {
    const storage = createMemoryStorage();
    const keyring = createBackupKeyring({
        activeKeyId: "key-a",
        keys: { "key-a": crypto.randomBytes(32).toString("base64") }
    });
    const backup = createTenantBackupService({
        storageProvider: storage,
        snapshotProvider: createSnapshotProvider(),
        keyring
    });
    const oldManifest = await backup.createBackup({
        tenantId: "tenant-a",
        now: new Date("2026-08-01T00:00:00.000Z")
    });
    const recentManifest = await backup.createBackup({
        tenantId: "tenant-a",
        now: new Date("2026-09-01T00:00:00.000Z")
    });
    const retention = createBackupRetentionService({ storageProvider: storage });
    const result = await retention.applyTenantRetention({
        tenantId: "tenant-a",
        confirmationTenantId: "tenant-a",
        retentionDays: 7,
        now: new Date("2026-09-02T00:00:00.000Z")
    });

    assert.equal(result.deleted.length, 1);
    assert.equal(storage.objects.has(oldManifest.objectKey), false);
    assert.equal(storage.objects.has(oldManifest.manifestKey), false);
    assert.equal(storage.objects.has(recentManifest.objectKey), true);
    assert.equal(storage.objects.has(recentManifest.manifestKey), true);
});
