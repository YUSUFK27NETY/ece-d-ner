const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createBackupKeyring } = require("../src/backup/backup-keyring");
const { createTenantBackupService } = require("../src/backup/tenant-backup-service");
const { createFirestoreTenantSnapshotProvider } = require("../src/firestore/firestore-tenant-snapshot-provider");
const { tenantSettingsDocument } = require("../src/firestore/tenant-paths");
const {
    DRILL_MARKER_ID,
    requireDrillTenant,
    expectedStagingConfirmation,
    resolveApplyAuthorization,
    runStagingBackupDrill
} = require("../scripts/run-staging-backup-drill");

function createMemoryStorage() {
    const objects = new Map();

    return {
        objects,
        async putObject({ key, body }) {
            objects.set(key, Buffer.from(body));
        },
        async getObject({ key }) {
            if (!objects.has(key)) {
                const error = new Error("not found");
                error.code = "NOT_FOUND";
                throw error;
            }
            return { body: Buffer.from(objects.get(key)) };
        },
        async listObjects({ prefix = "" } = {}) {
            return [...objects.keys()].filter(key => key.startsWith(prefix));
        },
        async deleteObject({ key }) {
            objects.delete(key);
        }
    };
}

function createFakeFirestore(tenantId) {
    const data = new Map([
        [`platformTenants/${tenantId}`, { tenantId, displayName: "Backup Drill Staging" }]
    ]);
    const directWrites = [];
    const batchWrites = [];

    function mergeAtPath(path, value, options) {
        const existing = options?.merge === true ? data.get(path) || {} : {};
        data.set(path, { ...existing, ...value });
    }

    function doc(path) {
        return {
            path,
            async get() {
                return {
                    exists: data.has(path),
                    id: path.split("/").at(-1),
                    data: () => data.get(path)
                };
            },
            async set(value, options) {
                directWrites.push({ path, value, options });
                mergeAtPath(path, value, options);
            }
        };
    }

    return {
        data,
        directWrites,
        batchWrites,
        doc,
        collection(path) {
            return {
                doc(id) {
                    return doc(`${path}/${id}`);
                },
                async get() {
                    const prefix = `${path}/`;
                    const docs = [];
                    for (const [key, value] of data.entries()) {
                        if (!key.startsWith(prefix)) continue;
                        const id = key.slice(prefix.length);
                        if (id.includes("/")) continue;
                        docs.push({ id, data: () => value });
                    }
                    return { docs };
                }
            };
        },
        batch() {
            const pending = [];
            return {
                set(ref, value, options) {
                    pending.push({ ref, value, options });
                },
                async commit() {
                    for (const write of pending) {
                        batchWrites.push({ path: write.ref.path, value: write.value, options: write.options });
                        mergeAtPath(write.ref.path, write.value, write.options);
                    }
                }
            };
        }
    };
}

function createFixture(tenantId = "backup-drill-staging") {
    const db = createFakeFirestore(tenantId);
    const storage = createMemoryStorage();
    const snapshotProvider = createFirestoreTenantSnapshotProvider({
        db,
        now: () => new Date("2026-09-04T10:00:00.000Z")
    });
    const keyring = createBackupKeyring({
        activeKeyId: "staging-test-key",
        keys: { "staging-test-key": crypto.randomBytes(32).toString("base64") }
    });
    const backupService = createTenantBackupService({
        storageProvider: storage,
        snapshotProvider,
        keyring,
        allowReplaceRestore: false
    });

    return { tenantId, db, storage, backupService };
}

function applyEnv(tenantId = "backup-drill-staging") {
    return {
        PLATFORM_BACKUP_DRILL_APPLY: "true",
        PLATFORM_BACKUP_DRILL_ENVIRONMENT: "staging",
        PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID: tenantId,
        PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION: expectedStagingConfirmation(tenantId)
    };
}

test("staging drill yalnız backup-drill-* tenant kimliğini kabul eder", () => {
    assert.equal(requireDrillTenant("backup-drill-staging"), "backup-drill-staging");
    assert.throws(
        () => requireDrillTenant("customer-production"),
        error => error.code === "BACKUP_DRILL_TENANT_REQUIRED"
    );
});

test("restore apply varsayılan kapalıdır ve geçersiz flag fail-closed olur", () => {
    assert.deepEqual(
        resolveApplyAuthorization({ tenantId: "backup-drill-staging", env: {} }),
        { apply: false, confirmationTenantId: null }
    );
    assert.throws(
        () => resolveApplyAuthorization({
            tenantId: "backup-drill-staging",
            env: { PLATFORM_BACKUP_DRILL_APPLY: "TRUE" }
        }),
        error => error.code === "BACKUP_DRILL_APPLY_FLAG_INVALID"
    );
});

test("restore apply staging ve exact tenant onaylarının tamamını zorunlu tutar", () => {
    const tenantId = "backup-drill-staging";

    assert.throws(
        () => resolveApplyAuthorization({
            tenantId,
            env: { ...applyEnv(tenantId), PLATFORM_BACKUP_DRILL_ENVIRONMENT: "production" }
        }),
        error => error.code === "BACKUP_DRILL_STAGING_REQUIRED"
    );
    assert.throws(
        () => resolveApplyAuthorization({
            tenantId,
            env: { ...applyEnv(tenantId), PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID: "backup-drill-other" }
        }),
        error => error.code === "BACKUP_DRILL_TENANT_CONFIRMATION_FAILED"
    );
    assert.throws(
        () => resolveApplyAuthorization({
            tenantId,
            env: { ...applyEnv(tenantId), PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION: "staging:wrong:restore-apply" }
        }),
        error => error.code === "BACKUP_DRILL_STAGING_CONFIRMATION_FAILED"
    );
    assert.deepEqual(
        resolveApplyAuthorization({ tenantId, env: applyEnv(tenantId) }),
        { apply: true, confirmationTenantId: tenantId }
    );
});

test("apply gate kapalıyken drill Firestore marker veya restore yazması yapmaz", async () => {
    const fixture = createFixture();
    const result = await runStagingBackupDrill({
        tenantId: fixture.tenantId,
        env: {},
        db: fixture.db,
        backupService: fixture.backupService
    });

    assert.equal(result.applyRequested, false);
    assert.equal(result.dryRun.dryRun, true);
    assert.equal(fixture.db.directWrites.length, 0);
    assert.equal(fixture.db.batchWrites.length, 0);
    assert.equal(
        fixture.db.data.has(tenantSettingsDocument(fixture.tenantId, DRILL_MARKER_ID)),
        false
    );
});

test("gated apply drill markerı backup değerine merge restore ile geri getirir", async () => {
    const fixture = createFixture();
    const times = [
        new Date("2026-09-04T10:00:00.000Z"),
        new Date("2026-09-04T10:01:00.000Z")
    ];
    const result = await runStagingBackupDrill({
        tenantId: fixture.tenantId,
        env: applyEnv(fixture.tenantId),
        db: fixture.db,
        backupService: fixture.backupService,
        now: () => times.shift(),
        randomUUID: () => "11111111-1111-4111-8111-111111111111"
    });
    const markerPath = tenantSettingsDocument(fixture.tenantId, DRILL_MARKER_ID);
    const marker = fixture.db.data.get(markerPath);

    assert.equal(result.applyRequested, true);
    assert.equal(result.restoreApply.applied, true);
    assert.equal(result.restoreApply.mode, "merge");
    assert.equal(result.markerRestored, true);
    assert.equal(marker.state, "backup-source");
    assert.equal(marker.markerValue, "backup-source:11111111-1111-4111-8111-111111111111");
    assert.equal(fixture.db.directWrites.length, 2);
    assert.ok(fixture.db.batchWrites.some(write => write.path === markerPath));
    assert.ok(fixture.db.batchWrites.every(write =>
        write.path === `platformTenants/${fixture.tenantId}` ||
        write.path.startsWith(`tenants/${fixture.tenantId}/`)
    ));
});
