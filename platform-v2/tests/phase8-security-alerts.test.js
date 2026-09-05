const test = require("node:test");
const assert = require("node:assert/strict");
const { createSecurityAlertService } = require("../src/security/security-alert-service");
const { createInMemorySecurityAlertSink } = require("../src/security/in-memory-security-alert-sink");
const { DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG } = require("../src/config/platform-security-alerts-config");
const { securityEventFromAuthFailure } = require("../src/security/security-alert-adapters");
const { normalizeSecurityEvent, buildSecurityAlert } = require("../src/security/security-alert-model");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const CORRELATION = "12345678-1234-4234-8234-123456789012";
const OTHER_CORRELATION = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
const platformContext = { role: "platform_admin", actorId: "admin-1" };

function config(overrides = {}) {
    return {
        ...structuredClone(DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG),
        dedupeWindowMs: 5000,
        repeated401: { windowMs: 1000, countThreshold: 3, highThreshold: 5 },
        repeated403: { windowMs: 1000, countThreshold: 2, highThreshold: 4 },
        ...overrides
    };
}

function input(overrides = {}) {
    return {
        eventType: "tenant_boundary_violation",
        source: "tenant.authorization",
        tenantId: "tenant-a",
        actorId: "actor-a",
        operation: "tenant.read",
        reasonCode: "TENANT_SCOPE_MISMATCH",
        correlationId: CORRELATION,
        ...overrides
    };
}

function fixture(options = {}) {
    let now = NOW;
    const sink = options.sink || createInMemorySecurityAlertSink();
    const service = createSecurityAlertService({ sink, config: config(), clock: () => now, ...options });
    return { sink, service, setNow: value => { now = value; } };
}

async function list(sink, tenantId = "tenant-a") {
    return sink.list({ context: platformContext, tenantId, limit: 200 });
}

test("same tenant burst upserts one stable alert and preserves first correlation", async () => {
    const { service, sink, setNow } = fixture();
    const first = await service.record(input());
    setNow(NOW + 100);
    const second = await service.record(input({ correlationId: OTHER_CORRELATION, requestId: OTHER_CORRELATION }));
    assert.equal(first.alertId, second.alertId);
    assert.equal(first.dedupeKey, second.dedupeKey);
    assert.equal(second.correlationId, CORRELATION);
    assert.equal(second.requestId, OTHER_CORRELATION);
    assert.equal(second.eventCount, 2);
    assert.equal(second.duplicateCount, 1);
    assert.equal(second.firstSeenAt, new Date(NOW).toISOString());
    assert.equal(second.lastSeenAt, new Date(NOW + 100).toISOString());
    assert.equal(second.severity, "high");
    assert.deepEqual(await list(sink), [second]);
});

test("dedupe never joins tenants, actors, known/unknown scopes, sources or operations", async () => {
    const { service, sink } = fixture();
    const variants = [
        {}, { tenantId: "tenant-b" }, { actorId: "actor-b" }, { tenantId: null }, { actorId: null },
        { tenantId: null, actorId: null }, { tenantId: "unknown" }, { tenantId: "platform" },
        { actorId: "unknown" }, { source: "security.monitor" }, { operation: "tenant.update" },
        { reasonCode: "TENANT_BOUNDARY_VIOLATION" }
    ];
    const emitted = [];
    for (const variant of variants) emitted.push(await service.record(input(variant)));
    assert.equal(new Set(emitted.map(alert => alert.alertId)).size, variants.length);
    assert.ok(emitted.every(alert => alert.eventCount === 1));
    assert.ok((await list(sink, "tenant-a")).every(alert => alert.tenantId === "tenant-a"));
    assert.ok((await list(sink, null)).every(alert => alert.tenantId === null));
});

test("401 threshold counts observations and then escalates without multiplying legacy/client counts", async () => {
    const { service, sink } = fixture();
    const event = securityEventFromAuthFailure({ statusCode: 401, tenantId: "tenant-a", count: 5000 }, { nowMs: NOW });
    assert.equal(await service.record(event), null);
    assert.equal(await service.record(event), null);
    assert.deepEqual(await list(sink), []);
    const triggered = await service.record(event);
    assert.equal(triggered.severity, "warning");
    assert.equal(triggered.rollingCount, 3);
    assert.equal(triggered.duplicateCount, 2);
    assert.equal((await service.record(event)).severity, "warning");
    const escalated = await service.record(event);
    assert.equal(escalated.severity, "high");
    assert.equal(escalated.alertId, triggered.alertId);
    assert.equal((await list(sink)).length, 1);
});

test("403 has a separate configurable threshold and severity escalation", async () => {
    const { service, sink } = fixture();
    const event = securityEventFromAuthFailure({ statusCode: 403, tenantId: "tenant-a", actorId: "actor-a" }, { nowMs: NOW });
    assert.equal(await service.record(event), null);
    const warning = await service.record(event);
    assert.equal(warning.severity, "warning");
    assert.equal((await service.record(event)).severity, "warning");
    const high = await service.record(event);
    assert.equal(high.severity, "high");
    assert.equal(high.eventType, "repeated_403");
    assert.equal(high.rollingCount, 4);
    assert.equal((await list(sink)).length, 1);
});

test("different 401 tenant/actor scopes cannot collectively reach threshold", async () => {
    const { service } = fixture();
    for (const tenantId of ["tenant-a", "tenant-b", null]) {
        for (const actorId of ["actor-a", "actor-b", null]) {
            const event = securityEventFromAuthFailure({ statusCode: 401, tenantId, actorId }, { nowMs: NOW });
            assert.equal(await service.record(event), null);
            assert.equal(await service.record(event), null);
        }
    }
});

test("rolling window excludes exact cutoff and still aggregates across wall-clock bucket boundaries", async () => {
    const { service, setNow } = fixture();
    const event = input({ eventType: "repeated_401" });
    assert.equal(await service.record(event), null);
    setNow(NOW + 500);
    assert.equal(await service.record(event), null);
    setNow(NOW + 1000);
    assert.equal(await service.record(event), null, "oldest sample at exact cutoff must expire");
    setNow(NOW + 1001);
    const alert = await service.record(event);
    assert.equal(alert.rollingCount, 3);
    assert.equal(alert.eventCount, 4);
    assert.equal(alert.firstSeenAt, new Date(NOW).toISOString());
});

test("an activated burst retains its severity and latest occurrence after rolling count decreases", async () => {
    const { service, setNow, sink } = fixture();
    const event = input({ eventType: "repeated_403" });
    let high;
    for (let i = 0; i < 4; i++) high = await service.record(event);
    setNow(NOW + 1000);
    const continued = await service.record(event);
    assert.equal(continued.alertId, high.alertId);
    assert.equal(continued.rollingCount, 1);
    assert.equal(continued.severity, "high");
    assert.equal(continued.eventCount, 5);
    assert.equal((await list(sink))[0].lastSeenAt, new Date(NOW + 1000).toISOString());
});

test("dedupe closes at exact inactivity boundary and new burst starts with a fresh identity", async () => {
    const { service, sink, setNow } = fixture();
    const first = await service.record(input());
    setNow(NOW + 4999);
    const same = await service.record(input());
    assert.equal(same.alertId, first.alertId);
    setNow(NOW + 9999);
    const next = await service.record(input());
    assert.notEqual(next.alertId, first.alertId);
    assert.equal(next.duplicateCount, 0);
    assert.equal((await list(sink)).length, 2);
});

test("caller occurrence dates cannot change receipt-time threshold windows", async () => {
    const { service, setNow } = fixture();
    const event = input({ eventType: "repeated_401", occurredAt: new Date(NOW - 86_400_000).toISOString() });
    assert.equal(await service.record(event), null);
    setNow(NOW + 2000);
    assert.equal(await service.record(event), null);
    assert.equal(await service.record(event), null);
    assert.equal((await service.record(event)).rollingCount, 3);
    await assert.rejects(service.record(input({ occurredAt: new Date(NOW + 2001).toISOString() })), /occurredAt/);
});

test("concurrent records serialize counts and idempotent sink updates without losing events", async () => {
    const { service, sink } = fixture();
    const results = await Promise.all(Array.from({ length: 25 }, () => service.record(input())));
    assert.equal(new Set(results.map(alert => alert.alertId)).size, 1);
    assert.deepEqual(results.map(alert => alert.eventCount), Array.from({ length: 25 }, (_, i) => i + 1));
    const [stored] = await list(sink);
    assert.equal(stored.eventCount, 25);
    assert.equal(stored.duplicateCount, 24);
    await sink.emit(results[0]);
    assert.equal((await list(sink))[0].eventCount, 25, "late delivery cannot replace a newer count");
});

test("sink failures retain one safe pending alert and flush retries the same ID without recounting", async () => {
    const memory = createInMemorySecurityAlertSink();
    let fail = true;
    const seen = [];
    const { service } = fixture({ sink: {
        async emit(alert) {
            seen.push(alert);
            await memory.emit(alert);
            if (fail) throw new Error("provider-secret-sentinel");
            return { token: "sink-response-sentinel" };
        }
    } });
    await assert.rejects(service.record(input()), error => {
        assert.equal(error.code, "SECURITY_ALERT_SINK_FAILED");
        assert.ok(!error.message.includes("sentinel"));
        return true;
    });
    fail = false;
    await service.flush();
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1]);
    assert.equal((await list(memory)).length, 1);
    assert.equal((await list(memory))[0].eventCount, 1);
    const next = await service.record(input());
    assert.equal(next.eventCount, 2);
    assert.ok(!JSON.stringify(next).includes("sentinel"));
});

test("event and alert outputs remain frozen, redacted, and cannot be forged into the sink", async () => {
    const { service, sink } = fixture();
    const alert = await service.record(input({
        token: "token-sentinel", body: "body-sentinel", email: "pii@invalid.example",
        phone: "phone-sentinel", password: "sentinel", severity: "critical",
        metadata: { secret: "metadata-sentinel" }
    }));
    assert.equal(alert.severity, "high");
    assert.ok(Object.isFrozen(alert));
    assert.ok(!JSON.stringify(alert).includes("sentinel"));
    assert.ok(!JSON.stringify(await list(sink)).includes("pii@"));
    await assert.rejects(sink.emit({ ...alert, secret: "sentinel" }), /issued alert/);
    await assert.rejects(sink.emit(JSON.parse(JSON.stringify(alert))), /issued alert/);
    const results = await list(sink);
    results.length = 0;
    assert.equal((await list(sink)).length, 1);
});

test("sink queries retain RBAC and tenant isolation, including explicit null platform scope", async () => {
    const { service, sink } = fixture();
    await service.record(input());
    await service.record(input({ tenantId: "tenant-b" }));
    await service.record(input({ tenantId: null }));
    const owner = { role: "tenant_owner", tenantId: "tenant-a", actorId: "actor-a" };
    assert.equal((await sink.list({ context: owner, tenantId: "tenant-a" })).length, 1);
    await assert.rejects(sink.list({ context: owner, tenantId: "tenant-b" }), { code: "TENANT_SCOPE_MISMATCH" });
    await assert.rejects(sink.list({ context: owner, tenantId: null }), { code: "PERMISSION_DENIED" });
    await assert.rejects(sink.list({ context: { ...owner, role: "viewer" }, tenantId: "tenant-a" }), { code: "PERMISSION_DENIED" });
    await assert.rejects(sink.list({ context: platformContext }), /scope/);
    await assert.rejects(sink.list({ context: platformContext, tenantId: "tenant-a", limit: 201 }), /limit/);
    assert.equal((await list(sink, null)).length, 1);
});

test("bounded scope and sample capacities reject explicitly, then expire with the window", async () => {
    const bounded = config({ maxScopes: 1, maxEventsPerScope: 5 });
    const { service, setNow } = fixture({ config: bounded });
    const event = input({ eventType: "repeated_401" });
    for (let i = 0; i < 5; i++) await service.record(event);
    await assert.rejects(service.record(event), /rolling window kapasitesi/);
    await assert.rejects(service.record(input({ tenantId: "tenant-b" })), /scope kapasitesi/);
    setNow(NOW + 5000);
    const next = await service.record(input({ tenantId: "tenant-b" }));
    assert.equal(next.tenantId, "tenant-b");
    assert.equal(next.eventCount, 1);
});

test("bounded sink rejects new IDs without evicting existing tenant alerts", async () => {
    const sink = createInMemorySecurityAlertSink({ maxAlerts: 1 });
    const { service } = fixture({ sink });
    await service.record(input());
    await assert.rejects(service.record(input({ tenantId: "tenant-b" })), { code: "SECURITY_ALERT_SINK_FAILED" });
    assert.equal((await list(sink, "tenant-a")).length, 1);
    assert.equal((await list(sink, "tenant-b")).length, 0);
});

test("invalid config, throwing/backward clocks and malformed sink fail closed", async () => {
    assert.throws(() => createSecurityAlertService({ sink: { emit() {} }, config: {} }), TypeError);
    assert.throws(() => createSecurityAlertService({ sink: {} }), TypeError);
    for (const clock of [() => NaN, () => Infinity, () => NOW.toString(), () => -1, () => { throw new Error("private-sentinel"); }]) {
        const { service } = fixture({ clock });
        await assert.rejects(service.record(input()), error => {
            assert.ok(!error.message.includes("sentinel"));
            return error instanceof TypeError;
        });
    }
    const { service, setNow } = fixture();
    await service.record(input());
    setNow(NOW - 1);
    await assert.rejects(service.record(input()), /clock/);
});

test("config input mutation cannot disable thresholds or extend dedupe windows", async () => {
    const settings = config();
    const { service, setNow } = fixture({ config: settings });
    settings.repeated401.countThreshold = 1;
    settings.dedupeWindowMs = 999_999;
    assert.equal(await service.record(input({ eventType: "repeated_401" })), null);
    const first = await service.record(input());
    setNow(NOW + 5000);
    const next = await service.record(input());
    assert.notEqual(next.alertId, first.alertId);
});

test("alert builder cannot inherit client severity or an unrelated previous aggregate", () => {
    const event = normalizeSecurityEvent(input({ eventType: "auth_anomaly" }), { nowMs: NOW });
    const args = {
        event, config: config(), groupStartedAtMs: NOW,
        firstSeenAt: event.occurredAt, lastSeenAt: event.occurredAt,
        eventCount: 1, rollingCount: 1
    };
    assert.equal(buildSecurityAlert({ ...args, previousSeverity: "critical" }).severity, "warning");
    assert.throws(() => buildSecurityAlert({ ...args, previousAlert: { severity: "critical" } }), /issued alert/);
    const foreign = buildSecurityAlert({
        ...args,
        event: normalizeSecurityEvent(input({ tenantId: "tenant-b" }), { nowMs: NOW })
    });
    assert.throws(() => buildSecurityAlert({ ...args, eventCount: 2, previousAlert: foreign }), /previous aggregate/);
    const prior = buildSecurityAlert(args);
    assert.throws(() => buildSecurityAlert({ ...args, previousAlert: prior }), /previous aggregate/);
});
