const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const { createPlatformAdminStepUpPolicy } = require("../src/auth/platform-admin-step-up");
const { createInMemorySecurityAlertSink } = require("../src/security/in-memory-security-alert-sink");
const { createSecurityAlertService } = require("../src/security/security-alert-service");
const { createSecurityOperationsBridge } = require("../src/security/security-operations-bridge");

const NOW_MS = Date.parse("2026-01-15T12:00:00.000Z");

function createPolicy(options = {}) {
    return createPlatformAdminStepUpPolicy({ clock: () => NOW_MS, ...options });
}

function verifiedAuth(overrides = {}) {
    return {
        actorId: "platform-admin-1",
        platformAdmin: true,
        verified: true,
        authenticatedAtMs: NOW_MS - 30_000,
        verifiedFactors: [],
        ...overrides
    };
}

function issuedDenial(operation = "tenant.delete", authOverrides = {}) {
    return createPolicy().evaluate({
        operation,
        verifiedAuth: verifiedAuth(authOverrides)
    });
}

function bridgeInput(result, overrides = {}) {
    return {
        result,
        tenantId: "tenant-a",
        requestId: crypto.randomUUID(),
        ...overrides
    };
}

test("issued step-up denial becomes exactly one server-owned central event", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const input = bridgeInput(issuedDenial());

    const event = await bridge.recordStepUpDenial(input);

    assert.equal(recorded.length, 1);
    assert.equal(recorded[0], event);
    assert.deepEqual({
        eventType: event.eventType,
        severity: event.severity,
        source: event.source,
        reasonCode: event.reasonCode,
        operation: event.operation,
        tenantId: event.tenantId,
        actorId: event.actorId,
        requestId: event.requestId
    }, {
        eventType: "step_up_denied",
        severity: "warning",
        source: "platform.admin.step_up",
        reasonCode: "VERIFIED_FACTOR_REQUIRED",
        operation: "tenant.delete",
        tenantId: "tenant-a",
        actorId: "platform-admin-1",
        requestId: input.requestId
    });
    assert.equal(Object.hasOwn(event, "count"), false);
});

test("allow decisions are rejected without recording an alert", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const allow = createPolicy().evaluate({
        operation: "tenant.read",
        verifiedAuth: verifiedAuth()
    });

    await assert.rejects(bridge.recordStepUpDenial(bridgeInput(allow)), TypeError);
    assert.equal(recordCalls, 0);
});

test("forged, copied and JSON-hydrated decisions are rejected", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const issued = issuedDenial();
    const payloads = [
        { ...issued },
        JSON.parse(JSON.stringify(issued)),
        {
            actorId: "platform-admin-1",
            operation: "tenant.delete",
            riskLevel: "high",
            decision: "deny",
            reasonCode: "VERIFIED_FACTOR_REQUIRED",
            authAgeMs: 30_000,
            remainingFreshnessMs: 270_000,
            freshnessBucket: "recent",
            verifiedFactorType: null
        }
    ];

    for (const result of payloads) {
        await assert.rejects(bridge.recordStepUpDenial(bridgeInput(result)), TypeError);
    }
    assert.equal(recordCalls, 0);
});

test("unknown operation is redacted and only its reason code survives", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const rawOperation = "caller.private.operation.redaction-marker";
    const result = issuedDenial(rawOperation);

    const event = await bridge.recordStepUpDenial(bridgeInput(result));

    assert.equal(result.operation, "unknown");
    assert.equal(event.operation, null);
    assert.equal(event.reasonCode, "UNKNOWN_OPERATION");
    assert.equal(recorded.length, 1);
    assert.ok(!JSON.stringify(event).includes(rawOperation));
});

test("unverified auth actor is never promoted into the central event", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const result = issuedDenial("tenant.delete", { verified: false });

    const event = await bridge.recordStepUpDenial(bridgeInput(result));

    assert.equal(result.reasonCode, "UNVERIFIED_AUTH");
    assert.equal(event.actorId, null);
    assert.equal(recorded.length, 1);
    await assert.rejects(bridge.recordStepUpDenial(bridgeInput(result, {
        actorId: "caller-promoted-actor"
    })), TypeError);
    assert.equal(recorded.length, 1);
});

test("raw auth metadata and sensitive markers cannot reach the alert", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const marker = "private-redaction-marker";
    const result = issuedDenial("tenant.delete", {
        token: marker,
        assertion: marker,
        body: { marker },
        providerPayload: { marker },
        email: `person-${marker}@invalid.example`
    });

    const event = await bridge.recordStepUpDenial(bridgeInput(result));

    assert.equal(recorded.length, 1);
    assert.ok(!JSON.stringify(result).includes(marker));
    assert.ok(!JSON.stringify(event).includes(marker));
    for (const field of ["token", "assertion", "body", "providerPayload", "email"]) {
        assert.equal(Object.hasOwn(event, field), false);
    }
});

test("caller-owned alert fields and sensitive payloads fail closed", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const result = issuedDenial();
    for (const extra of [
        { severity: "critical" },
        { eventType: "admin_takeover_confirmed" },
        { source: "security.monitor" },
        { reasonCode: "ADMIN_TAKEOVER_CONFIRMED" },
        { operation: "production.destructive" },
        { actorId: "caller-actor" },
        { count: 50 },
        { correlationId: crypto.randomUUID() },
        { token: "redaction-marker" },
        { body: { raw: "redaction-marker" } }
    ]) {
        await assert.rejects(
            bridge.recordStepUpDenial({ ...bridgeInput(result), ...extra }),
            TypeError
        );
    }
    assert.equal(recordCalls, 0);
});

test("tenant and request scope validation rejects malformed or accessor input", async () => {
    let getterCalls = 0;
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const result = issuedDenial();
    const accessorInput = bridgeInput(result);
    Object.defineProperty(accessorInput, "tenantId", {
        get() { getterCalls += 1; return "tenant-a"; }
    });
    const invalid = [
        bridgeInput(result, { tenantId: "Tenant-A" }),
        bridgeInput(result, { requestId: "caller-request" }),
        { result, tenantId: "tenant-a" },
        accessorInput,
        bridgeInput(result, { [Symbol("unsafe")]: "redaction-marker" })
    ];

    for (const input of invalid) {
        await assert.rejects(bridge.recordStepUpDenial(input), TypeError);
    }
    assert.equal(getterCalls, 0);
    assert.equal(recordCalls, 0);
});

test("one bridge call records one tenant-bound central security alert", async () => {
    const sink = createInMemorySecurityAlertSink();
    let recordCalls = 0;
    const service = createSecurityAlertService({ sink });
    const bridge = createSecurityOperationsBridge({
        alertService: {
            async record(event) {
                recordCalls += 1;
                return service.record(event);
            }
        }
    });

    const alert = await bridge.recordStepUpDenial(bridgeInput(issuedDenial()));
    const alerts = await sink.list({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: "tenant-a"
    });

    assert.equal(recordCalls, 1);
    assert.equal(alert.eventCount, 1);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0], alert);
    assert.equal(alert.tenantId, "tenant-a");
    assert.equal(alert.eventType, "step_up_denied");
});
