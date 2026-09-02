const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    encodeBackup,
    decodeBackup,
    normalizeEncryptionKey
} = require("../src/backup/backup-codec");
const {
    createBackupKeyring
} = require("../src/backup/backup-keyring");
const {
    buildBackupManifest,
    assertBackupManifest
} = require("../src/backup/backup-manifest");
const {
    createTenantBackupService
} = require("../src/backup/tenant-backup-service");
const {
    assertTenantMatch,
    assertTenantPathBelongsTo
} = require("../src/tenant/tenant-boundary");
const {
    createMigrationPlan,
    applyMigrationPlan
} = require("../src/migrations/migration-registry");
const {
    createReadinessChecker
} = require("../src/observability/readiness-check");
const {
    buildOperationalEvent
} = require("../src/observability/operational-event");

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

function createSnapshotProvider() {
    const restored = [];

    return {
        restored,
        async exportTenant({ tenantId }) {
            return {
                tenantId,
                collections: {
                    settings: [{ id: "business", data: { name: "Demo" } }]
                }
            };
        },
        async validateTenantSnapshot({ tenantId, snapshot }) {
            assert.equal(snapshot.tenantId, tenantId);
            assert.ok(snapshot.collections);
            return true;
        },
        async restoreTenant(input) {
            restored.push(input);
            return { writes: 1 };
        }
    };
}

test("backup codec tenant-bound, gzip ve AES-256-GCM ile round-trip yapar", () => {
    const key = crypto.randomBytes(32);
    const snapshot = {
        tenantId: "tenant-a",
        collections: { orders: [{ id: "1", total: 100 }] }
    };
    const encoded = encodeBackup({
        tenantId: "tenant-a",
        snapshot,
        encryptionKey: key,
        keyId: "key-2026-09",
        schemaVersion: 3,
        createdAt: new Date("2026-09-02T20:00:00.000Z")
    });
    const decoded = decodeBackup({
        body: encoded.body,
        encryptionKey: key,
        expectedTenantId: "tenant-a"
    });

    assert.deepEqual(decoded.snapshot, snapshot);
    assert.equal(decoded.header.schemaVersion, 3);
    assert.equal(decoded.header.keyId, "key-2026-09");
});

test("tampered backup fail-closed olur", () => {
    const key = crypto.randomBytes(32);
    const encoded = encodeBackup({
        tenantId: "tenant-a",
        snapshot: { tenantId: "tenant-a", value: 1 },
        encryptionKey: key,
        keyId: "key-a"
    });
    const tampered = Buffer.from(encoded.body);
    tampered[tampered.length - 1] ^= 0xff;

    assert.throws(
        () => decodeBackup({ body: tampered, encryptionKey: key, expectedTenantId: "tenant-a" }),
        /kimlik doğrulaması başarısız/
    );
});

test("wrong-tenant restore decode aşamasında engellenir", () => {
    const key = crypto.randomBytes(32);
    const encoded = encodeBackup({
        tenantId: "tenant-a",
        snapshot: { tenantId: "tenant-a" },
        encryptionKey: key,
        keyId: "key-a"
    });

    assert.throws(
        () => decodeBackup({ body: encoded.body, encryptionKey: key, expectedTenantId: "tenant-b" }),
        /farklı tenant/
    );
});

test("keyring aktif anahtarı seçer ve eski key ile restore destekler", () => {
    const keyA = crypto.randomBytes(32);
    const keyB = crypto.randomBytes(32);
    const keyring = createBackupKeyring({
        activeKeyId: "key-b",
        keys: {
            "key-a": keyA.toString("base64"),
            "key-b": keyB.toString("base64")
        }
    });

    assert.equal(keyring.getActiveKey().keyId, "key-b");
    assert.deepEqual(keyring.getKey("key-a"), keyA);
    assert.equal(normalizeEncryptionKey(keyring.getKey("key-b")).length, 32);
});

test("manifest container checksum ve tenant sınırını doğrular", () => {
    const key = crypto.randomBytes(32);
    const encoded = encodeBackup({
        tenantId: "tenant-a",
        snapshot: { tenantId: "tenant-a" },
        encryptionKey: key,
        keyId: "key-a",
        createdAt: new Date("2026-09-02T20:00:00.000Z")
    });
    const manifest = buildBackupManifest({
        tenantId: "tenant-a",
        objectKey: "backups/tenant-a/firestore/2026/09/02/2026-09-02T20-00-00-000Z.json.gz.enc",
        header: encoded.header,
        body: encoded.body,
        verifiedAt: new Date("2026-09-02T20:01:00.000Z")
    });

    assert.equal(assertBackupManifest(manifest, "tenant-a"), manifest);
    assert.throws(() => assertBackupManifest(manifest, "tenant-b"), /farklı tenant/);
});

test("tenant boundary çapraz path ve resource kimliğini reddeder", () => {
    assert.equal(
        assertTenantPathBelongsTo("tenant-a", "tenants/tenant-a/orders/o1"),
        "tenants/tenant-a/orders/o1"
    );
    assert.throws(
        () => assertTenantPathBelongsTo("tenant-a", "tenants/tenant-b/orders/o1"),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
    assert.throws(
        () => assertTenantMatch("tenant-a", "tenant-b"),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
});

test("backup service yazdıktan sonra verify eder ve manifest üretir", async () => {
    const storage = createMemoryStorage();
    const snapshots = createSnapshotProvider();
    const keyring = createBackupKeyring({
        activeKeyId: "key-a",
        keys: { "key-a": crypto.randomBytes(32).toString("base64") }
    });
    const service = createTenantBackupService({
        storageProvider: storage,
        snapshotProvider: snapshots,
        keyring
    });

    const manifest = await service.createBackup({
        tenantId: "tenant-a",
        schemaVersion: 2,
        now: new Date("2026-09-02T20:00:00.000Z")
    });
    const verified = await service.verifyBackup({
        tenantId: "tenant-a",
        objectKey: manifest.objectKey
    });

    assert.equal(manifest.status, "verified");
    assert.equal(verified.valid, true);
    assert.ok(storage.objects.has(manifest.manifestKey));
});

test("restore varsayılan dry-run; apply açık doğrulama olmadan yazmaz", async () => {
    const storage = createMemoryStorage();
    const snapshots = createSnapshotProvider();
    const keyring = createBackupKeyring({
        activeKeyId: "key-a",
        keys: { "key-a": crypto.randomBytes(32).toString("base64") }
    });
    const service = createTenantBackupService({ storageProvider: storage, snapshotProvider: snapshots, keyring });
    const manifest = await service.createBackup({ tenantId: "tenant-a" });

    const dryRun = await service.restoreBackup({
        tenantId: "tenant-a",
        objectKey: manifest.objectKey
    });
    assert.equal(dryRun.dryRun, true);
    assert.equal(snapshots.restored.length, 0);

    await assert.rejects(
        service.restoreBackup({
            tenantId: "tenant-a",
            objectKey: manifest.objectKey,
            apply: true,
            confirmationTenantId: "tenant-b"
        }),
        error => error.code === "RESTORE_CONFIRMATION_FAILED"
    );
    assert.equal(snapshots.restored.length, 0);

    const applied = await service.restoreBackup({
        tenantId: "tenant-a",
        objectKey: manifest.objectKey,
        apply: true,
        confirmationTenantId: "tenant-a"
    });
    assert.equal(applied.applied, true);
    assert.equal(snapshots.restored.length, 1);
});

test("migration plan eksik sıra ve verify failure durumunda fail-closed olur", async () => {
    const migration1 = {
        version: 1,
        id: "001-init",
        forwardFix: "Yeni forward-fix migration yayınla.",
        async up(context) { context.value = 1; },
        async verify(context) { return context.value === 1; }
    };
    const migration2 = {
        version: 2,
        id: "002-next",
        forwardFix: "Yeni forward-fix migration yayınla.",
        async up(context) { context.value = 2; },
        async verify(context) { return context.value === 2; }
    };
    const plan = createMigrationPlan({ currentVersion: 0, targetVersion: 2, migrations: [migration2, migration1] });
    const context = {};
    const result = await applyMigrationPlan({ plan, context });

    assert.deepEqual(result.applied, ["001-init", "002-next"]);
    assert.equal(result.toVersion, 2);
    assert.throws(
        () => createMigrationPlan({ currentVersion: 0, targetVersion: 2, migrations: [migration2] }),
        /1 sürümü eksik/
    );
});

test("readiness dependency hata durumunda not_ready ve güvenli metadata döner", async () => {
    const checker = createReadinessChecker({
        timeoutMs: 100,
        checks: {
            firestore: async () => true,
            broken: async () => { throw Object.assign(new Error("secret detail"), { code: "DB_DOWN" }); }
        },
        now: () => new Date("2026-09-02T20:00:00.000Z")
    });
    const result = await checker();

    assert.equal(result.ready, false);
    assert.equal(result.status, "not_ready");
    assert.equal(result.checks.firestore.status, "ok");
    assert.equal(result.checks.broken.code, "DB_DOWN");
    assert.equal(JSON.stringify(result).includes("secret detail"), false);
});

test("operational event yalnız kontrollü alanları üretir", () => {
    const event = buildOperationalEvent({
        level: "info",
        event: "tenant.backup.verified",
        tenantId: "tenant-a",
        requestId: "request-1",
        operation: "backup.verify",
        status: "ok",
        durationMs: 42.4,
        timestamp: new Date("2026-09-02T20:00:00.000Z")
    });

    assert.deepEqual(event, {
        timestamp: "2026-09-02T20:00:00.000Z",
        level: "info",
        event: "tenant.backup.verified",
        operation: "backup.verify",
        requestId: "request-1",
        status: "ok",
        tenantId: "tenant-a",
        durationMs: 42
    });
});
