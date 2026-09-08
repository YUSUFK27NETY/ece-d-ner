const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");

const { createRequirePlatformAdmin } = require("../src/auth/require-platform-admin");
const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
} = require("../src/config/platform-security-alerts-config");
const { createPlatformApp } = require("../src/http/create-platform-app");
const { createAbuseMonitor } = require("../src/security/abuse-monitor");
const { createInMemorySecurityAlertSink } = require("../src/security/in-memory-security-alert-sink");
const { createSecurityAlertService } = require("../src/security/security-alert-service");
const { createSecurityOperationsBridge } = require("../src/security/security-operations-bridge");
const { createRuntimeSecurityOperations } = require("../server");

function createResponse() {
    return {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

async function runGuard({
    authorization,
    verify = async () => ({ uid: "platform-admin-1", platformAdmin: true }),
    abuseMonitor = null,
    securityOperations = null,
    requestId = crypto.randomUUID()
} = {}) {
    const verifyCalls = [];
    const auth = {
        async verifyIdToken(...args) {
            verifyCalls.push(args);
            return verify(...args);
        }
    };
    const req = { headers: {}, requestId };
    if (authorization !== undefined) req.headers.authorization = authorization;
    const res = createResponse();
    let nextCalls = 0;
    const middleware = createRequirePlatformAdmin({ auth, abuseMonitor, securityOperations });
    await middleware(req, res, () => { nextCalls += 1; });
    return { req, res, nextCalls, verifyCalls };
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

test("auth bridge maps one 401 observation to server-owned platform metadata", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });
    const requestId = crypto.randomUUID();

    const result = await bridge.recordAuthFailure({ statusCode: 401, actorId: null, requestId });

    assert.equal(recorded.length, 1);
    assert.equal(result, recorded[0]);
    assert.deepEqual({
        eventType: result.eventType,
        severity: result.severity,
        source: result.source,
        reasonCode: result.reasonCode,
        operation: result.operation,
        tenantId: result.tenantId,
        actorId: result.actorId,
        requestId: result.requestId
    }, {
        eventType: "repeated_401",
        severity: "warning",
        source: "platform.admin.auth",
        reasonCode: "AUTHENTICATION_FAILED",
        operation: "platform.admin.auth",
        tenantId: null,
        actorId: null,
        requestId
    });
});

test("auth bridge maps one 403 observation and preserves only the verified actor", async () => {
    const recorded = [];
    const bridge = createSecurityOperationsBridge({
        alertService: { async record(event) { recorded.push(event); return event; } }
    });

    const event = await bridge.recordAuthFailure({
        statusCode: 403,
        actorId: "verified-admin-1",
        requestId: crypto.randomUUID()
    });

    assert.equal(recorded.length, 1);
    assert.equal(event.eventType, "repeated_403");
    assert.equal(event.reasonCode, "PERMISSION_DENIED");
    assert.equal(event.actorId, "verified-admin-1");
    assert.equal(event.tenantId, null);
    assert.equal(event.operation, "platform.admin.auth");
});

test("auth bridge rejects invalid status, actor attribution, missing request id and caller-owned fields", async () => {
    let recordCalls = 0;
    const bridge = createSecurityOperationsBridge({
        alertService: { async record() { recordCalls += 1; } }
    });
    const requestId = crypto.randomUUID();

    for (const input of [
        { statusCode: 400, actorId: null, requestId },
        { statusCode: 401, actorId: "unverified-actor", requestId },
        { statusCode: 403, actorId: null, requestId },
        { statusCode: 401, actorId: null },
        { statusCode: 401, actorId: null, requestId, count: 5 },
        { statusCode: 401, actorId: null, requestId, severity: "critical" },
        { statusCode: 401, actorId: null, requestId, eventType: "admin_takeover_confirmed" },
        { statusCode: 401, actorId: null, requestId, source: "security.monitor" },
        { statusCode: 401, actorId: null, requestId, reasonCode: "ADMIN_TAKEOVER_CONFIRMED" },
        { statusCode: 401, actorId: null, requestId, operation: "production.destructive" },
        { statusCode: 401, actorId: null, requestId, correlationId: crypto.randomUUID() },
        { statusCode: 401, actorId: null, requestId, token: "redaction-marker" },
        { statusCode: 401, actorId: null, requestId, body: { raw: "redaction-marker" } }
    ]) {
        await assert.rejects(bridge.recordAuthFailure(input), TypeError);
    }
    assert.equal(recordCalls, 0);
});

test("missing and blank authorization each preserve Phase 6 and emit exactly one Phase 8 denial", async () => {
    for (const authorization of [undefined, "Bearer    "]) {
        const phase6 = [];
        const phase8 = [];
        const result = await runGuard({
            authorization,
            abuseMonitor: { async recordDenied(input) { phase6.push(input); } },
            securityOperations: { async recordAuthFailure(input) { phase8.push(input); } }
        });

        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalls, 0);
        assert.equal(result.verifyCalls.length, 0);
        assert.equal(phase6.length, 1);
        assert.equal(phase8.length, 1);
        assert.deepEqual(phase8[0], {
            statusCode: 401,
            actorId: null,
            requestId: result.req.requestId
        });
    }
});

test("verify rejection and missing uid each emit one anonymous 401 observation", async () => {
    for (const verify of [
        async () => { throw new Error("provider-detail-marker"); },
        async () => ({ platformAdmin: true })
    ]) {
        const central = [];
        const { result } = await captureConsoleErrors(() => runGuard({
            authorization: "Bearer rejected-value",
            verify,
            securityOperations: { async recordAuthFailure(input) { central.push(input); } }
        }));

        assert.equal(result.res.statusCode, 401);
        assert.equal(result.nextCalls, 0);
        assert.equal(central.length, 1);
        assert.equal(central[0].statusCode, 401);
        assert.equal(central[0].actorId, null);
        assert.deepEqual(result.verifyCalls[0], ["rejected-value", true]);
    }
});

test("verified non-admin emits one 403 observation with trusted uid", async () => {
    const phase6 = [];
    const phase8 = [];
    const result = await runGuard({
        authorization: "Bearer verified-user-value",
        verify: async () => ({ uid: "verified-user-1", platformAdmin: false }),
        abuseMonitor: { async recordDenied(input) { phase6.push(input); } },
        securityOperations: { async recordAuthFailure(input) { phase8.push(input); } }
    });

    assert.equal(result.res.statusCode, 403);
    assert.equal(result.nextCalls, 0);
    assert.equal(phase6.length, 1);
    assert.deepEqual(phase8, [{
        statusCode: 403,
        actorId: "verified-user-1",
        requestId: result.req.requestId
    }]);
});

test("valid platform admin preserves revoked-token verification and emits no auth failure", async () => {
    const central = [];
    const result = await runGuard({
        authorization: "Bearer valid-admin-value",
        securityOperations: { async recordAuthFailure(input) { central.push(input); } }
    });

    assert.equal(result.res.statusCode, null);
    assert.equal(result.nextCalls, 1);
    assert.deepEqual(result.verifyCalls[0], ["valid-admin-value", true]);
    assert.deepEqual(result.req.platformActor, {
        uid: "platform-admin-1",
        role: "platform_admin"
    });
    assert.equal(central.length, 0);
});

test("Phase 6 and Phase 8 telemetry failures are independent and never change denial responses", async () => {
    let phase6Successes = 0;
    let phase8Successes = 0;
    const cases = [
        {
            authorization: undefined,
            verify: undefined,
            abuseMonitor: { async recordDenied() { throw new Error("phase6-detail-marker"); } },
            securityOperations: { async recordAuthFailure() { phase8Successes += 1; } },
            expectedStatus: 401
        },
        {
            authorization: "Bearer non-admin-value",
            verify: async () => ({ uid: "verified-user-1", platformAdmin: false }),
            abuseMonitor: { async recordDenied() { phase6Successes += 1; } },
            securityOperations: { async recordAuthFailure() { throw new Error("phase8-detail-marker"); } },
            expectedStatus: 403
        },
        {
            authorization: undefined,
            verify: undefined,
            abuseMonitor: { async recordDenied() { throw new Error("phase6-detail-marker"); } },
            securityOperations: { async recordAuthFailure() { throw new Error("phase8-detail-marker"); } },
            expectedStatus: 401
        }
    ];

    for (const options of cases) {
        const { result } = await captureConsoleErrors(() => runGuard(options));
        assert.equal(result.res.statusCode, options.expectedStatus);
        assert.equal(result.nextCalls, 0);
    }
    assert.equal(phase6Successes, 1);
    assert.equal(phase8Successes, 1);
});

test("auth and telemetry logs stay generic without token or provider detail", async () => {
    const { result, messages } = await captureConsoleErrors(() => runGuard({
        authorization: "Bearer private-auth-marker",
        verify: async () => { throw new Error("private-provider-marker"); },
        abuseMonitor: { async recordDenied() { throw new Error("private-phase6-marker"); } },
        securityOperations: { async recordAuthFailure() { throw new Error("private-phase8-marker"); } }
    }));

    assert.equal(result.res.statusCode, 401);
    assert.deepEqual(messages.sort(), [
        "Central security alert kaydı başarısız.",
        "Platform admin auth security signal yazılamadı.",
        "Platform admin token doğrulaması başarısız."
    ].sort());
    assert.ok(!messages.join(" ").includes("marker"));
});

test("five real 401 requests are five Phase 8 observations, not one copied Phase 6 aggregate", async () => {
    const phase6Signals = [];
    const abuseMonitor = createAbuseMonitor({
        securitySignals: {
            async emit(input) {
                phase6Signals.push(input);
                return input;
            }
        },
        windowMs: 60_000,
        threshold: 5
    });
    const sink = createInMemorySecurityAlertSink();
    const service = createSecurityAlertService({ sink });
    const phase8Events = [];
    const securityOperations = createSecurityOperationsBridge({
        alertService: {
            async record(event) {
                phase8Events.push(event);
                return service.record(event);
            }
        }
    });

    for (let index = 0; index < 5; index += 1) {
        const result = await runGuard({ abuseMonitor, securityOperations });
        assert.equal(result.res.statusCode, 401);
    }

    assert.equal(phase6Signals.length, 1);
    assert.equal(phase6Signals[0].count, 5);
    assert.equal(phase8Events.length, 5);
    assert.ok(phase8Events.every(event => !Object.hasOwn(event, "count")));
    const [alert] = await sink.list({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: null
    });
    assert.equal(alert.eventCount, 5);
    assert.equal(alert.rollingCount, 5);
});

test("createPlatformApp forwards its server request id to the central auth bridge", async () => {
    const observations = [];
    const tenantRegistry = {
        async getById() { return null; },
        async list() { return []; },
        async create(input) { return input; },
        async update(id, input) { return { ...input, tenantId: id }; }
    };
    const app = createPlatformApp({
        auth: { async verifyIdToken() { throw new Error("not-called"); } },
        tenantRegistry,
        securityOperations: {
            async recordAuthFailure(input) { observations.push(input); }
        }
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");

    try {
        const { port } = server.address();
        const response = await fetch(`http://127.0.0.1:${port}/api/platform/tenants`);
        assert.equal(response.status, 401);
        assert.equal(observations.length, 1);
        assert.equal(observations[0].requestId, response.headers.get("x-request-id"));
        assert.match(observations[0].requestId, /^[0-9a-f-]{36}$/);
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("runtime factory composes Firestore sink through service and bridge into admin auth", async () => {
    const { db, records } = createFirestoreMock();
    const securityOperations = createRuntimeSecurityOperations({
        db,
        config: DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG
    });

    for (let index = 0; index < 5; index += 1) {
        const result = await runGuard({ securityOperations });
        assert.equal(result.res.statusCode, 401);
    }

    assert.equal(records.size, 1);
    const [[path, alert]] = records;
    assert.match(path, /^platformSecurityAlerts\/[a-f0-9]{64}$/);
    assert.equal(alert.eventType, "repeated_401");
    assert.equal(alert.tenantId, null);
    assert.equal(alert.actorId, null);
    assert.equal(alert.operation, "platform.admin.auth");
    assert.equal(alert.eventCount, 5);
});
