const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { createRequirePlatformAdmin } = require("../src/auth/require-platform-admin");
const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
} = require("../src/config/platform-security-alerts-config");
const { PLATFORM_ADMIN_OPERATION_RISKS } = require("../src/auth/platform-admin-step-up");
const { createAbuseMonitor } = require("../src/security/abuse-monitor");
const {
    PRIVILEGE_CHANGE_OPERATIONS,
    DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS
} = require("../src/security/security-alert-adapters");
const { createSecurityOperationsBridge } = require("../src/security/security-operations-bridge");
const { createRuntimeSecurityOperations } = require("../server");

function recordingBridge() {
    const events = [];
    const bridge = createSecurityOperationsBridge({
        alertService: {
            async record(event) {
                events.push(event);
                return event;
            }
        }
    });
    return { bridge, events };
}

function createFirestoreMock() {
    const records = new Map();
    const db = {
        doc(documentPath) {
            return Object.freeze({
                path: documentPath,
                id: documentPath.slice(documentPath.lastIndexOf("/") + 1)
            });
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
            for (const [documentPath, value] of writes) records.set(documentPath, value);
            return result;
        }
    };
    return { db, records };
}

function privilegeInput(operation, overrides = {}) {
    return {
        context: { actorId: "platform-admin-1" },
        operation,
        requestId: crypto.randomUUID(),
        ...overrides
    };
}

function destructiveInput(operation, overrides = {}) {
    return {
        context: { tenantId: "tenant-a", actorId: "platform-admin-1" },
        operation,
        requestId: crypto.randomUUID(),
        ...overrides
    };
}

async function issueAuthAnomalyObservation() {
    let observation = null;
    const monitor = createAbuseMonitor({
        securitySignals: { async emit(input) { return input; } },
        securityOperations: {
            async recordAuthAnomaly(input) {
                observation = input;
                return null;
            }
        },
        windowMs: 60_000,
        threshold: 2
    });
    await monitor.recordDenied({
        operation: "platform.admin.auth",
        statusCode: 401,
        requestId: crypto.randomUUID()
    });
    await monitor.recordDenied({
        operation: "platform.admin.auth",
        statusCode: 401,
        requestId: crypto.randomUUID()
    });
    return observation;
}

test("trusted repeated-auth threshold issues one safe auth anomaly event", async () => {
    const phase6Signals = [];
    const { bridge, events } = recordingBridge();
    const monitor = createAbuseMonitor({
        securitySignals: {
            async emit(input) {
                phase6Signals.push(input);
                return input;
            }
        },
        securityOperations: bridge,
        windowMs: 60_000,
        threshold: 3
    });

    for (let index = 0; index < 3; index += 1) {
        await monitor.recordDenied({
            operation: "platform.admin.auth",
            statusCode: 401,
            requestId: crypto.randomUUID()
        });
    }

    assert.equal(phase6Signals.length, 1);
    assert.equal(phase6Signals[0].count, 3);
    assert.equal(events.length, 1);
    assert.deepEqual({
        eventType: events[0].eventType,
        severity: events[0].severity,
        source: events[0].source,
        tenantId: events[0].tenantId,
        actorId: events[0].actorId,
        operation: events[0].operation,
        reasonCode: events[0].reasonCode
    }, {
        eventType: "auth_anomaly",
        severity: "warning",
        source: "security.monitor",
        tenantId: null,
        actorId: null,
        operation: "platform.admin.auth",
        reasonCode: "AUTH_ANOMALY"
    });
    assert.equal(Object.hasOwn(events[0], "count"), false);
});

test("runtime auth anomaly bridge persists one durable platform-scoped alert", async () => {
    const { db, records } = createFirestoreMock();
    const securityOperations = createRuntimeSecurityOperations({
        db,
        config: DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
    });
    const monitor = createAbuseMonitor({
        securitySignals: { async emit(input) { return input; } },
        securityOperations,
        windowMs: 60_000,
        threshold: 2
    });

    await monitor.recordDenied({
        operation: "platform.admin.auth",
        statusCode: 403,
        requestId: crypto.randomUUID()
    });
    await monitor.recordDenied({
        operation: "platform.admin.auth",
        statusCode: 403,
        requestId: crypto.randomUUID()
    });

    assert.equal(records.size, 1);
    const [[documentPath, alert]] = records;
    assert.match(documentPath, /^platformSecurityAlerts\/[a-f0-9]{64}$/);
    assert.equal(alert.eventType, "auth_anomaly");
    assert.equal(alert.tenantId, null);
    assert.equal(alert.eventCount, 1);
    assert.equal(Object.hasOwn(alert, "count"), false);
});

test("auth anomaly bridge accepts only a single issued threshold observation", async () => {
    const observation = await issueAuthAnomalyObservation();
    const { bridge, events } = recordingBridge();

    await assert.rejects(bridge.recordAuthAnomaly({ ...observation }), TypeError);
    await assert.rejects(
        bridge.recordAuthAnomaly(JSON.parse(JSON.stringify(observation))),
        TypeError
    );
    await bridge.recordAuthAnomaly(observation);
    await assert.rejects(bridge.recordAuthAnomaly(observation), TypeError);
    assert.equal(events.length, 1);
});

test("repeated 401 runtime path keeps one observation per denial without double counting", async () => {
    const phase6Signals = [];
    const authFailures = [];
    const authAnomalies = [];
    const securityOperations = {
        async recordAuthFailure(input) { authFailures.push(input); },
        async recordAuthAnomaly(input) { authAnomalies.push(input); }
    };
    const abuseMonitor = createAbuseMonitor({
        securitySignals: {
            async emit(input) {
                phase6Signals.push(input);
                return input;
            }
        },
        securityOperations,
        windowMs: 60_000,
        threshold: 3
    });
    const guard = createRequirePlatformAdmin({
        auth: { async verifyIdToken() { throw new Error("not called"); } },
        abuseMonitor,
        securityOperations
    });

    for (let index = 0; index < 3; index += 1) {
        const response = {
            status(code) { this.statusCode = code; return this; },
            json(body) { this.body = body; return this; }
        };
        await guard({ headers: {}, requestId: crypto.randomUUID() }, response, () => {});
        assert.equal(response.statusCode, 401);
    }

    assert.equal(authFailures.length, 3);
    assert.equal(authAnomalies.length, 1);
    assert.equal(phase6Signals.length, 1);
    assert.equal(phase6Signals[0].count, 3);
    assert.equal(Object.hasOwn(authAnomalies[0], "count"), false);
});

test("privilege change contract accepts only the exact server-owned allowlist", async () => {
    assert.deepEqual(PRIVILEGE_CHANGE_OPERATIONS, [
        "platform_admin.claim.grant",
        "platform_admin.claim.revoke",
        "platform_admin.provision"
    ]);
    const { bridge, events } = recordingBridge();

    for (const operation of PRIVILEGE_CHANGE_OPERATIONS) {
        const event = await bridge.recordPrivilegeChange(privilegeInput(operation));
        assert.equal(event.eventType, "privilege_change");
        assert.equal(event.severity, "high");
        assert.equal(event.source, "platform.audit");
        assert.equal(event.tenantId, null);
        assert.equal(event.actorId, "platform-admin-1");
        assert.equal(event.operation, operation);
    }
    assert.equal(events.length, PRIVILEGE_CHANGE_OPERATIONS.length);
});

test("destructive attempt contract is derived from exact server-owned high-risk operations", async () => {
    const expected = Object.entries(PLATFORM_ADMIN_OPERATION_RISKS)
        .filter(([operation, riskLevel]) =>
            riskLevel === "high" && !PRIVILEGE_CHANGE_OPERATIONS.includes(operation))
        .map(([operation]) => operation);
    assert.deepEqual(DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS, expected);
    const { bridge, events } = recordingBridge();

    for (const operation of DESTRUCTIVE_OPERATION_ATTEMPT_OPERATIONS) {
        const event = await bridge.recordDestructiveOperationAttempt(
            destructiveInput(operation)
        );
        assert.equal(event.eventType, "destructive_operation_attempt");
        assert.equal(event.severity, "high");
        assert.equal(event.source, "platform.audit");
        assert.equal(event.tenantId, "tenant-a");
        assert.equal(event.actorId, "platform-admin-1");
        assert.equal(event.operation, operation);
    }
    assert.equal(events.length, expected.length);
});

test("client severity, risk and arbitrary operations fail closed", async () => {
    const { bridge, events } = recordingBridge();
    await assert.rejects(bridge.recordPrivilegeChange(privilegeInput(
        "platform_admin.claim.grant",
        { severity: "critical" }
    )), TypeError);
    await assert.rejects(bridge.recordDestructiveOperationAttempt(destructiveInput(
        "tenant.delete",
        { riskLevel: "high" }
    )), TypeError);
    await assert.rejects(
        bridge.recordPrivilegeChange(privilegeInput("platform_admin.claim.promote")),
        TypeError
    );
    await assert.rejects(
        bridge.recordDestructiveOperationAttempt(destructiveInput("tenant.update")),
        TypeError
    );
    await assert.rejects(
        bridge.recordDestructiveOperationAttempt(destructiveInput("tenant.future.delete")),
        TypeError
    );
    assert.equal(events.length, 0);
});

test("operational event contracts reject secret, body and PII payloads", async () => {
    const { bridge, events } = recordingBridge();
    const marker = "private-redaction-marker";
    const attempts = [
        () => bridge.recordPrivilegeChange(privilegeInput(
            "platform_admin.claim.grant",
            { token: marker }
        )),
        () => bridge.recordPrivilegeChange(privilegeInput(
            "platform_admin.provision",
            { body: { password: marker } }
        )),
        () => bridge.recordDestructiveOperationAttempt(destructiveInput(
            "tenant.delete",
            { email: `person-${marker}@invalid.example` }
        )),
        () => bridge.recordDestructiveOperationAttempt(destructiveInput(
            "production.destructive",
            { context: { tenantId: "tenant-a", actorId: "platform-admin-1", secret: marker } }
        ))
    ];

    for (const attempt of attempts) {
        await assert.rejects(
            attempt(),
            error => error instanceof TypeError && !String(error).includes(marker)
        );
    }
    assert.equal(events.length, 0);
});

test("tenant boundary bridge remains source-tenant bound and discards target tenant", async () => {
    const { bridge, events } = recordingBridge();
    const event = await bridge.recordTenantBoundaryViolation({
        context: { tenantId: "tenant-a", actorId: "tenant-actor-1" },
        errorCode: "TENANT_SCOPE_MISMATCH",
        operation: "tenant.profile.read",
        requestId: crypto.randomUUID(),
        targetTenantId: "tenant-b"
    });

    assert.equal(event.tenantId, "tenant-a");
    assert.equal(event.actorId, "tenant-actor-1");
    assert.ok(!JSON.stringify(event).includes("tenant-b"));
    assert.equal(events.length, 1);
});

test("contract-only events and tenant boundary have no fabricated production wiring", () => {
    const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const claimScript = fs.readFileSync(
        path.join(__dirname, "../scripts/set-platform-admin-claim.js"),
        "utf8"
    );

    assert.match(
        serverSource,
        /createAbuseMonitor\(\{[\s\S]*?securitySignals,[\s\S]*?securityOperations,[\s\S]*?windowMs:/
    );
    assert.ok(!serverSource.includes("recordPrivilegeChange("));
    assert.ok(!serverSource.includes("recordDestructiveOperationAttempt("));
    assert.ok(!serverSource.includes("createTenantAccessGuard"));
    assert.ok(!claimScript.includes("security-operations-bridge"));
    assert.ok(!claimScript.includes("recordPrivilegeChange("));
});
