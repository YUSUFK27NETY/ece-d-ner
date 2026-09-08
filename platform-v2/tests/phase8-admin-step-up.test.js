const test = require("node:test");
const assert = require("node:assert/strict");
const {
    PLATFORM_ADMIN_OPERATION_RISKS,
    createPlatformAdminStepUpPolicy,
    buildStepUpAuditMetadata
} = require("../src/auth/platform-admin-step-up");
const {
    DEFAULT_PLATFORM_STEP_UP_CONFIG,
    normalizePlatformStepUpConfig
} = require("../src/config/platform-step-up-config");
const {
    DEFAULT_PLATFORM_GUARDRAILS_CONFIG,
    loadPlatformGuardrailsConfig,
    normalizePlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const { createAuditEvent } = require("../src/audit/audit-event");
const { createFirestoreAuditWriter } = require("../src/firestore/firestore-audit-writer");
const { authorizeTenantAction } = require("../src/auth/authorize-tenant-action");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const TTL = 300_000;

function verifiedAuth(overrides = {}) {
    return {
        actorId: "platform-admin-1",
        platformAdmin: true,
        verified: true,
        authenticatedAtMs: NOW - 60_000,
        verifiedFactors: [{
            type: "passkey",
            verified: true,
            actorId: "platform-admin-1",
            authenticatedAtMs: NOW - 60_000,
            verifiedAtMs: NOW - 60_000
        }],
        ...overrides
    };
}

function policy(options = {}) {
    return createPlatformAdminStepUpPolicy({ clock: () => NOW, ...options });
}

function decide(auth = verifiedAuth(), options = {}) {
    return policy(options).evaluate({ operation: "backup.restore.apply", verifiedAuth: auth });
}

test("recent verified platformAdmin with event-bound factor allows a high-risk decision", () => {
    const result = decide();
    assert.deepEqual(result, {
        actorId: "platform-admin-1",
        operation: "backup.restore.apply",
        riskLevel: "high",
        decision: "allow",
        reasonCode: "POLICY_SATISFIED",
        authAgeMs: 60_000,
        remainingFreshnessMs: 240_000,
        freshnessBucket: "recent",
        verifiedFactorType: "passkey"
    });
    assert.ok(Object.isFrozen(result));
});

test("high-risk missing or malformed actors and non-admin claims fail closed", () => {
    for (const actorId of [undefined, null, "", " ", "a@invalid.example", "id\nvalue", {}, "a".repeat(129)]) {
        const result = decide(verifiedAuth({ actorId }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "MISSING_ACTOR");
        assert.equal(result.actorId, null);
    }
    for (const platformAdmin of [undefined, null, false, "true", 1, {}, "platform_admin"]) {
        const result = decide(verifiedAuth({ platformAdmin, role: "platform_admin" }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "NOT_PLATFORM_ADMIN");
    }
    assert.equal(decide(null).decision, "deny");
});

test("provider metadata must be explicitly verified, never inferred from enrollment or role", () => {
    for (const verified of [undefined, null, false, "true", 1]) {
        const result = decide(verifiedAuth({ verified }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "UNVERIFIED_AUTH");
        assert.equal(result.actorId, null);
    }
    const rawProviderPayload = verifiedAuth({
        authenticatedAtMs: undefined,
        auth_time: NOW / 1000,
        iat: NOW / 1000,
        refreshedAtMs: NOW,
        firebase: { sign_in_provider: "google.com", sign_in_second_factor: "totp" }
    });
    assert.equal(decide(rawProviderPayload).reasonCode, "AUTH_TIME_MISSING");
});

test("missing and invalid authentication timestamps deny without type coercion", () => {
    for (const authenticatedAtMs of [undefined, null]) {
        const result = decide(verifiedAuth({ authenticatedAtMs }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "AUTH_TIME_MISSING");
        assert.equal(result.remainingFreshnessMs, 0);
    }
    for (const authenticatedAtMs of [NaN, Infinity, -1, 0, NOW + 1, NOW - 0.5, String(NOW), new Date(NOW), [], true]) {
        const result = decide(verifiedAuth({ authenticatedAtMs }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "AUTH_TIME_INVALID");
        assert.equal(result.freshnessBucket, "invalid");
        assert.equal(result.authAgeMs, null);
    }
    assert.equal(decide(verifiedAuth({ authenticatedAtMs: NOW / 1000 })).decision, "deny");
});

test("expired auth, including the exact TTL boundary, denies despite a newer factor", () => {
    for (const age of [TTL, TTL + 1, TTL * 10]) {
        const auth = verifiedAuth({ authenticatedAtMs: NOW - age });
        auth.verifiedFactors[0].authenticatedAtMs = NOW - age;
        auth.verifiedFactors[0].verifiedAtMs = NOW;
        const result = decide(auth);
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "AUTH_EXPIRED");
        assert.equal(result.authAgeMs, age);
        assert.equal(result.freshnessBucket, "expired");
        assert.equal(result.remainingFreshnessMs, 0);
    }
    const auth = verifiedAuth({ authenticatedAtMs: NOW - TTL + 1 });
    auth.verifiedFactors[0].authenticatedAtMs = NOW - TTL + 1;
    const result = decide(auth);
    assert.equal(result.decision, "allow");
    assert.equal(result.remainingFreshnessMs, 1);
});

test("high risk requires a verified allowed factor for the same actor and authentication event", () => {
    const goodFactor = verifiedAuth().verifiedFactors[0];
    const invalidFactors = [
        undefined, null, [], {}, [null],
        [{ ...goodFactor, verified: false }],
        [{ ...goodFactor, verified: "true" }],
        [{ ...goodFactor, verified: undefined, enrolled: true }],
        [{ ...goodFactor, type: "password" }],
        [{ ...goodFactor, type: "google.com" }],
        [{ ...goodFactor, actorId: "another-admin" }],
        [{ ...goodFactor, actorId: undefined }],
        [{ ...goodFactor, authenticatedAtMs: NOW - 120_000 }],
        [{ ...goodFactor, authenticatedAtMs: undefined }],
        [{ ...goodFactor, verifiedAtMs: undefined }],
        [{ ...goodFactor, verifiedAtMs: NOW + 1 }],
        [{ ...goodFactor, verifiedAtMs: NOW - 60_001 }],
        [{ ...goodFactor, verifiedAtMs: String(NOW) }]
    ];
    for (const verifiedFactors of invalidFactors) {
        const result = decide(verifiedAuth({ verifiedFactors, mfaEnrolled: true }));
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "VERIFIED_FACTOR_REQUIRED");
        assert.equal(result.verifiedFactorType, null);
    }
});

test("configured factor allowlist supports verified passkey, TOTP and security-key evidence only", () => {
    for (const type of ["passkey", "totp", "security_key"]) {
        const auth = verifiedAuth();
        auth.verifiedFactors[0].type = type;
        assert.equal(decide(auth).decision, "allow");
        const restricted = decide(auth, {
            config: { elevatedSessionTtlMs: TTL, requiredFactorTypes: ["passkey"] }
        });
        assert.equal(restricted.decision, type === "passkey" ? "allow" : "deny");
    }
});

test("all risk levels need verified admin identity; medium adds freshness and high adds factor", () => {
    const engine = policy();
    const noFreshness = verifiedAuth({ authenticatedAtMs: undefined, verifiedFactors: [] });
    assert.equal(engine.evaluate({ operation: "tenant.read", verifiedAuth: noFreshness }).decision, "allow");
    assert.equal(engine.evaluate({ operation: "tenant.update", verifiedAuth: noFreshness }).reasonCode, "AUTH_TIME_MISSING");
    const noFactor = verifiedAuth({ verifiedFactors: [] });
    assert.equal(engine.evaluate({ operation: "tenant.create", verifiedAuth: noFactor }).decision, "allow");
    assert.equal(engine.evaluate({ operation: "tenant.delete", verifiedAuth: noFactor }).reasonCode, "VERIFIED_FACTOR_REQUIRED");
    for (const operation of Object.keys(PLATFORM_ADMIN_OPERATION_RISKS)) {
        assert.equal(engine.evaluate({ operation }).decision, "deny");
        assert.equal(engine.evaluate({ operation, verifiedAuth: verifiedAuth({ platformAdmin: false }) }).decision, "deny");
    }
});

test("critical operation classes cannot bypass the high-risk gate", () => {
    for (const operation of [
        "tenant.delete", "platform_admin.claim.grant", "platform_admin.claim.revoke",
        "platform_admin.provision", "placement.mutate", "routing.mutate", "migration.apply",
        "migration.cutover", "backup.restore.apply", "secret.rotate", "credential.rotate",
        "production.destructive"
    ]) {
        const result = policy().evaluate({
            operation, riskLevel: "low", verifiedAuth: verifiedAuth({ verifiedFactors: [] })
        });
        assert.equal(result.riskLevel, "high");
        assert.equal(result.decision, "deny");
    }
});

test("unknown or malformed operations deny as high risk and never echo raw operation data", () => {
    for (const operation of ["migration.future_apply", "constructor", "__proto__", "tenant.delete.extra", "TENANT.READ", "tenant.read ", "private-value@invalid.example", null, {}]) {
        const result = policy().evaluate({ operation, riskLevel: "low", verifiedAuth: verifiedAuth() });
        assert.equal(result.decision, "deny");
        assert.equal(result.riskLevel, "high");
        assert.equal(result.reasonCode, "UNKNOWN_OPERATION");
        assert.equal(result.operation, "unknown");
    }
});

test("trusted operation extensions are additive and cannot override built-in policies", () => {
    const extensions = { "tenant.archive.apply": "high" };
    const engine = policy({ additionalOperations: extensions });
    extensions["tenant.archive.apply"] = "low";
    assert.equal(engine.evaluate({ operation: "tenant.archive.apply", verifiedAuth: verifiedAuth() }).decision, "allow");
    assert.equal(engine.evaluate({ operation: "tenant.archive.apply", verifiedAuth: verifiedAuth({ verifiedFactors: [] }) }).decision, "deny");
    for (const additionalOperations of [
        { "tenant.delete": "low" }, { "tenant.delete": "high" },
        { "tenant.archive": "unsupported" }, { "free form operation": "low" },
        JSON.parse('{"__proto__":"low"}'), null, []
    ]) {
        const result = decide(verifiedAuth(), { additionalOperations });
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "INVALID_OPERATION_POLICY");
    }
});

test("central guardrail config integrates backward-compatible immutable step-up defaults", () => {
    const defaults = loadPlatformGuardrailsConfig("{}");
    assert.deepEqual(defaults.security.stepUp, DEFAULT_PLATFORM_STEP_UP_CONFIG);
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.stepUp;
    assert.deepEqual(normalizePlatformGuardrailsConfig(legacy).security.stepUp, DEFAULT_PLATFORM_STEP_UP_CONFIG);
    const configured = loadPlatformGuardrailsConfig(JSON.stringify({
        security: { stepUp: { elevatedSessionTtlMs: 120_000, requiredFactorTypes: ["passkey"] } }
    }));
    assert.ok(Object.isFrozen(configured.security.stepUp));
    assert.ok(Object.isFrozen(configured.security.stepUp.requiredFactorTypes));
    assert.equal(decide(verifiedAuth(), { config: configured.security.stepUp }).remainingFreshnessMs, 60_000);
    assert.equal(loadPlatformGuardrailsConfig('{"security":{"stepUp":{"elevatedSessionTtlMs":120000}}}').security.stepUp.requiredFactorTypes.length, 3);
});

test("invalid TTL fails closed in both direct policy and central config without reflecting values", () => {
    for (const elevatedSessionTtlMs of [0, -1, 999, 900_001, 1500.5, NaN, Infinity, null, true, false, "300000", "", "sensitive-sentinel", [], {}]) {
        const config = { elevatedSessionTtlMs, requiredFactorTypes: ["passkey"] };
        assert.throws(() => normalizePlatformStepUpConfig(config), /elevatedSessionTtlMs geçersiz/);
        assert.throws(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { stepUp: config } })), /elevatedSessionTtlMs geçersiz/);
        const result = decide(verifiedAuth(), { config });
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "INVALID_CONFIG");
        assert.equal(result.remainingFreshnessMs, 0);
        assert.equal(policy({ config }).evaluate({ operation: "tenant.read", verifiedAuth: verifiedAuth() }).decision, "deny");
        assert.ok(!JSON.stringify(result).includes("sensitive-sentinel"));
    }
});

test("invalid factor config, unknown keys and unsafe objects cannot disable high-risk checks", () => {
    for (const requiredFactorTypes of [[], null, "passkey", ["password"], ["passkey", "passkey"], new Array(1)]) {
        assert.equal(decide(verifiedAuth(), { config: { elevatedSessionTtlMs: TTL, requiredFactorTypes } }).reasonCode, "INVALID_CONFIG");
    }
    for (const config of [null, [], {}, { ...DEFAULT_PLATFORM_STEP_UP_CONFIG, enabled: false }]) {
        assert.equal(decide(verifiedAuth(), { config }).reasonCode, "INVALID_CONFIG");
    }
    for (const raw of [
        '{"security":{"stepUp":null}}',
        '{"security":{"stepUp":{"credential":"sensitive-sentinel"}}}',
        '{"security":{"stepUp":{"__proto__":{"elevatedSessionTtlMs":900000}}}}'
    ]) {
        assert.throws(() => loadPlatformGuardrailsConfig(raw), error => {
            assert.ok(!error.message.includes("sensitive-sentinel"));
            return error instanceof TypeError;
        });
    }
});

test("decisions are recalculated per call; the clock and normalized policy cannot extend a session", () => {
    let now = NOW;
    const config = { elevatedSessionTtlMs: TTL, requiredFactorTypes: ["passkey"] };
    const engine = createPlatformAdminStepUpPolicy({ config, clock: () => now });
    const input = { operation: "backup.restore.apply", verifiedAuth: verifiedAuth() };
    assert.equal(engine.evaluate(input).decision, "allow");
    config.elevatedSessionTtlMs = 900_000;
    config.requiredFactorTypes.push("password");
    now += TTL;
    assert.equal(engine.evaluate(input).reasonCode, "AUTH_EXPIRED");
    for (const clock of [() => NaN, () => NOW.toString(), () => 0, null, () => { throw new Error("sensitive-sentinel"); }]) {
        const result = decide(verifiedAuth(), { clock });
        assert.equal(result.decision, "deny");
        assert.equal(result.reasonCode, "INVALID_CLOCK");
        assert.ok(!JSON.stringify(result).includes("sensitive-sentinel"));
    }
});

test("audit metadata exposes only allowlisted decision fields, never raw authentication or PII", () => {
    const auth = verifiedAuth({
        token: "token-sentinel", credential: "credential-sentinel",
        email: "pii-sentinel@invalid.example", phone: "phone-sentinel",
        rawAuth: { privateKey: "private-key-sentinel", claims: "claims-sentinel" }
    });
    auth.verifiedFactors[0].credentialId = "factor-id-sentinel";
    auth.verifiedFactors[0].raw = "factor-payload-sentinel";
    const input = { operation: "backup.restore.apply", verifiedAuth: auth, secret: "input-sentinel" };
    const before = structuredClone(input);
    const result = policy().evaluate(input);
    assert.deepEqual(input, before);
    const metadata = buildStepUpAuditMetadata(result);
    assert.deepEqual(Object.keys(metadata).sort(), [
        "actorId", "operation", "riskLevel", "decision", "reasonCode", "authAgeMs",
        "freshnessBucket", "verifiedFactorType"
    ].sort());
    assert.equal(metadata.verifiedFactorType, "passkey");
    assert.ok(Object.isFrozen(metadata));
    assert.ok(!JSON.stringify({ result, metadata }).includes("sentinel"));
    assert.throws(() => buildStepUpAuditMetadata({ ...result, token: "token-sentinel" }), /doğrulanmış karar/);
    assert.throws(() => buildStepUpAuditMetadata(auth), /doğrulanmış karar/);
    assert.equal(buildStepUpAuditMetadata(decide(verifiedAuth({ authenticatedAtMs: NOW - TTL }))).freshnessBucket, "expired");
});

test("step-up metadata fits the existing tenant audit contract without changing tenant binding", async () => {
    const metadata = buildStepUpAuditMetadata(decide());
    const writes = [];
    const writer = createFirestoreAuditWriter({
        db: { doc: path => ({ create: async event => writes.push({ path, event }) }) }
    });
    const event = createAuditEvent({
        tenantId: "tenant-a", action: "platform.admin.step_up.decision",
        actorId: metadata.actorId, metadata, now: new Date(NOW)
    });
    await writer.write(event);
    assert.equal(writes.length, 1);
    assert.ok(writes[0].path.startsWith("tenants/tenant-a/audit/"));
    assert.deepEqual(writes[0].event.metadata, metadata);
    assert.throws(() => createAuditEvent({ action: event.action, metadata }), /tenantId/);
});

test("step-up allow cannot replace RBAC or relax the tenant boundary", () => {
    assert.equal(decide().decision, "allow");
    assert.throws(() => authorizeTenantAction({
        context: { actorId: "platform-admin-1", role: "tenant_owner", tenantId: "tenant-a" },
        tenantId: "tenant-b", permission: "tenant.update"
    }), { code: "TENANT_SCOPE_MISMATCH" });
    assert.throws(() => authorizeTenantAction({
        context: { actorId: "platform-admin-1", role: "viewer", tenantId: "tenant-a" },
        tenantId: "tenant-a", permission: "tenant.update"
    }), { code: "PERMISSION_DENIED" });
});
