const test = require("node:test");
const assert = require("node:assert/strict");

const { buildBackupKey } = require("../src/backup/backup-key");
const { buildManifestKey } = require("../src/backup/backup-manifest");
const { tenantSettingsDocument } = require("../src/firestore/tenant-paths");
const {
    DRILL_MARKER_ID,
    MAX_MANIFEST_BYTES,
    createBackupOperationsEvidenceProvider
} = require("../src/backup/backup-operations-evidence");
const {
    createConfiguredBackupEvidenceProvider
} = require("../server");

function createManifest({
    tenantId,
    createdAt,
    verifiedAt,
    sizeBytes = 4096
}) {
    const objectKey = buildBackupKey({ tenantId, date: new Date(createdAt) });

    return {
        manifestVersion: 1,
        status: "verified",
        tenantId,
        objectKey,
        manifestKey: buildManifestKey(objectKey),
        createdAt,
        verifiedAt,
        schemaVersion: 1,
        keyId: "staging-key",
        formatVersion: 1,
        sizeBytes,
        containerSha256: "a".repeat(64),
        plaintextSha256: "b".repeat(64)
    };
}

function createStorage(manifests, extraListedKeys = []) {
    const bodies = new Map(manifests.map(manifest => [
        manifest.manifestKey,
        Buffer.from(JSON.stringify(manifest), "utf8")
    ]));
    const prefixes = [];
    const reads = [];

    return {
        prefixes,
        reads,
        async listObjects({ prefix }) {
            prefixes.push(prefix);
            return {
                objects: [...bodies.keys(), ...extraListedKeys].map(key => ({ key }))
            };
        },
        async getObject({ key }) {
            reads.push(key);
            if (!bodies.has(key)) {
                const error = new Error("not found");
                error.code = "NOT_FOUND";
                throw error;
            }
            return { body: Buffer.from(bodies.get(key)) };
        }
    };
}

function createDb({ tenantId, marker = null, updateTime = null }) {
    const requestedPaths = [];

    return {
        requestedPaths,
        doc(path) {
            requestedPaths.push(path);
            return {
                async get() {
                    return {
                        exists: marker !== null,
                        data: () => marker,
                        updateTime: updateTime
                            ? { toDate: () => new Date(updateTime) }
                            : undefined
                    };
                }
            };
        },
        expectedPath: tenantSettingsDocument(tenantId, DRILL_MARKER_ID)
    };
}

test("Phase 5 manifest ve restore marker updateTime kanıtı doğru backup/drill özetini üretir", async () => {
    const tenantId = "backup-drill-staging";
    const first = createManifest({
        tenantId,
        createdAt: "2026-09-04T10:00:05.000Z",
        verifiedAt: "2026-09-04T10:00:10.000Z",
        sizeBytes: 4096
    });
    const latest = createManifest({
        tenantId,
        createdAt: "2026-09-04T10:02:00.000Z",
        verifiedAt: "2026-09-04T10:02:05.000Z",
        sizeBytes: 2048
    });
    const drillRunId = "11111111-1111-4111-8111-111111111111";
    const storage = createStorage([first, latest]);
    const db = createDb({
        tenantId,
        marker: {
            tenantId,
            drillRunId,
            markerValue: `backup-source:${drillRunId}`,
            state: "backup-source",
            updatedAt: "2026-09-04T10:00:00.000Z"
        },
        updateTime: "2026-09-04T10:01:00.000Z"
    });
    const provider = createBackupOperationsEvidenceProvider({
        storageProvider: storage,
        db
    });
    const status = await provider.getStatus({ tenantId });

    assert.deepEqual(status, {
        sizeBytes: 6144,
        objectCount: 2,
        verifiedAt: "2026-09-04T10:02:05.000Z",
        restoreDrillAt: "2026-09-04T10:01:00.000Z",
        restoreDrillStatus: "passed"
    });
    assert.deepEqual(storage.prefixes, ["backups/backup-drill-staging/firestore/"]);
    assert.ok(storage.reads.every(key => key.endsWith(".enc.manifest.json")));
    assert.deepEqual(db.requestedPaths, [db.expectedPath]);
    assert.doesNotMatch(
        JSON.stringify(status),
        /objectKey|manifestKey|keyId|sha256|credential|secret|body/i
    );
});

test("manifest veya restore sonrası marker updateTime kanıtı yoksa drill unknown kalır", async () => {
    const tenantId = "backup-drill-staging";
    const manifest = createManifest({
        tenantId,
        createdAt: "2026-09-04T10:00:05.000Z",
        verifiedAt: "2026-09-04T10:00:10.000Z"
    });
    const drillRunId = "22222222-2222-4222-8222-222222222222";
    const storage = createStorage([manifest]);
    const db = createDb({
        tenantId,
        marker: {
            tenantId,
            drillRunId,
            markerValue: `backup-source:${drillRunId}`,
            state: "backup-source",
            updatedAt: "2026-09-04T10:00:00.000Z"
        },
        updateTime: "2026-09-04T10:00:01.000Z"
    });
    const provider = createBackupOperationsEvidenceProvider({
        storageProvider: storage,
        db
    });
    const status = await provider.getStatus({ tenantId });

    assert.equal(status.verifiedAt, "2026-09-04T10:00:10.000Z");
    assert.equal(status.restoreDrillAt, null);
    assert.equal(status.restoreDrillStatus, "unknown");

    const missingProvider = createBackupOperationsEvidenceProvider({
        storageProvider: createStorage([]),
        db: createDb({ tenantId })
    });
    assert.deepEqual(await missingProvider.getStatus({ tenantId }), {
        sizeBytes: 0,
        objectCount: 0,
        verifiedAt: null,
        restoreDrillAt: null,
        restoreDrillStatus: "unknown"
    });
});

test("provider başka tenant manifestini veya markerını görünürlüğe katmaz", async () => {
    const tenantId = "tenant-a";
    const otherManifest = createManifest({
        tenantId: "tenant-b",
        createdAt: "2026-09-04T10:00:05.000Z",
        verifiedAt: "2026-09-04T10:00:10.000Z"
    });
    const storage = createStorage([otherManifest]);
    const db = createDb({ tenantId });
    const provider = createBackupOperationsEvidenceProvider({
        storageProvider: storage,
        db
    });

    assert.deepEqual(await provider.getStatus({ tenantId }), {
        sizeBytes: 0,
        objectCount: 0,
        verifiedAt: null,
        restoreDrillAt: null,
        restoreDrillStatus: "unknown"
    });
    assert.deepEqual(storage.prefixes, ["backups/tenant-a/firestore/"]);
    assert.deepEqual(db.requestedPaths, [db.expectedPath]);
});

test("marker tenant kimliği path ile uyuşmazsa provider fail-closed olur", async () => {
    const tenantId = "tenant-a";
    const manifest = createManifest({
        tenantId,
        createdAt: "2026-09-04T10:00:05.000Z",
        verifiedAt: "2026-09-04T10:00:10.000Z"
    });
    const provider = createBackupOperationsEvidenceProvider({
        storageProvider: createStorage([manifest]),
        db: createDb({
            tenantId,
            marker: {
                tenantId: "tenant-b",
                drillRunId: "33333333-3333-4333-8333-333333333333",
                markerValue: "backup-source:33333333-3333-4333-8333-333333333333",
                state: "backup-source",
                updatedAt: "2026-09-04T10:00:00.000Z"
            },
            updateTime: "2026-09-04T10:01:00.000Z"
        })
    });

    await assert.rejects(
        provider.getStatus({ tenantId }),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
});

test("aşırı büyük manifest body görünürlüğe alınmaz", async () => {
    const tenantId = "tenant-a";
    const manifest = createManifest({
        tenantId,
        createdAt: "2026-09-04T10:00:05.000Z",
        verifiedAt: "2026-09-04T10:00:10.000Z"
    });
    const storage = createStorage([manifest]);
    storage.getObject = async () => ({ body: Buffer.alloc(MAX_MANIFEST_BYTES + 1) });
    const provider = createBackupOperationsEvidenceProvider({
        storageProvider: storage,
        db: createDb({ tenantId })
    });

    assert.deepEqual(await provider.getStatus({ tenantId }), {
        sizeBytes: 0,
        objectCount: 0,
        verifiedAt: null,
        restoreDrillAt: null,
        restoreDrillStatus: "unknown"
    });
});

test("runtime R2 config yoksa adapter pasif; kısmi config fail-closed olur", () => {
    const db = createDb({ tenantId: "tenant-a" });

    assert.equal(createConfiguredBackupEvidenceProvider({ db, env: {} }), null);
    assert.throws(
        () => createConfiguredBackupEvidenceProvider({
            db,
            env: { PLATFORM_BACKUP_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com" }
        }),
        error => error.code === "R2_CONFIG_MISSING"
    );

    const provider = createConfiguredBackupEvidenceProvider({
        db,
        env: {
            PLATFORM_BACKUP_R2_ENDPOINT: "https://account.r2.cloudflarestorage.com",
            PLATFORM_BACKUP_R2_BUCKET: "platform-v2-backups-staging",
            PLATFORM_BACKUP_R2_ACCESS_KEY_ID: "TEST-ACCESS",
            PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY: "test-secret"
        }
    });
    assert.equal(typeof provider.getStatus, "function");
});
