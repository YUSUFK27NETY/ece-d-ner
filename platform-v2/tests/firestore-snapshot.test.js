const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp, GeoPoint } = require("@google-cloud/firestore");
const {
    encodeFirestoreValue,
    decodeFirestoreValue
} = require("../src/firestore/firestore-value-codec");
const {
    createFirestoreTenantSnapshotProvider
} = require("../src/firestore/firestore-tenant-snapshot-provider");

class DocumentReference {
    constructor(path) {
        this.path = path;
    }
}

function createFakeDb() {
    const writes = [];
    const data = new Map([
        ["platformTenants/tenant-a", { tenantId: "tenant-a", displayName: "Tenant A" }],
        ["tenants/tenant-a/settings/business", { title: "Demo" }]
    ]);

    function docRef(path) {
        return {
            path,
            async get() {
                return {
                    exists: data.has(path),
                    id: path.split("/").at(-1),
                    data: () => data.get(path)
                };
            }
        };
    }

    return {
        writes,
        doc(path) {
            return docRef(path);
        },
        collection(path) {
            return {
                doc(id) {
                    return docRef(`${path}/${id}`);
                },
                async get() {
                    const prefix = `${path}/`;
                    const docs = [];
                    for (const [key, value] of data.entries()) {
                        if (!key.startsWith(prefix)) continue;
                        const rest = key.slice(prefix.length);
                        if (rest.includes("/")) continue;
                        docs.push({ id: rest, data: () => value });
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
                    writes.push(...pending);
                }
            };
        }
    };
}

test("Firestore özel tipleri kayıpsız tagged representation ile taşınır", () => {
    const db = { doc: path => ({ path }) };
    const value = {
        at: new Timestamp(123, 456),
        point: new GeoPoint(37.1, 37.2),
        bytes: Buffer.from("abc"),
        date: new Date("2026-09-02T20:00:00.000Z")
    };
    const encoded = encodeFirestoreValue(value, { tenantId: "tenant-a" });
    const decoded = decodeFirestoreValue(encoded, { db, tenantId: "tenant-a" });

    assert.equal(decoded.at.seconds, 123);
    assert.equal(decoded.at.nanoseconds, 456);
    assert.equal(decoded.point.latitude, 37.1);
    assert.equal(decoded.point.longitude, 37.2);
    assert.equal(decoded.bytes.toString("utf8"), "abc");
    assert.equal(decoded.date.toISOString(), "2026-09-02T20:00:00.000Z");
});

test("başka tenant'a giden DocumentReference backup sırasında reddedilir", () => {
    assert.throws(
        () => encodeFirestoreValue(
            { ref: new DocumentReference("tenants/tenant-b/orders/o1") },
            { tenantId: "tenant-a" }
        ),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
});

test("Firestore tenant snapshot export ve merge restore aynı tenant sınırında kalır", async () => {
    const db = createFakeDb();
    const provider = createFirestoreTenantSnapshotProvider({
        db,
        now: () => new Date("2026-09-02T20:00:00.000Z")
    });
    const snapshot = await provider.exportTenant({ tenantId: "tenant-a" });

    assert.equal(snapshot.tenantId, "tenant-a");
    assert.equal(snapshot.registry.displayName, "Tenant A");
    assert.equal(snapshot.collections.settings.length, 1);
    assert.equal(
        await provider.validateTenantSnapshot({ tenantId: "tenant-a", snapshot, schemaVersion: 1 }),
        true
    );

    const result = await provider.restoreTenant({
        tenantId: "tenant-a",
        snapshot,
        schemaVersion: 1,
        mode: "merge"
    });

    assert.ok(result.writes >= 2);
    assert.ok(db.writes.every(write =>
        write.ref.path === "platformTenants/tenant-a" || write.ref.path.startsWith("tenants/tenant-a/")
    ));
});

test("Firestore snapshot provider replace restore'u varsayılan olarak uygulamaz", async () => {
    const db = createFakeDb();
    const provider = createFirestoreTenantSnapshotProvider({ db });
    const snapshot = await provider.exportTenant({ tenantId: "tenant-a" });

    await assert.rejects(
        provider.restoreTenant({ tenantId: "tenant-a", snapshot, schemaVersion: 1, mode: "replace" }),
        error => error.code === "UNSAFE_RESTORE_MODE"
    );
});

test("restore içindeki cross-tenant DocumentReference hiçbir batch yazmadan reddedilir", async () => {
    const db = createFakeDb();
    const provider = createFirestoreTenantSnapshotProvider({ db });
    const snapshot = await provider.exportTenant({ tenantId: "tenant-a" });
    snapshot.collections.settings[0].data.reference = {
        __platformV2Type: "document-reference",
        path: "tenants/tenant-b/orders/o1"
    };

    await assert.rejects(
        provider.restoreTenant({
            tenantId: "tenant-a",
            snapshot,
            schemaVersion: 1,
            mode: "merge"
        }),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
    assert.equal(db.writes.length, 0);
});
