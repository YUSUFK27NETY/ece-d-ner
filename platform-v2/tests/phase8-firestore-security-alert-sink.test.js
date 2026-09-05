const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFirestoreSecurityAlertSink,
    securityAlertDocumentPath
} = require("../src/firestore/firestore-security-alert-sink");
const { createSecurityAlertService } = require("../src/security/security-alert-service");

const NOW = Date.parse("2026-09-06T12:00:00.000Z");
const PLATFORM_CONTEXT = Object.freeze({ role: "platform_admin", actorId: "platform-admin-1" });
const TENANT_OWNER_CONTEXT = Object.freeze({
    role: "tenant_owner",
    tenantId: "tenant-a",
    actorId: "tenant-owner-1"
});
const PERSISTED_FIELDS = Object.freeze([
    "schemaVersion", "alertId", "dedupeKey", "eventType", "severity", "tenantId",
    "actorId", "requestId", "correlationId", "source", "occurredAt", "reasonCode",
    "operation", "eventCount", "duplicateCount", "rollingCount", "firstSeenAt", "lastSeenAt"
]);

function createFirestoreMock() {
    const records = new Map();
    const calls = [];

    function documentSnapshot(path) {
        const exists = records.has(path);
        return {
            exists,
            id: path.slice(path.lastIndexOf("/") + 1),
            data() {
                return records.get(path);
            }
        };
    }

    const db = {
        doc(path) {
            calls.push(["doc", path]);
            return Object.freeze({
                path,
                id: path.slice(path.lastIndexOf("/") + 1)
            });
        },
        async runTransaction(action) {
            const pending = [];
            const result = await action({
                async get(ref) {
                    calls.push(["transaction.get", ref.path]);
                    return documentSnapshot(ref.path);
                },
                set(ref, value) {
                    calls.push(["transaction.set", ref.path]);
                    pending.push([ref.path, structuredClone(value)]);
                }
            });
            for (const [path, value] of pending) records.set(path, value);
            return result;
        },
        collection(path) {
            calls.push(["collection", path]);
            return {
                orderBy(field, direction) {
                    calls.push(["orderBy", field, direction]);
                    return {
                        limit(limit) {
                            calls.push(["limit", limit]);
                            return {
                                async get() {
                                    const prefix = `${path}/`;
                                    const docs = [...records.keys()]
                                        .filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
                                        .map(documentSnapshot);
                                    return { docs };
                                }
                            };
                        }
                    };
                }
            };
        }
    };

    return Object.freeze({ db, records, calls });
}

async function issueAlerts({
    tenantId = "tenant-a",
    actorId = "actor-a",
    count = 1,
    startAt = NOW
} = {}) {
    let now = startAt;
    const service = createSecurityAlertService({
        sink: { async emit(alert) { return alert; } },
        clock: () => now
    });
    const alerts = [];

    for (let index = 0; index < count; index += 1) {
        const input = tenantId === null
            ? {
                eventType: "auth_anomaly",
                source: "security.monitor",
                tenantId: null,
                actorId,
                operation: "platform.admin.auth",
                reasonCode: "AUTH_ANOMALY"
            }
            : {
                eventType: "tenant_boundary_violation",
                source: "tenant.authorization",
                tenantId,
                actorId,
                operation: "tenant.read",
                reasonCode: "TENANT_SCOPE_MISMATCH"
            };
        alerts.push(await service.record(input));
        now += 100;
    }

    return alerts;
}

async function storedTenantFixture() {
    const firestore = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db: firestore.db });
    const [alert] = await issueAlerts();
    const path = securityAlertDocumentPath(alert);
    await sink.emit(alert);
    return { ...firestore, sink, alert, path };
}

test("tenant and platform alerts use exact isolated collection paths", async () => {
    const [tenantAlert] = await issueAlerts();
    const [platformAlert] = await issueAlerts({ tenantId: null });

    assert.equal(
        securityAlertDocumentPath(tenantAlert),
        `tenants/tenant-a/securityAlerts/${tenantAlert.alertId}`
    );
    assert.equal(
        securityAlertDocumentPath(platformAlert),
        `platformSecurityAlerts/${platformAlert.alertId}`
    );
});

test("emit accepts only core-issued alerts and writes an exact safe projection", async () => {
    const { db, records } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [alert] = await issueAlerts();
    const path = securityAlertDocumentPath(alert);

    const result = await sink.emit(alert);
    assert.deepEqual(result, alert);
    assert.deepEqual(Object.keys(records.get(path)), PERSISTED_FIELDS);
    assert.deepEqual(records.get(path), alert);
    await assert.rejects(sink.emit({ ...alert }), /issued alert/);
    await assert.rejects(sink.emit(JSON.parse(JSON.stringify(alert))), /issued alert/);
});

test("same issued alert retry is idempotent", async () => {
    const { db, records, calls } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [alert] = await issueAlerts();
    const path = securityAlertDocumentPath(alert);

    await sink.emit(alert);
    const retried = await sink.emit(alert);
    assert.equal(retried.eventCount, 1);
    assert.equal(records.get(path).eventCount, 1);
    assert.equal(calls.filter(call => call[0] === "transaction.set").length, 1);
});

test("transaction keeps a newer aggregate and updates only for higher eventCount", async () => {
    const { db, records, calls } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [first, second, third] = await issueAlerts({ count: 3 });
    const path = securityAlertDocumentPath(first);

    await sink.emit(second);
    const setCount = calls.filter(call => call[0] === "transaction.set").length;
    const staleRetry = await sink.emit(first);
    assert.equal(staleRetry.eventCount, 2);
    assert.equal(records.get(path).eventCount, 2);
    assert.equal(calls.filter(call => call[0] === "transaction.set").length, setCount);

    await sink.emit(third);
    assert.equal(records.get(path).eventCount, 3);
    assert.equal(records.get(path).duplicateCount, 2);
    assert.equal(calls.filter(call => call[0] === "transaction.set").length, setCount + 1);
});

test("tenant list enforces permission and exact tenant isolation", async () => {
    const { db } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [tenantA] = await issueAlerts({ tenantId: "tenant-a" });
    const [tenantB] = await issueAlerts({ tenantId: "tenant-b" });
    await sink.emit(tenantA);
    await sink.emit(tenantB);

    assert.deepEqual(
        (await sink.list({ context: TENANT_OWNER_CONTEXT, tenantId: "tenant-a" })).map(item => item.tenantId),
        ["tenant-a"]
    );
    await assert.rejects(
        sink.list({ context: TENANT_OWNER_CONTEXT, tenantId: "tenant-b" }),
        { code: "TENANT_SCOPE_MISMATCH" }
    );
    await assert.rejects(
        sink.list({ context: { ...TENANT_OWNER_CONTEXT, role: "viewer" }, tenantId: "tenant-a" }),
        { code: "PERMISSION_DENIED" }
    );
});

test("platform scope is denied to tenant actors and readable by platform admin", async () => {
    const { db } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [alert] = await issueAlerts({ tenantId: null });
    await sink.emit(alert);

    await assert.rejects(
        sink.list({ context: TENANT_OWNER_CONTEXT, tenantId: null }),
        { code: "PERMISSION_DENIED" }
    );
    const listed = await sink.list({ context: PLATFORM_CONTEXT, tenantId: null });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].tenantId, null);
});

test("list requires explicit scope and strict integer limit from 1 through 200", async () => {
    const { db, calls } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });

    await assert.rejects(sink.list({ context: PLATFORM_CONTEXT }), /scope/);
    await sink.list({ context: PLATFORM_CONTEXT, tenantId: null, limit: 1 });
    await sink.list({ context: PLATFORM_CONTEXT, tenantId: null, limit: 200 });
    for (const limit of [0, 201, "20", null]) {
        await assert.rejects(sink.list({ context: PLATFORM_CONTEXT, tenantId: null, limit }), /limit/);
    }
    assert.deepEqual(
        calls.filter(call => call[0] === "limit").map(call => call[1]),
        [1, 200]
    );
});

test("list queries lastSeenAt descending and returns deterministic descending results", async () => {
    const { db, calls } = createFirestoreMock();
    const sink = createFirestoreSecurityAlertSink({ db });
    const [older] = await issueAlerts({ actorId: "actor-old", startAt: NOW });
    const [newer] = await issueAlerts({ actorId: "actor-new", startAt: NOW + 10_000 });
    await sink.emit(older);
    await sink.emit(newer);

    const listed = await sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a", limit: 20 });
    assert.deepEqual(listed.map(alert => alert.alertId), [newer.alertId, older.alertId]);
    assert.ok(calls.some(call =>
        call[0] === "collection" && call[1] === "tenants/tenant-a/securityAlerts"
    ));
    assert.ok(calls.some(call =>
        call[0] === "orderBy" && call[1] === "lastSeenAt" && call[2] === "desc"
    ));
});

test("persisted alertId must match the Firestore document id", async () => {
    const { records, sink, alert, path } = await storedTenantFixture();
    const record = records.get(path);
    records.delete(path);
    records.set(`tenants/tenant-a/securityAlerts/${"a".repeat(64)}`, record);

    await assert.rejects(
        sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
        /document binding/
    );
});

test("persisted tenant scope must match the exact queried collection", async () => {
    const { records, sink, path } = await storedTenantFixture();
    records.set(path, { ...records.get(path), tenantId: "tenant-b" });

    await assert.rejects(
        sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
        /tenant scope/
    );
});

test("persisted canonical enums fail closed when tampered", async () => {
    const cases = {
        severity: "critical",
        eventType: "unknown_event",
        source: "unknown.source",
        reasonCode: "UNKNOWN_REASON",
        operation: "unknown.operation"
    };

    for (const [field, value] of Object.entries(cases)) {
        const { records, sink, path } = await storedTenantFixture();
        records.set(path, { ...records.get(path), [field]: value });
        await assert.rejects(
            sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
            TypeError,
            field
        );
    }
});

test("malformed counts, timestamps and identifiers fail closed", async () => {
    const mutations = [
        record => ({ ...record, eventCount: 0 }),
        record => ({ ...record, duplicateCount: 3 }),
        record => ({ ...record, rollingCount: record.eventCount + 1 }),
        record => ({ ...record, lastSeenAt: "2026-09-06 12:00:00" }),
        record => ({ ...record, firstSeenAt: "2026-09-07T12:00:00.000Z" }),
        record => ({ ...record, correlationId: "not-a-uuid" }),
        record => ({ ...record, actorId: undefined })
    ];

    for (const mutate of mutations) {
        const { records, sink, path } = await storedTenantFixture();
        records.set(path, mutate(records.get(path)));
        await assert.rejects(
            sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
            TypeError
        );
    }

    const { records, sink, path } = await storedTenantFixture();
    const record = records.get(path);
    records.delete(path);
    records.set("tenants/tenant-a/securityAlerts/not-a-valid-id", {
        ...record,
        alertId: "not-a-valid-id",
        dedupeKey: "not-a-valid-id"
    });
    await assert.rejects(
        sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
        TypeError
    );
});

test("unknown and sensitive persisted fields never enter the response projection", async () => {
    const { records, sink, alert, path } = await storedTenantFixture();
    records.set(path, {
        ...records.get(path),
        token: "token-redaction-sentinel",
        body: "body-redaction-sentinel",
        secret: "secret-redaction-sentinel",
        email: "email-redaction-sentinel",
        phone: "phone-redaction-sentinel",
        ip: "ip-redaction-sentinel",
        providerPayload: { nested: "provider-redaction-sentinel" },
        arbitrary: true
    });

    const [listed] = await sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" });
    assert.deepEqual(Object.keys(listed), PERSISTED_FIELDS);
    assert.equal(listed.alertId, alert.alertId);
    assert.ok(Object.isFrozen(listed));
    assert.ok(!JSON.stringify(listed).includes("sentinel"));
});

test("persisted validation errors never reflect malformed sensitive values", async () => {
    const { records, sink, path } = await storedTenantFixture();
    records.set(path, {
        ...records.get(path),
        severity: "private-value-sentinel"
    });

    await assert.rejects(
        sink.list({ context: PLATFORM_CONTEXT, tenantId: "tenant-a" }),
        error => {
            assert.ok(error instanceof TypeError);
            assert.ok(!error.message.includes("sentinel"));
            return true;
        }
    );
});
