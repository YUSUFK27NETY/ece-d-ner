const test = require("node:test");
const assert = require("node:assert/strict");
const {
    SECURITY_EVENT_SEVERITIES,
    SECURITY_EVENT_OPERATIONS,
    normalizeSecurityEvent,
    securityEventScopeKey
} = require("../src/security/security-alert-model");
const {
    securityEventFromStepUpDenial,
    securityEventFromTenantBoundary,
    securityEventFromAuthFailure
} = require("../src/security/security-alert-adapters");
const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG,
    normalizePlatformSecurityAlertsConfig
} = require("../src/config/platform-security-alerts-config");
const {
    DEFAULT_PLATFORM_GUARDRAILS_CONFIG,
    loadPlatformGuardrailsConfig,
    normalizePlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const { createPlatformAdminStepUpPolicy } = require("../src/auth/platform-admin-step-up");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const OCCURRED_AT = "2026-09-05T11:59:59.000Z";
const REQUEST_ID = "bb21288c-1881-4c3a-b837-3a389b950a30";
const CORRELATION_ID = "d951bc47-c49a-4efb-929d-b72d6da41b84";
const OPTIONS = { nowMs: NOW };

function eventInput(overrides = {}) {
    return {
        eventType: "auth_anomaly",
        source: "platform.admin.auth",
        tenantId: "tenant-a",
        actorId: "admin-1",
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
        occurredAt: OCCURRED_AT,
        reasonCode: "AUTH_ANOMALY",
        operation: "platform.admin.auth",
        ...overrides
    };
}

function normalize(overrides = {}) {
    return normalizeSecurityEvent(eventInput(overrides), OPTIONS);
}

function assertSafeRejection(action) {
    assert.throws(action, error => {
        assert.ok(error instanceof TypeError);
        assert.ok(!String(error).includes("sentinel"));
        return true;
    });
}

function configWith(overrides = {}) {
    return { ...structuredClone(DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG), ...overrides };
}

function stepUpDecision(authOverrides = {}, operation = "tenant.delete") {
    return createPlatformAdminStepUpPolicy({ clock: () => NOW }).evaluate({
        operation,
        verifiedAuth: {
            actorId: "admin-1",
            platformAdmin: true,
            verified: true,
            authenticatedAtMs: NOW - 30_000,
            verifiedFactors: [],
            ...authOverrides
        }
    });
}

test("security event normalization projects immutable canonical server metadata", () => {
    const input = eventInput();
    const before = structuredClone(input);
    const event = normalizeSecurityEvent(input, OPTIONS);
    assert.deepEqual(event, {
        schemaVersion: 1,
        eventType: "auth_anomaly",
        severity: "warning",
        tenantId: "tenant-a",
        actorId: "admin-1",
        requestId: REQUEST_ID,
        correlationId: CORRELATION_ID,
        source: "platform.admin.auth",
        occurredAt: OCCURRED_AT,
        reasonCode: "AUTH_ANOMALY",
        operation: "platform.admin.auth"
    });
    assert.deepEqual(input, before);
    assert.ok(Object.isFrozen(event));
    input.actorId = "another-admin";
    assert.equal(event.actorId, "admin-1");
});

test("all event classes use server severity; accepted client labels cannot promote or downgrade", () => {
    const expected = {
        repeated_401: "warning", repeated_403: "warning", auth_anomaly: "warning",
        privilege_change: "high", tenant_boundary_violation: "high",
        destructive_operation_attempt: "high", step_up_denied: "warning",
        suspicious_admin_activity: "warning", admin_activity_observed: "info",
        admin_takeover_confirmed: "critical"
    };
    assert.deepEqual(SECURITY_EVENT_SEVERITIES, expected);
    for (const [eventType, severity] of Object.entries(expected)) {
        for (const clientSeverity of [undefined, "info", "warning", "high", "critical"]) {
            assert.equal(normalize({ eventType, severity: clientSeverity }).severity, severity);
        }
    }
});

test("invalid event, severity, source, reason and operation reject without reflecting values", () => {
    const invalidFields = {
        eventType: [undefined, null, "unknown_event", "constructor", "__proto__", "AUTH_ANOMALY", "event-sentinel"],
        severity: [null, true, 2, "warn", "HIGH", "critical-sentinel"],
        source: [undefined, null, "platform.admin.auth ", "client.body", "source-sentinel"],
        reasonCode: [null, "auth_anomaly", "REASON_SENTINEL", "reason-sentinel"],
        operation: ["tenant.future.delete", "tenant.delete ", "TENANT.DELETE", "constructor", "operation-sentinel"]
    };
    for (const [field, values] of Object.entries(invalidFields)) {
        for (const value of values) assertSafeRejection(() => normalize({ [field]: value }));
    }
    for (const operation of [
        "tenant.create", "tenant.update", "tenant.delete", "platform_admin.claim.grant",
        "placement.mutate", "routing.mutate", "migration.apply", "migration.cutover",
        "backup.restore.apply", "secret.rotate", "credential.rotate", "production.destructive"
    ]) {
        assert.ok(SECURITY_EVENT_OPERATIONS.includes(operation));
        assert.equal(normalize({ operation }).operation, operation);
    }
});

test("missing optional identifiers stay null and absent correlation gets an opaque UUID", () => {
    const input = { eventType: "admin_activity_observed", source: "platform.audit" };
    const first = normalizeSecurityEvent(input, OPTIONS);
    const second = normalizeSecurityEvent(input, OPTIONS);
    assert.equal(first.tenantId, null);
    assert.equal(first.actorId, null);
    assert.equal(first.requestId, null);
    assert.equal(first.operation, null);
    assert.equal(first.reasonCode, "UNSPECIFIED");
    assert.equal(first.occurredAt, new Date(NOW).toISOString());
    assert.match(first.correlationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(first.correlationId, second.correlationId);
    assert.equal(normalize({ tenantId: null, actorId: null, requestId: null }).tenantId, null);
});

test("event timestamps require canonical ISO time no later than the validated server clock", () => {
    for (const occurredAt of [
        null, NOW, "2026-09-05", "2026-09-05T12:00:00Z",
        "2026-09-05T15:00:00.000+03:00", "2026-02-30T12:00:00.000Z",
        "1970-01-01T00:00:00.000Z", new Date(NOW + 1).toISOString(), "time-sentinel"
    ]) assertSafeRejection(() => normalize({ occurredAt }));
    for (const nowMs of [0, -1, NaN, Infinity, String(NOW), NOW + 0.5, 8_640_000_000_000_001]) {
        assertSafeRejection(() => normalizeSecurityEvent(eventInput(), { nowMs }));
    }
    assert.equal(normalize({ occurredAt: new Date(NOW).toISOString() }).occurredAt, new Date(NOW).toISOString());
});

test("scalar secrets, auth data, bodies and PII are dropped from the serialized event", () => {
    const event = normalize({
        token: "token-sentinel", authorization: "authorization-sentinel",
        cookie: "cookie-sentinel", body: "body-sentinel", rawRequestBody: "request-sentinel",
        password: "sentinel", secret: "secret-sentinel", credential: "credential-sentinel",
        rawProviderPayload: "provider-sentinel", email: "email-sentinel@invalid.example",
        phone: "phone-sentinel", name: "name-sentinel", ip: "ip-sentinel", apiKey: "key-sentinel",
        metadata: { token: "metadata-sentinel", arbitrary: 123, approved: true, ignored: null }
    });
    const serialized = JSON.stringify(event);
    assert.ok(!serialized.includes("sentinel"));
    assert.deepEqual(Object.keys(event).sort(), [
        "schemaVersion", "eventType", "severity", "tenantId", "actorId", "requestId",
        "correlationId", "source", "occurredAt", "reasonCode", "operation"
    ].sort());
});

test("nested metadata and arbitrary object payloads reject instead of being traversed or serialized", () => {
    for (const extra of [
        { metadata: { raw: { secret: "nested-sentinel" } } },
        { metadata: { items: ["array-sentinel"] } },
        { metadata: null }, { metadata: [] },
        { body: { password: "sentinel" } }, { provider: { token: "provider-sentinel" } },
        { arbitrary: new Date(NOW) }, { token: () => "function-sentinel" },
        { metadata: { arbitrary: 1n } }, { symbolValue: Symbol("symbol-sentinel") }
    ]) assertSafeRejection(() => normalize(extra));
});

test("unsafe prototypes, poison keys, accessors and symbols reject without evaluating payload hooks", () => {
    let hookCalls = 0;
    const withGetter = eventInput();
    Object.defineProperty(withGetter, "body", { get() { hookCalls++; return "getter-sentinel"; } });
    const metadataGetter = {};
    Object.defineProperty(metadataGetter, "raw", { get() { hookCalls++; return "getter-sentinel"; } });
    const payloads = [
        withGetter, eventInput({ metadata: metadataGetter }),
        Object.assign(Object.create({ inherited: "prototype-sentinel" }), eventInput()),
        Object.assign(Object.create(null), eventInput()),
        eventInput({ toJSON() { hookCalls++; return "serialization-sentinel"; } }),
        eventInput({ [Symbol("key-sentinel")]: "symbol-sentinel" }),
        eventInput({ metadata: { [Symbol("key-sentinel")]: "symbol-sentinel" } })
    ];
    for (const key of ["__proto__", "constructor", "prototype"]) {
        const top = eventInput();
        Object.defineProperty(top, key, { value: "unsafe-sentinel", enumerable: true });
        payloads.push(top);
        const metadata = {};
        Object.defineProperty(metadata, key, { value: "unsafe-sentinel", enumerable: true });
        payloads.push(eventInput({ metadata }));
    }
    for (const payload of payloads) assertSafeRejection(() => normalizeSecurityEvent(payload, OPTIONS));
    assert.equal(hookCalls, 0);
    assert.equal({}.inherited, undefined);
});

test("invalid tenant and actor identifiers reject instead of canonicalizing or echoing raw PII", () => {
    for (const tenantId of ["Tenant-A", " tenant-a", "tenant-a ", "ab", "tenant/a", "tenant_a", "a".repeat(64), "pii-sentinel@invalid.example", 123]) {
        assertSafeRejection(() => normalize({ tenantId }));
    }
    for (const actorId of ["", "admin 1", "actor\nsentinel", "pii-sentinel@invalid.example", "https://sentinel.invalid", "1234567890", "a".repeat(129), 123]) {
        assertSafeRejection(() => normalize({ actorId }));
    }
    assert.equal(normalize({ actorId: "Admin_1-safe" }).actorId, "Admin_1-safe");
});

test("request and correlation identifiers reject free-form, malformed and noncanonical values", () => {
    for (const field of ["requestId", "correlationId"]) {
        for (const value of ["", "unknown", "pii-sentinel@invalid.example", "token-sentinel", REQUEST_ID.toUpperCase(), ` ${REQUEST_ID}`, "00000000-0000-0000-0000-000000000000", 123]) {
            assertSafeRejection(() => normalize({ [field]: value }));
        }
    }
    assert.equal(normalize().requestId, REQUEST_ID);
    assert.equal(normalize().correlationId, CORRELATION_ID);
});

test("scope key is stable across occurrence and correlation changes but binds tenant and actor", () => {
    const key = securityEventScopeKey(normalize());
    assert.match(key, /^[0-9a-f]{64}$/);
    const later = normalize({
        occurredAt: new Date(NOW).toISOString(), requestId: CORRELATION_ID, correlationId: REQUEST_ID
    });
    assert.equal(securityEventScopeKey(later), key);
    for (const different of [
        { tenantId: "tenant-b" }, { actorId: "admin-2" }, { source: "security.monitor" },
        { operation: "tenant.read" }, { reasonCode: "PERMISSION_DENIED" },
        { eventType: "suspicious_admin_activity" }
    ]) assert.notEqual(securityEventScopeKey(normalize(different)), key);
    assertSafeRejection(() => securityEventScopeKey({ ...normalize() }));
});

test("unknown tenant and actor scopes cannot collide with real unknown or platform identifiers", () => {
    const keys = [];
    for (const tenantId of [null, "unknown", "platform", "tenant-a"]) {
        for (const actorId of [null, "unknown", "platform", "admin-1"]) {
            keys.push(securityEventScopeKey(normalize({ tenantId, actorId })));
        }
    }
    assert.equal(new Set(keys).size, 16);
    assert.equal(
        securityEventScopeKey(normalize({ tenantId: undefined, actorId: undefined })),
        securityEventScopeKey(normalize({ tenantId: null, actorId: null }))
    );
});

test("central alert config has backward-compatible defaults and immutable independent policies", () => {
    const config = loadPlatformGuardrailsConfig("{}");
    assert.deepEqual(config.security.alerts, DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG);
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.alerts;
    assert.deepEqual(normalizePlatformGuardrailsConfig(legacy).security.alerts, DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG);
    const configured = loadPlatformGuardrailsConfig(JSON.stringify({
        security: { alerts: { repeated401: { countThreshold: 7 } } }
    }));
    assert.equal(configured.security.alerts.repeated401.countThreshold, 7);
    assert.equal(configured.security.alerts.repeated403.countThreshold, 3);
    assert.equal(configured.security.alerts.repeated401.windowMs, 300_000);
    assert.ok(Object.isFrozen(configured.security.alerts));
    assert.ok(Object.isFrozen(configured.security.alerts.repeated401));
    assert.ok(Object.isFrozen(configured.security.alerts.repeated403));
    const input = configWith();
    const normalized = normalizePlatformSecurityAlertsConfig(input);
    input.repeated401.countThreshold = 100;
    input.dedupeWindowMs = 9999;
    assert.equal(normalized.repeated401.countThreshold, 5);
    assert.equal(normalized.dedupeWindowMs, 300_000);
});

test("invalid alert numeric config never coerces strings, booleans, nulls or unsafe numbers", () => {
    const invalid = [null, true, false, "300000", "", "config-sentinel", NaN, Infinity, -1, 0, 1000.5, [], {}];
    for (const field of ["dedupeWindowMs", "maxScopes", "maxEventsPerScope"]) {
        for (const value of invalid) {
            assertSafeRejection(() => normalizePlatformSecurityAlertsConfig(configWith({ [field]: value })));
            assertSafeRejection(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { alerts: { [field]: value } } })));
        }
    }
    for (const policy of ["repeated401", "repeated403"]) {
        for (const field of ["windowMs", "countThreshold", "highThreshold"]) {
            for (const value of invalid) {
                const config = configWith();
                config[policy][field] = value;
                assertSafeRejection(() => normalizePlatformSecurityAlertsConfig(config));
                assertSafeRejection(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { alerts: config } })));
            }
        }
    }
});

test("alert config rejects invalid bounds, threshold ordering and capacity-incompatible thresholds", () => {
    for (const overrides of [
        { dedupeWindowMs: 999 }, { dedupeWindowMs: 3_600_001 },
        { maxScopes: 10_001 }, { maxEventsPerScope: 1 }, { maxEventsPerScope: 10_001 },
        { maxEventsPerScope: 10 },
        { repeated401: { windowMs: 999, countThreshold: 5, highThreshold: 20 } },
        { repeated403: { windowMs: 3_600_001, countThreshold: 3, highThreshold: 10 } },
        { repeated401: { windowMs: 300_000, countThreshold: 1, highThreshold: 20 } },
        { repeated403: { windowMs: 300_000, countThreshold: 10, highThreshold: 10 } },
        { repeated403: { windowMs: 300_000, countThreshold: 10, highThreshold: 9 } },
        { repeated401: { windowMs: 300_000, countThreshold: 5, highThreshold: 1001 } }
    ]) assertSafeRejection(() => normalizePlatformSecurityAlertsConfig(configWith(overrides)));
});

test("alert config unknown keys and unsafe direct inputs reject without reading getters", () => {
    let getterCalls = 0;
    const getter = configWith();
    Object.defineProperty(getter, "dedupeWindowMs", { get() { getterCalls++; return 300_000; } });
    const policyGetter = configWith();
    Object.defineProperty(policyGetter.repeated401, "countThreshold", { get() { getterCalls++; return 5; } });
    for (const input of [
        null, [], {}, getter, policyGetter,
        configWith({ token: "config-sentinel" }),
        configWith({ enabled: false }),
        configWith({ repeated401: { ...DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG.repeated401, password: "sentinel" } }),
        Object.assign(Object.create(null), configWith()),
        configWith({ [Symbol("config-sentinel")]: "config-sentinel" })
    ]) assertSafeRejection(() => normalizePlatformSecurityAlertsConfig(input));
    assert.equal(getterCalls, 0);
    for (const raw of [
        '{"security":{"alerts":null}}',
        '{"security":{"alerts":{"secret":"config-sentinel"}}}',
        '{"security":{"alerts":{"repeated401":{"credential":"config-sentinel"}}}}',
        '{"security":{"alerts":{"__proto__":{"token":"config-sentinel"}}}}'
    ]) assertSafeRejection(() => loadPlatformGuardrailsConfig(raw));
});

test("issued step-up denial maps the decision actor and canonical operation to a safe event", () => {
    const result = stepUpDecision({
        token: "auth-sentinel", email: "email-sentinel@invalid.example",
        rawProviderPayload: { secret: "provider-sentinel" }
    });
    const event = securityEventFromStepUpDenial(result, {
        tenantId: "tenant-a", actorId: "attacker-sentinel", requestId: REQUEST_ID,
        correlationId: CORRELATION_ID, token: "context-sentinel", operation: "tenant.read",
        severity: "critical", occurredAt: OCCURRED_AT
    }, OPTIONS);
    assert.equal(event.eventType, "step_up_denied");
    assert.equal(event.severity, "warning");
    assert.equal(event.actorId, "admin-1");
    assert.equal(event.source, "platform.admin.step_up");
    assert.equal(event.operation, "tenant.delete");
    assert.equal(event.reasonCode, "VERIFIED_FACTOR_REQUIRED");
    assert.equal(event.tenantId, "tenant-a");
    assert.equal(event.requestId, REQUEST_ID);
    assert.equal(event.correlationId, CORRELATION_ID);
    assert.ok(!JSON.stringify(event).includes("sentinel"));
});

test("step-up adapters reject forged, hydrated and allow results without accepting raw auth", () => {
    const denial = stepUpDecision();
    const allow = stepUpDecision({}, "tenant.read");
    assert.equal(allow.decision, "allow");
    for (const result of [
        { ...denial }, JSON.parse(JSON.stringify(denial)),
        { decision: "deny", reasonCode: "AUTH_EXPIRED", token: "forged-sentinel" }, allow, null
    ]) assertSafeRejection(() => securityEventFromStepUpDenial(result, {}, OPTIONS));
    assertSafeRejection(() => securityEventFromStepUpDenial(denial, { rawAuth: { token: "raw-sentinel" } }, OPTIONS));
});

test("unknown step-up operation remains redacted and unverified actor is never promoted by context", () => {
    const unknown = stepUpDecision({}, "operation-sentinel");
    const unknownEvent = securityEventFromStepUpDenial(unknown, {}, OPTIONS);
    assert.equal(unknownEvent.operation, null);
    assert.equal(unknownEvent.reasonCode, "UNKNOWN_OPERATION");
    assert.ok(!JSON.stringify(unknownEvent).includes("sentinel"));
    const unverified = stepUpDecision({ verified: false });
    const event = securityEventFromStepUpDenial(unverified, { actorId: "context-sentinel" }, OPTIONS);
    assert.equal(event.actorId, null);
    assert.equal(event.reasonCode, "UNVERIFIED_AUTH");
    assert.ok(!JSON.stringify(event).includes("sentinel"));
});

test("issued denial for a trusted step-up extension still maps without leaking an unregistered operation", () => {
    const decision = createPlatformAdminStepUpPolicy({
        clock: () => NOW,
        additionalOperations: { "tenant.custom": "high" }
    }).evaluate({
        operation: "tenant.custom",
        verifiedAuth: {
            actorId: "admin-1", platformAdmin: true, verified: true,
            authenticatedAtMs: NOW - 30_000, verifiedFactors: []
        }
    });
    const event = securityEventFromStepUpDenial(decision, { tenantId: "tenant-a" }, OPTIONS);
    assert.equal(event.eventType, "step_up_denied");
    assert.equal(event.reasonCode, "VERIFIED_FACTOR_REQUIRED");
    assert.equal(event.operation, null);
    assert.equal(event.actorId, "admin-1");
});

test("boundary adapter validates the outer envelope before evaluating any accessors", () => {
    let calls = 0;
    for (const key of ["context", "operation", "requestId", "unknown"]) {
        const envelope = {
            context: { tenantId: "tenant-a", actorId: "admin-1" },
            errorCode: "TENANT_SCOPE_MISMATCH"
        };
        Object.defineProperty(envelope, key, { get() { calls++; return "getter-sentinel"; } });
        assertSafeRejection(() => securityEventFromTenantBoundary(envelope, OPTIONS));
    }
    assert.equal(calls, 0);
    assertSafeRejection(() => securityEventFromTenantBoundary({
        context: { tenantId: "tenant-a" }, errorCode: "TENANT_SCOPE_MISMATCH",
        body: { secret: "nested-sentinel" }
    }, OPTIONS));
});

test("tenant boundary event is high severity and uses the authorized source tenant context", () => {
    for (const errorCode of ["TENANT_SCOPE_MISMATCH", "TENANT_BOUNDARY_VIOLATION"]) {
        const event = securityEventFromTenantBoundary({
            context: { tenantId: "tenant-a", actorId: "admin-1", token: "context-sentinel" },
            tenantId: "tenant-b", targetTenantId: "tenant-b", actorId: "actor-sentinel",
            severity: "info", errorCode, operation: "tenant.update",
            requestId: REQUEST_ID, correlationId: CORRELATION_ID, occurredAt: OCCURRED_AT
        }, OPTIONS);
        assert.equal(event.eventType, "tenant_boundary_violation");
        assert.equal(event.severity, "high");
        assert.equal(event.source, "tenant.authorization");
        assert.equal(event.tenantId, "tenant-a");
        assert.equal(event.actorId, "admin-1");
        assert.equal(event.reasonCode, errorCode);
        assert.equal(event.operation, "tenant.update");
        assert.ok(!JSON.stringify(event).includes("sentinel"));
        assert.ok(!JSON.stringify(event).includes("tenant-b"));
    }
});

test("tenant boundary adapter rejects missing source tenant, unsafe contexts and nonboundary reasons", () => {
    for (const context of [undefined, null, {}, { tenantId: null }, { tenantId: "Tenant-A" }, { tenantId: "tenant-a", raw: { token: "nested-sentinel" } }]) {
        assertSafeRejection(() => securityEventFromTenantBoundary({ context, tenantId: "tenant-b", errorCode: "TENANT_SCOPE_MISMATCH" }, OPTIONS));
    }
    for (const errorCode of [undefined, "PERMISSION_DENIED", "TENANT_NOT_FOUND", "error-sentinel"]) {
        assertSafeRejection(() => securityEventFromTenantBoundary({ context: { tenantId: "tenant-a" }, errorCode }, OPTIONS));
    }
});

test("auth failure helper returns one server observation, never caller counts, severity or type", () => {
    for (const statusCode of [401, 403]) {
        const event = securityEventFromAuthFailure({
            statusCode, tenantId: "tenant-a", actorId: "admin-1", requestId: REQUEST_ID,
            correlationId: CORRELATION_ID, occurredAt: OCCURRED_AT,
            eventType: "admin_takeover_confirmed", source: "security.monitor", severity: "critical",
            count: 9999, eventCount: 9999, rollingCount: 9999, duplicateCount: 9999,
            reasonCode: "ADMIN_TAKEOVER_CONFIRMED", token: "auth-sentinel", email: "pii-sentinel@invalid.example"
        }, OPTIONS);
        assert.equal(event.eventType, statusCode === 401 ? "repeated_401" : "repeated_403");
        assert.equal(event.reasonCode, statusCode === 401 ? "AUTHENTICATION_FAILED" : "PERMISSION_DENIED");
        assert.equal(event.source, "platform.admin.auth");
        assert.equal(event.severity, "warning");
        assert.equal(event.operation, "platform.admin.auth");
        assert.equal(event.tenantId, "tenant-a");
        for (const key of ["count", "eventCount", "rollingCount", "duplicateCount"]) assert.equal(Object.hasOwn(event, key), false);
        assert.ok(!JSON.stringify(event).includes("sentinel"));
    }
});

test("auth failure helper requires exact numeric 401 or 403 and rejects arbitrary nested payloads", () => {
    for (const statusCode of [undefined, null, "401", "403", 400, 404, 500, true]) {
        assertSafeRejection(() => securityEventFromAuthFailure({ statusCode, token: "auth-sentinel" }, OPTIONS));
    }
    assertSafeRejection(() => securityEventFromAuthFailure({ statusCode: 401, body: { password: "sentinel" } }, OPTIONS));
    assertSafeRejection(() => securityEventFromAuthFailure({ statusCode: 403, operation: "operation-sentinel" }, OPTIONS));
});
