const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
} = require("../src/config/platform-security-alerts-config");
const { createRuntimeSecurityOperations } = require("../server");
const { createAbuseMonitor } = require("../src/security/abuse-monitor");
const { createInMemorySecurityAlertSink } = require("../src/security/in-memory-security-alert-sink");
const { createSecurityAlertService } = require("../src/security/security-alert-service");
const { createSecurityOperationsBridge } = require("../src/security/security-operations-bridge");
const { createInMemorySecuritySignalStore } = require("../src/security/in-memory-security-signal-store");
const { createSecuritySignalService } = require("../src/security/security-signal");
const { createTenantAccessGuard } = require("../src/security/tenant-access-guard");

function boundaryInput(overrides = {}) {
    return {
        context: { tenantId: "tenant-a", actorId: "trusted-actor-1" },
        errorCode: "TENANT_SCOPE_MISMATCH",
        operation: "tenant.profile.read",
        requestId: crypto.randomUUID(),
        targetTenantId: "tenant-b",
        ...overrides
    };
}

async function rejectCode(action, code = "TENANT_SCOPE_MISMATCH") {
    await assert.rejects(action, error => {
        assert.equal(error.code, code);
        return true;
    });
}

async function captureConsoleErrors(action) {
    const original = console.error;
    const messages = [];
    console.error = (...args) => { messages.push(args.join(" ")); };
    try {
        const result = await action();
        return { result, messages };
    } finally {
        console.error = original;
    }
}

function createFirestoreMock() {
    const records = new Map();
    const db = {
        doc(path) {
            return Object.freeze({ path, id: path.slice(path.lastIndexOf("/") + 1) });
        },
        collection() {
            return {};
        },
        async runTransaction(action) {
            const writes = [];
            const result = await action({
                async get(ref) {
                    return {
                        exists: records.has(ref.path),
                        data() { return records.get(ref.path); }
                    };
                },
                set(ref, value) {
                    writes.push([ref.path, structuredClone(value)]);
                }
            });
            for (const [path, value] of writes) records.set(path, value);
            return result;
        }
    };
    return { db, records };
}

test("TENANT_SCOPE_MISMATCH becomes exactly one server-owned central event", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const input = boundaryInput();

    const event = await bridge.recordTenantBoundaryViolation(input);

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0], event);
    assert.deepEqual({
        eventType: event.eventType,
        severity: event.severity,
        source: event.source,
        reasonCode: event.reasonCode,
        tenantId: event.tenantId,
        actorId: event.actorId,
        operation: event.operation,
        requestId: event.requestId
    }, {
        eventType: "tenant_boundary_violation",
        severity: "high",
        source: "tenant.authorization",
        reasonCode: "TENANT_SCOPE_MISMATCH",
        tenantId: "tenant-a",
        actorId: "trusted-actor-1",
        operation: "tenant.profile.read",
        requestId: input.requestId
    });
    assert.equal(Object.hasOwn(event, "count"), false);
});

test("TENANT_BOUNDARY_VIOLATION becomes exactly one high-severity event", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });

    const event = await bridge.recordTenantBoundaryViolation(boundaryInput({
        errorCode: "TENANT_BOUNDARY_VIOLATION"
    }));

    assert.equal(recorded.length, 1);
    assert.equal(event.reasonCode, "TENANT_BOUNDARY_VIOLATION");
    assert.equal(event.eventType, "tenant_boundary_violation");
    assert.equal(event.severity, "high");
});

test("source tenant and trusted context actor win while target tenant is discarded", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });

    const event = await bridge.recordTenantBoundaryViolation(boundaryInput({
        targetTenantId: "attacker-target"
    }));

    assert.equal(event.tenantId, "tenant-a");
    assert.equal(event.actorId, "trusted-actor-1");
    assert.ok(!JSON.stringify(event).includes("attacker-target"));
    assert.equal(recorded.length, 1);
});

test("bridge rejects invalid reason, missing source, untrusted operation/request and malformed target", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const invalid = [
        boundaryInput({ errorCode: "PERMISSION_DENIED" }),
        boundaryInput({ context: {} }),
        boundaryInput({ context: { tenantId: null, actorId: null } }),
        boundaryInput({ context: { tenantId: "Tenant-A", actorId: "trusted-actor-1" } }),
        boundaryInput({ operation: undefined }),
        boundaryInput({ operation: "unknown.operation" }),
        boundaryInput({ requestId: undefined }),
        boundaryInput({ requestId: "caller-request" }),
        boundaryInput({ targetTenantId: "Tenant-B" }),
        boundaryInput({ targetTenantId: 123 })
    ];

    for (const input of invalid) {
        await assert.rejects(bridge.recordTenantBoundaryViolation(input), TypeError);
    }
    assert.equal(recordCalls, 0);
});

test("caller-owned count, severity, type, reason, correlation and sensitive payloads are rejected", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    for (const extra of [
        { count: 50 },
        { severity: "critical" },
        { eventType: "admin_takeover_confirmed" },
        { reasonCode: "ADMIN_TAKEOVER_CONFIRMED" },
        { correlationId: crypto.randomUUID() },
        { token: "redaction-marker" },
        { body: "redaction-marker" },
        { email: "redaction-marker@invalid.example" },
        { rawProviderPayload: "redaction-marker" }
    ]) {
        await assert.rejects(
            bridge.recordTenantBoundaryViolation({ ...boundaryInput(), ...extra }),
            error => error instanceof TypeError && !error.message.includes("marker")
        );
    }
    await assert.rejects(bridge.recordTenantBoundaryViolation(boundaryInput({
        context: {
            tenantId: "tenant-a",
            actorId: "trusted-actor-1",
            rawAuth: { token: "nested-redaction-marker" }
        }
    })), TypeError);
    assert.equal(recordCalls, 0);
});

test("unsafe nested data, accessors, symbols and context PII fail before alert recording", async () => {
    let getterCalls = 0;
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const outerGetter = boundaryInput();
    Object.defineProperty(outerGetter, "targetTenantId", {
        get() { getterCalls += 1; return "getter-target"; }
    });
    const actorGetter = { tenantId: "tenant-a" };
    Object.defineProperty(actorGetter, "actorId", {
        get() { getterCalls += 1; return "getter-actor"; }
    });
    const payloads = [
        outerGetter,
        boundaryInput({ context: actorGetter }),
        boundaryInput({ context: { tenantId: "tenant-a", actorId: "contact@invalid.example" } }),
        boundaryInput({ context: { tenantId: "tenant-a", actorId: ["nested"] } }),
        boundaryInput({ [Symbol("unsafe")]: "redaction-marker" })
    ];

    for (const payload of payloads) {
        await assert.rejects(bridge.recordTenantBoundaryViolation(payload), TypeError);
    }
    assert.equal(getterCalls, 0);
    assert.equal(recordCalls, 0);
});

test("TenantAccessGuard independently fans one denial to Phase 6 and Phase 8 source scope", async () => {
    const phase6 = [];
    const phase8 = [];
    const guard = createTenantAccessGuard({
        abuseMonitor: {
            async recordTenantBoundaryViolation(input) { phase6.push(input); }
        },
        securityOperations: {
            async recordTenantBoundaryViolation(input) { phase8.push(input); }
        }
    });
    const requestId = crypto.randomUUID();

    await rejectCode(guard.authorize({
        context: {
            role: "tenant_owner",
            tenantId: "tenant-a",
            actorId: "trusted-actor-1"
        },
        tenantId: "tenant-b",
        permission: "tenant.read",
        requestId,
        operation: "tenant.profile.read"
    }));

    assert.deepEqual(phase6, [{
        tenantId: "tenant-a",
        requestId,
        operation: "tenant.profile.read"
    }]);
    assert.deepEqual(phase8, [{
        context: { tenantId: "tenant-a", actorId: "trusted-actor-1" },
        errorCode: "TENANT_SCOPE_MISMATCH",
        operation: "tenant.profile.read",
        requestId
    }]);
    assert.ok(!JSON.stringify([...phase6, ...phase8]).includes("tenant-b"));
});

test("Phase 6 and Phase 8 failures are independent and preserve the original denial code", async () => {
    let phase6Successes = 0;
    let phase8Successes = 0;
    const cases = [
        {
            abuseMonitor: {
                async recordTenantBoundaryViolation() { throw new Error("phase6-private-marker"); }
            },
            securityOperations: {
                async recordTenantBoundaryViolation() { phase8Successes += 1; }
            },
            expectedMessages: ["Tenant boundary security signal kaydı başarısız."]
        },
        {
            abuseMonitor: {
                async recordTenantBoundaryViolation() { phase6Successes += 1; }
            },
            securityOperations: {
                async recordTenantBoundaryViolation() { throw new Error("phase8-private-marker"); }
            },
            expectedMessages: ["Central tenant-boundary security alert kaydı başarısız."]
        },
        {
            abuseMonitor: {
                async recordTenantBoundaryViolation() { throw new Error("phase6-private-marker"); }
            },
            securityOperations: {
                async recordTenantBoundaryViolation() { throw new Error("phase8-private-marker"); }
            },
            expectedMessages: [
                "Central tenant-boundary security alert kaydı başarısız.",
                "Tenant boundary security signal kaydı başarısız."
            ]
        }
    ];

    for (const dependencies of cases) {
        const { expectedMessages, ...guardDependencies } = dependencies;
        const guard = createTenantAccessGuard(guardDependencies);
        const { result, messages } = await captureConsoleErrors(async () => {
            try {
                await guard.authorize({
                    context: {
                        role: "tenant_owner",
                        tenantId: "tenant-a",
                        actorId: "trusted-actor-1"
                    },
                    tenantId: "private-target-marker",
                    permission: "tenant.read",
                    requestId: crypto.randomUUID(),
                    operation: "tenant.profile.read"
                });
            } catch (error) {
                return error;
            }
            return null;
        });
        assert.equal(result.code, "TENANT_SCOPE_MISMATCH");
        assert.deepEqual(messages.sort(), expectedMessages.sort());
        assert.ok(messages.every(message => !message.includes("marker")));
    }
    assert.equal(phase6Successes, 1);
    assert.equal(phase8Successes, 1);
});

test("actual Phase 6 signal and Phase 8 alert remain separate single observations", async () => {
    const signals = createSecuritySignalService({
        store: createInMemorySecuritySignalStore()
    });
    const abuseMonitor = createAbuseMonitor({
        securitySignals: signals,
        windowMs: 60_000,
        threshold: 5
    });
    const alertSink = createInMemorySecurityAlertSink();
    const bridge = createSecurityOperationsBridge({
        alertService: createSecurityAlertService({ sink: alertSink })
    });
    const guard = createTenantAccessGuard({ abuseMonitor, securityOperations: bridge });

    await rejectCode(guard.authorize({
        context: {
            role: "tenant_owner",
            tenantId: "tenant-a",
            actorId: "trusted-actor-1"
        },
        tenantId: "tenant-b",
        permission: "tenant.read",
        requestId: crypto.randomUUID(),
        operation: "tenant.profile.read"
    }));

    const phase6 = await signals.listTenant({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: "tenant-a",
        limit: 20
    });
    const phase8 = await alertSink.list({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: "tenant-a",
        limit: 20
    });
    const targetAlerts = await alertSink.list({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: "tenant-b",
        limit: 20
    });

    assert.equal(phase6.length, 1);
    assert.equal(phase6[0].count, 1);
    assert.equal(phase8.length, 1);
    assert.equal(phase8[0].eventCount, 1);
    assert.equal(Object.hasOwn(phase8[0], "count"), false);
    assert.deepEqual(targetAlerts, []);
});

test("durable runtime bridge contract persists only beneath the source tenant path", async () => {
    const { db, records } = createFirestoreMock();
    const bridge = createRuntimeSecurityOperations({
        db,
        config: DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
    });

    await bridge.recordTenantBoundaryViolation(boundaryInput({
        targetTenantId: "tenant-b"
    }));

    assert.equal(records.size, 1);
    const [[path, alert]] = records;
    assert.match(path, /^tenants\/tenant-a\/securityAlerts\/[a-f0-9]{64}$/);
    assert.ok(!path.includes("tenant-b"));
    assert.equal(alert.tenantId, "tenant-a");
    assert.equal(alert.actorId, "trusted-actor-1");
    assert.equal(alert.eventCount, 1);
});
