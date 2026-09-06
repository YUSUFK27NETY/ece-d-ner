const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { once } = require("node:events");

const {
    createPlatformApp,
    normalizeSecurityAlertLimit,
    projectSecurityAlertList
} = require("../src/http/create-platform-app");
const { createRuntimeSecurityOperations } = require("../server");

const ALERT_FIELDS = Object.freeze([
    "schemaVersion", "alertId", "dedupeKey", "eventType", "severity", "tenantId",
    "actorId", "requestId", "correlationId", "source", "occurredAt", "reasonCode",
    "operation", "eventCount", "duplicateCount", "rollingCount", "firstSeenAt", "lastSeenAt"
]);

function alertFixture(overrides = {}) {
    const alertId = overrides.alertId || "a".repeat(64);
    const occurredAt = "2026-09-06T12:00:00.000Z";
    return {
        schemaVersion: 1,
        alertId,
        dedupeKey: alertId,
        eventType: "step_up_denied",
        severity: "warning",
        tenantId: "tenant-a",
        actorId: "platform-admin-1",
        requestId: crypto.randomUUID(),
        correlationId: crypto.randomUUID(),
        source: "platform.admin.step_up",
        occurredAt,
        reasonCode: "AUTH_EXPIRED",
        operation: "tenant.delete",
        eventCount: 1,
        duplicateCount: 0,
        rollingCount: 1,
        firstSeenAt: occurredAt,
        lastSeenAt: occurredAt,
        ...overrides
    };
}

function tenantRegistryFixture() {
    const calls = [];
    return {
        calls,
        async getById(tenantId) { calls.push(["getById", tenantId]); return null; },
        async list() { return []; },
        async create(input) { return input; },
        async update(tenantId, input) { return { ...input, tenantId }; }
    };
}

async function startTestServer({
    securityAlertReader,
    usageTelemetry = null,
    tenantRateLimiter = null,
    tenantRateLimitPolicy = null
} = {}) {
    const readerCalls = [];
    const tenantRegistry = tenantRegistryFixture();
    const reader = securityAlertReader || {
        async list(input) {
            readerCalls.push(structuredClone(input));
            return [alertFixture({ tenantId: input.tenantId })];
        }
    };
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (token === "tenant-token") {
                return { uid: "tenant-user-1", platformAdmin: false };
            }
            throw new Error("Auth verification failed.");
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        securityAlertReader: reader,
        usageTelemetry,
        tenantRateLimiter,
        tenantRateLimitPolicy
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();

    return {
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        readerCalls,
        tenantRegistry
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function adminHeaders(extra = {}) {
    return { Authorization: "Bearer platform-token", ...extra };
}

async function captureConsoleErrors(action) {
    const original = console.error;
    const messages = [];
    console.error = (...args) => { messages.push(args.join(" ")); };
    try {
        return { result: await action(), messages };
    } finally {
        console.error = original;
    }
}

test("optional security alert reader validates its read contract at startup", () => {
    const base = {
        auth: { async verifyIdToken() { return { uid: "admin", platformAdmin: true }; } },
        tenantRegistry: tenantRegistryFixture()
    };

    assert.doesNotThrow(() => createPlatformApp(base));
    assert.throws(
        () => createPlatformApp({ ...base, securityAlertReader: {} }),
        /reader/
    );
});

test("security alert endpoints require authenticated platformAdmin", async () => {
    const fixture = await startTestServer();
    try {
        const missing = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts`
        );
        const nonAdmin = await fetch(`${fixture.baseUrl}/api/platform/security-alerts`, {
            headers: { Authorization: "Bearer tenant-token" }
        });
        const admin = await fetch(`${fixture.baseUrl}/api/platform/security-alerts`, {
            headers: adminHeaders()
        });

        assert.equal(missing.status, 401);
        assert.equal(nonAdmin.status, 403);
        assert.equal(admin.status, 200);
        assert.equal(fixture.readerCalls.length, 1);
    } finally {
        await closeServer(fixture.server);
    }
});

test("tenant endpoint uses strict scope, trusted actor context and default limit", async () => {
    const fixture = await startTestServer();
    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts` +
            "?tenantId=tenant-b&actorId=caller-actor",
            { headers: adminHeaders() }
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.alerts.length, 1);
        assert.deepEqual(fixture.readerCalls, [{
            context: { role: "platform_admin", actorId: "platform-admin-1" },
            tenantId: "tenant-a",
            limit: 20
        }]);
        assert.deepEqual(fixture.tenantRegistry.calls, []);
    } finally {
        await closeServer(fixture.server);
    }
});

test("security alert limit accepts canonical HTTP integers and rejects coercion", async () => {
    for (const valid of [1, 20, 200, "1", "20", "200"]) {
        assert.equal(normalizeSecurityAlertLimit(valid), Number(valid));
    }
    for (const invalid of [0, 201, -1, 1.5, "20x", "1.5", "01", "", null, [20], { value: 20 }]) {
        assert.throws(() => normalizeSecurityAlertLimit(invalid), TypeError);
    }

    const fixture = await startTestServer();
    try {
        for (const limit of ["1", "200"]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts?limit=${limit}`,
                { headers: adminHeaders() }
            );
            assert.equal(response.status, 200);
        }
        for (const query of [
            "limit=0", "limit=201", "limit=-1", "limit=1.5", "limit=20x",
            "limit=null", "limit=", "limit=20&limit=20"
        ]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts?${query}`,
                { headers: adminHeaders() }
            );
            const body = await response.json();
            assert.equal(response.status, 400, query);
            assert.deepEqual(body, {
                success: false,
                message: "Güvenlik uyarısı sorgusu geçersiz."
            });
        }
        assert.deepEqual(fixture.readerCalls.map(call => call.limit), [1, 200]);
    } finally {
        await closeServer(fixture.server);
    }
});

test("tenant endpoint rejects noncanonical tenant IDs before reader access", async () => {
    const fixture = await startTestServer();
    try {
        for (const tenantId of ["Tenant-A", "ab", "tenant%2Fescape"]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/${tenantId}/security-alerts`,
                { headers: adminHeaders() }
            );
            assert.equal(response.status, 400, tenantId);
        }
        assert.deepEqual(fixture.readerCalls, []);
    } finally {
        await closeServer(fixture.server);
    }
});

test("platform endpoint queries only null scope and never aggregates tenant alerts", async () => {
    const calls = [];
    const platformAlert = alertFixture({ tenantId: null });
    const tenantAlert = alertFixture({ alertId: "b".repeat(64), tenantId: "tenant-a" });
    const fixture = await startTestServer({
        securityAlertReader: {
            async list(input) {
                calls.push(structuredClone(input));
                return input.tenantId === null ? [platformAlert] : [tenantAlert];
            }
        }
    });
    try {
        const response = await fetch(`${fixture.baseUrl}/api/platform/security-alerts`, {
            headers: adminHeaders()
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(calls, [{
            context: { role: "platform_admin", actorId: "platform-admin-1" },
            tenantId: null,
            limit: 20
        }]);
        assert.equal(body.alerts.length, 1);
        assert.equal(body.alerts[0].tenantId, null);
        assert.ok(!body.alerts.some(alert => alert.alertId === tenantAlert.alertId));
    } finally {
        await closeServer(fixture.server);
    }
});

test("API response keeps only the durable reader allowlist projection", async () => {
    const sentinel = "private-response-sentinel";
    const fixture = await startTestServer({
        securityAlertReader: {
            async list() {
                return [{
                    ...alertFixture(),
                    token: sentinel,
                    secret: sentinel,
                    email: sentinel,
                    body: { sentinel },
                    providerPayload: { sentinel }
                }];
            }
        }
    });
    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts`,
            { headers: adminHeaders() }
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(body.alerts[0]), ALERT_FIELDS);
        assert.ok(!JSON.stringify(body).includes(sentinel));
    } finally {
        await closeServer(fixture.server);
    }
});

test("reader and persisted validation failures return one generic safe 500", async () => {
    const sentinel = "private-provider-sentinel";
    const cases = [
        {
            async list() {
                const error = new Error(sentinel);
                error.code = "SECURITY_ALERT_READ_FAILED";
                throw error;
            }
        },
        {
            async list() {
                throw new TypeError(`Malformed persisted ${sentinel}`);
            }
        },
        {
            async list() {
                return [{ alertId: sentinel }];
            }
        }
    ];

    for (const securityAlertReader of cases) {
        const fixture = await startTestServer({ securityAlertReader });
        try {
            const { result: response, messages } = await captureConsoleErrors(() => fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts`,
                { headers: adminHeaders() }
            ));
            const body = await response.json();

            assert.equal(response.status, 500);
            assert.deepEqual(body, {
                success: false,
                message: "Güvenlik uyarıları alınamadı."
            });
            assert.deepEqual(messages, ["Platform güvenlik uyarıları okunamadı."]);
            assert.ok(!JSON.stringify(body).includes(sentinel));
            assert.ok(!messages.join(" ").includes(sentinel));
        } finally {
            await closeServer(fixture.server);
        }
    }
});

test("tenant alert route remains behind tenant telemetry and rate limiting", async () => {
    const order = [];
    const fixture = await startTestServer({
        securityAlertReader: {
            async list(input) {
                order.push(["reader", input.tenantId]);
                return [alertFixture()];
            }
        },
        usageTelemetry: {
            async record(input) { order.push(["telemetry", input]); }
        },
        tenantRateLimiter: {
            consume(input) {
                order.push(["limiter", input]);
                return { allowed: true, remaining: 9 };
            }
        },
        tenantRateLimitPolicy: {
            sustainedWindowMs: 60_000,
            sustainedMax: 10,
            burstWindowMs: 10_000,
            burstMax: 5
        }
    });
    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts`,
            { headers: adminHeaders() }
        );
        assert.equal(response.status, 200);
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(order[0][0], "limiter");
        assert.deepEqual(order[0][1], {
            tenantId: "tenant-a",
            policy: {
                sustainedWindowMs: 60_000,
                sustainedMax: 10,
                burstWindowMs: 10_000,
                burstMax: 5
            },
            scope: "admin_tenant"
        });
        assert.deepEqual(order[1], ["reader", "tenant-a"]);
        assert.equal(order[2][0], "telemetry");
        assert.equal(order[2][1].tenantId, "tenant-a");
        assert.equal(order[2][1].operation, "platform.tenant.read");
        assert.equal(order[2][1].statusCode, 200);
    } finally {
        await closeServer(fixture.server);
    }
});

test("alert URLs expose no POST, PATCH or DELETE mutation handler", async () => {
    const fixture = await startTestServer();
    try {
        for (const method of ["POST", "PATCH", "DELETE"]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/security-alerts`,
                {
                    method,
                    headers: adminHeaders({ "Content-Type": "application/json" }),
                    body: JSON.stringify({ tenantId: "tenant-b", actorId: "caller-actor" })
                }
            );
            assert.equal(response.status, 404, method);
        }
        assert.deepEqual(fixture.readerCalls, []);
    } finally {
        await closeServer(fixture.server);
    }
});

test("runtime operations helper reuses an explicitly shared durable sink", async () => {
    const emitted = [];
    const sharedSink = {
        async emit(alert) { emitted.push(alert); return alert; },
        async list() { return []; }
    };
    const securityOperations = createRuntimeSecurityOperations({
        db: null,
        securityAlertSink: sharedSink
    });

    await securityOperations.recordTenantBoundaryViolation({
        context: { tenantId: "tenant-a", actorId: "actor-a" },
        errorCode: "TENANT_SCOPE_MISMATCH",
        operation: "tenant.read",
        requestId: crypto.randomUUID(),
        targetTenantId: "tenant-b"
    });

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].tenantId, "tenant-a");
    assert.equal(typeof sharedSink.list, "function");
});

test("response projector rejects malformed reader shapes without reading extras", () => {
    assert.throws(() => projectSecurityAlertList({}), TypeError);
    assert.throws(() => projectSecurityAlertList([null]), TypeError);
    assert.throws(() => projectSecurityAlertList([{ alertId: "a".repeat(64) }]), TypeError);
});
