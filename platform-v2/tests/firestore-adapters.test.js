const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFirestoreTenantRegistry
} = require("../src/firestore/firestore-tenant-registry");
const {
    createFirestoreAuditWriter
} = require("../src/firestore/firestore-audit-writer");

test("tenant registry list limiti ve sıralama sorgusunu uygular", async () => {
    const calls = [];
    const docs = [
        {
            id: "ece-doner",
            data() {
                return {
                    tenantId: "ece-doner",
                    displayName: "Ece Döner"
                };
            }
        }
    ];

    const db = {
        collection(name) {
            assert.equal(name, "platformTenants");
            return {
                doc() {
                    throw new Error("Bu testte doc çağrılmamalı.");
                },
                orderBy(field, direction) {
                    calls.push(["orderBy", field, direction]);
                    return {
                        limit(limit) {
                            calls.push(["limit", limit]);
                            return {
                                async get() {
                                    return { docs };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    const registry = createFirestoreTenantRegistry({ db });
    const tenants = await registry.list({ limit: 50 });

    assert.equal(tenants.length, 1);
    assert.equal(tenants[0].tenantId, "ece-doner");
    assert.deepEqual(calls, [
        ["orderBy", "createdAt", "desc"],
        ["limit", 50]
    ]);

    await assert.rejects(
        () => registry.list({ limit: 500 }),
        TypeError
    );
});

test("audit writer tenant audit pathinin dışına yazmaz", async () => {
    const writes = [];
    const db = {
        doc(path) {
            writes.push(path);
            return {
                async create(value) {
                    writes.push(value);
                }
            };
        }
    };

    const writer = createFirestoreAuditWriter({ db });
    const event = await writer.write({
        tenantId: "ece-doner",
        action: "tenant.created",
        actorId: "platform-admin-1",
        metadata: {
            sector: "restaurant"
        },
        now: new Date("2026-08-31T12:00:00.000Z")
    });

    assert.match(
        writes[0],
        /^tenants\/ece-doner\/audit\/[0-9a-f-]+$/
    );
    assert.equal(writes[1].tenantId, "ece-doner");
    assert.equal(writes[1].eventId, event.eventId);
});
