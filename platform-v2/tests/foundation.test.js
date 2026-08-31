const test = require("node:test");
const assert = require("node:assert/strict");

const {
    normalizeTenantId,
    isValidTenantId,
    requireTenantId
} = require("../src/tenant/tenant-id");
const {
    createTenantContext
} = require("../src/tenant/tenant-context");
const {
    tenantCollection,
    tenantDocument,
    TENANT_COLLECTIONS
} = require("../src/firestore/tenant-paths");
const {
    buildBackupKey,
    tenantBackupPrefix
} = require("../src/backup/backup-key");
const {
    getRetentionCutoff,
    isExpiredBackup
} = require("../src/backup/retention-policy");
const {
    assertStorageProvider
} = require("../src/storage/object-storage-provider");

test("tenant kimliği normalize edilir ve güvenli format zorlanır", () => {
    assert.equal(normalizeTenantId("  ECE-DONER  "), "ece-doner");
    assert.equal(isValidTenantId("ece-doner"), true);
    assert.equal(isValidTenantId("A/B"), false);
    assert.throws(() => requireTenantId("../ece"), TypeError);
});

test("tenant context açık tenant kimliği olmadan oluşmaz", () => {
    const context = createTenantContext({
        tenantId: "ece-doner",
        actorId: "user-1",
        role: "tenant_owner"
    });

    assert.deepEqual(context, {
        tenantId: "ece-doner",
        actorId: "user-1",
        role: "tenant_owner"
    });

    assert.throws(
        () => createTenantContext({ tenantId: "", role: "tenant_owner" }),
        TypeError
    );
});

test("Firestore yolları tenant root altından üretilir", () => {
    assert.equal(
        tenantCollection("ece-doner", TENANT_COLLECTIONS.orders),
        "tenants/ece-doner/orders"
    );

    assert.equal(
        tenantDocument("ece-doner", TENANT_COLLECTIONS.products, "urun-1"),
        "tenants/ece-doner/products/urun-1"
    );

    assert.throws(
        () => tenantCollection("ece-doner", "unknown"),
        TypeError
    );
});

test("backup anahtarı tenant bazlı ve deterministik üretilir", () => {
    const date = new Date("2026-08-31T12:34:56.000Z");

    assert.equal(
        buildBackupKey({ tenantId: "ece-doner", date }),
        "backups/ece-doner/firestore/2026/08/31/2026-08-31T12-34-56-000Z.json.gz.enc"
    );

    assert.equal(
        tenantBackupPrefix("ece-doner"),
        "backups/ece-doner/firestore/"
    );
});

test("7 günlük retention sınırı doğru hesaplanır", () => {
    const now = new Date("2026-08-31T00:00:00.000Z");

    assert.equal(
        getRetentionCutoff({ now, retentionDays: 7 }).toISOString(),
        "2026-08-24T00:00:00.000Z"
    );

    assert.equal(
        isExpiredBackup({
            createdAt: "2026-08-23T23:59:59.000Z",
            now,
            retentionDays: 7
        }),
        true
    );

    assert.equal(
        isExpiredBackup({
            createdAt: "2026-08-24T00:00:00.000Z",
            now,
            retentionDays: 7
        }),
        false
    );
});

test("storage adapter gerekli metodları uygulamak zorunda", () => {
    const provider = {
        async putObject() {},
        async getObject() {},
        async listObjects() {},
        async deleteObject() {}
    };

    assert.equal(assertStorageProvider(provider), provider);
    assert.throws(() => assertStorageProvider({}), TypeError);
});
