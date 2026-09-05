const test = require("node:test");
const assert = require("node:assert/strict");
const {
    BREAK_GLASS_OPERATION_RISKS, normalizeElevatedOperations, normalizeBreakGlassMetadata,
    refreshBreakGlassMetadata, changeBreakGlassMetadata
} = require("../src/break-glass/break-glass-model");
const { DEFAULT_PLATFORM_BREAK_GLASS_CONFIG, normalizePlatformBreakGlassConfig } = require("../src/config/platform-break-glass-config");
const { DEFAULT_PLATFORM_GUARDRAILS_CONFIG, loadPlatformGuardrailsConfig, normalizePlatformGuardrailsConfig } = require("../src/config/platform-guardrails-config");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const TTL = DEFAULT_PLATFORM_BREAK_GLASS_CONFIG.ttlMs;
const iso = value => new Date(value).toISOString();
const FORBIDDEN = ["token", "password", "credential", "secret", "privateKey", "private_key", "rawAuth",
    "body", "cookie", "authorization", "email", "phone", "message", "metadata", "__proto__", "constructor", "prototype"];
function input(extra = {}) {
    return { breakGlassId: "glass-one", actorId: "actor-one", requestedBy: "actor-one", approvedBy: null,
        reasonCode: "INCIDENT_RESPONSE_REQUIRED", scope: "tenant", tenantId: "tenant-one", createdAt: iso(NOW),
        expiresAt: iso(NOW + TTL), status: "requested", incidentId: null,
        elevatedOperations: ["incident.read", "incident.transition"], usedAt: null, revokedAt: null, ...extra };
}
function record(extra = {}, options = {}) { return normalizeBreakGlassMetadata(input(extra), { nowMs: NOW, ...options }); }
function reject(call, code) {
    assert.throws(call, error => {
        assert.ok(error instanceof TypeError);
        if (code) assert.equal(error.code, code);
        assert.ok(!String(error).includes("sentinel"));
        return true;
    });
}

test("break-glass model projects only immutable metadata without session/auth artifacts", () => {
    const raw = input({ incidentId: "incident-pointer" });
    const result = normalizeBreakGlassMetadata(raw, { nowMs: NOW });
    assert.deepEqual(Object.keys(result).sort(), Object.keys(raw).sort());
    raw.elevatedOperations.push("backup.verify");
    assert.deepEqual(result.elevatedOperations, ["incident.read", "incident.transition"]);
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.elevatedOperations));
    assert.equal(result.usedAt, null);
    assert.equal(result.incidentId, "incident-pointer", "opaque pointer only, no incident lookup");
});

test("operation policy is exact server-owned allowlist and never permits destructive operations", () => {
    assert.deepEqual(Object.keys(BREAK_GLASS_OPERATION_RISKS).sort(), ["incident.read", "incident.transition", "tenant.security.read",
        "backup.verify", "credential.rotation.plan", "admin.lockdown.plan"].sort());
    for (const operation of Object.keys(BREAK_GLASS_OPERATION_RISKS)) assert.deepEqual(normalizeElevatedOperations([operation]), [operation]);
    for (const operation of ["production.destructive", "backup.restore.apply", "secret.rotate", "admin.disable", "unknown", "__proto__", "constructor", {}, 1]) {
        reject(() => record({ elevatedOperations: [operation] }), "INVALID_OPERATION");
    }
    reject(() => record({ elevatedOperations: [] }), "INVALID_OPERATION");
});

test("operation arrays reject duplicates, sparse/nested data, accessors, symbols and custom prototypes", () => {
    const extra = ["incident.read"];
    extra.token = "sentinel";
    const symbol = ["incident.read"];
    symbol[Symbol("secret")] = "sentinel";
    const prototype = ["incident.read"];
    Object.setPrototypeOf(prototype, Object.create(Array.prototype));
    let reads = 0;
    const getter = [];
    Object.defineProperty(getter, "0", { get() { reads++; return "incident.read"; } });
    for (const value of [extra, symbol, prototype, getter, new Array(1), ["incident.read", "incident.read"], [["incident.read"]], "incident.read"]) {
        reject(() => normalizeElevatedOperations(value));
    }
    assert.equal(reads, 0);
});

test("reason code and scalar scope are required allowlists with explicit tenant/platform separation", () => {
    for (const reasonCode of [undefined, null, "", "sentinel", { code: "INCIDENT_RESPONSE_REQUIRED" }]) reject(() => record({ reasonCode }));
    for (const extra of [{ scope: undefined }, { scope: "production" }, { scope: {} }, { tenantId: undefined },
        { tenantId: null }, { scope: "platform", tenantId: "tenant-one" }, { tenantId: "Tenant-One" }]) reject(() => record(extra));
    assert.equal(record({ scope: "platform", tenantId: null }).tenantId, null);
    assert.equal(record({ tenantId: "platform" }).scope, "tenant");
});

test("identifiers reject PII, free text, paths, auth-like values and nested objects without coercion", () => {
    for (const field of ["breakGlassId", "actorId", "requestedBy", "approvedBy", "incidentId", "tenantId"]) {
        for (const value of ["user@example.test", "5551234567", "+905551234567", "sentinel text", "Bearer sentinel", "https://example.test/key", "jwt.part.part", {}]) {
            reject(() => record({ [field]: value }));
        }
    }
});

test("required approval and independent approver checks protect requester and beneficiary", () => {
    for (const status of ["approved", "active", "completed"]) reject(() => record({ status }), "APPROVAL_REQUIRED");
    reject(() => record({ approvedBy: "reviewer-one" }), "APPROVAL_REQUIRED");
    reject(() => record({ status: "approved", approvedBy: "actor-one" }), "SEPARATE_APPROVER_REQUIRED");
    reject(() => record({ status: "approved", actorId: "beneficiary", approvedBy: "beneficiary" }), "SEPARATE_APPROVER_REQUIRED");
    assert.equal(record({ status: "approved", approvedBy: "reviewer-one" }).approvedBy, "reviewer-one");
});

test("fixed TTL is anchored to creation; exact deadline expires all nonterminal states", () => {
    for (const status of ["requested", "approved", "active"]) {
        const extra = { status, approvedBy: status === "requested" ? null : "reviewer-one" };
        assert.equal(record(extra, { nowMs: NOW + TTL - 1 }).status, status);
        const expired = record(extra, { nowMs: NOW + TTL });
        assert.equal(expired.status, "expired");
        assert.equal(expired.expiresAt, iso(NOW + TTL));
    }
    for (const expiresAt of [iso(NOW), iso(NOW + TTL + 1), "unlimited", null, Infinity]) reject(() => record({ expiresAt }));
    reject(() => record({ status: "expired" }), "INVALID_EXPIRY");
    reject(() => record({ createdAt: iso(NOW + 1) }));
    reject(() => record({ createdAt: "2026-02-30T00:00:00.000Z" }));
});

test("revocation/completion/denial stay terminal and usedAt cannot invent real usage", () => {
    for (const extra of [
        { status: "revoked", revokedAt: iso(NOW) }, { status: "completed", approvedBy: "reviewer-one" }, { status: "denied" }
    ]) assert.equal(record(extra, { nowMs: NOW + TTL * 2 }).status, extra.status);
    for (const extra of [{ status: "revoked" }, { revokedAt: iso(NOW) }, { status: "revoked", revokedAt: iso(NOW - 1) },
        { status: "revoked", revokedAt: iso(NOW + 1) }, { usedAt: iso(NOW) }]) reject(() => record(extra));
});

test("model transitions preserve identity and cannot reactivate terminal or effectively expired metadata", () => {
    const options = { nowMs: NOW };
    const requested = record();
    const approved = changeBreakGlassMetadata(requested, { status: "approved", approvedBy: "reviewer-one" }, options);
    const active = changeBreakGlassMetadata(approved, { status: "active" }, options);
    assert.equal(active.status, "active");
    reject(() => changeBreakGlassMetadata(requested, { status: "active", approvedBy: "reviewer-one" }, options), "INVALID_TRANSITION");
    reject(() => changeBreakGlassMetadata(active, { status: "completed" }, { nowMs: NOW + TTL }), "INVALID_TRANSITION");
    for (const terminal of [record({ status: "revoked", revokedAt: iso(NOW) }), record({ status: "denied" }),
        record({ status: "completed", approvedBy: "reviewer-one" })]) {
        reject(() => changeBreakGlassMetadata(terminal, { status: "approved", approvedBy: "reviewer-one" }, options), "INVALID_TRANSITION");
    }
    reject(() => changeBreakGlassMetadata(approved, { status: "active", expiresAt: iso(NOW + TTL * 2) }, options));
    reject(() => refreshBreakGlassMetadata({ ...approved }, options));
    reject(() => changeBreakGlassMetadata({ ...approved }, { status: "active" }, options));
});

test("unknown secret fields and allowed-field accessors reject without reading payload values", () => {
    for (const field of [...FORBIDDEN, ...Object.keys(input())]) {
        let reads = 0;
        const candidate = input();
        Object.defineProperty(candidate, field, { get() { reads++; throw new Error("sentinel"); } });
        reject(() => normalizeBreakGlassMetadata(candidate, { nowMs: NOW }));
        assert.equal(reads, 0, field);
    }
    for (const field of FORBIDDEN) reject(() => record({ [field]: "sentinel" }));
});

test("nested arbitrary objects, prototype keys and symbols reject without coercion", () => {
    for (const field of Object.keys(input())) {
        let reads = 0;
        const nested = { secret: "sentinel", get toString() { reads++; return () => "sentinel"; } };
        reject(() => record({ [field]: nested }));
        assert.equal(reads, 0, field);
    }
    for (const candidate of [null, [], Object.assign(Object.create(null), input()),
        Object.assign(Object.create({ token: "sentinel" }), input()), { ...input(), [Symbol("extra")]: "sentinel" }]) {
        reject(() => normalizeBreakGlassMetadata(candidate, { nowMs: NOW }));
    }
});

test("central break-glass defaults remain backward compatible with previous packages", () => {
    assert.deepEqual(normalizePlatformBreakGlassConfig(), {
        ttlMs: 900_000, maxActiveSessions: 1, requireSeparateApprover: true, approvalRequiredForHighRisk: true
    });
    assert.ok(Object.isFrozen(normalizePlatformBreakGlassConfig()));
    assert.ok(Object.isFrozen(DEFAULT_PLATFORM_BREAK_GLASS_CONFIG));
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.breakGlass;
    const normalized = normalizePlatformGuardrailsConfig(legacy);
    assert.deepEqual(normalized.security.breakGlass, DEFAULT_PLATFORM_BREAK_GLASS_CONFIG);
    for (const name of ["stepUp", "alerts", "secretLifecycle", "incidents"]) assert.deepEqual(normalized.security[name], legacy.security[name]);
    assert.deepEqual(loadPlatformGuardrailsConfig("").security.breakGlass, DEFAULT_PLATFORM_BREAK_GLASS_CONFIG);
    const custom = loadPlatformGuardrailsConfig(JSON.stringify({ security: { breakGlass: { ttlMs: 60_000 } } }));
    assert.equal(custom.security.breakGlass.ttlMs, 60_000);
});

test("config rejects unlimited or coerced TTL, invalid limits/flags, unknown fields and getters", () => {
    for (const override of [
        { ttlMs: 0 }, { ttlMs: -1 }, { ttlMs: 59_999 }, { ttlMs: 3_600_001 }, { ttlMs: Infinity }, { ttlMs: "900000" },
        { ttlMs: null }, { ttlMs: 90_000.5 }, { maxActiveSessions: 0 }, { maxActiveSessions: 21 }, { maxActiveSessions: "1" },
        { requireSeparateApprover: undefined }, { requireSeparateApprover: "false" }, { approvalRequiredForHighRisk: 1 },
        { approvalRequiredForHighRisk: null }, { token: "sentinel" }
    ]) reject(() => normalizePlatformBreakGlassConfig({ ...DEFAULT_PLATFORM_BREAK_GLASS_CONFIG, ...override }));
    reject(() => normalizePlatformBreakGlassConfig({}));
    reject(() => normalizePlatformBreakGlassConfig(null));
    for (const field of Object.keys(DEFAULT_PLATFORM_BREAK_GLASS_CONFIG)) {
        let reads = 0;
        const config = { ...DEFAULT_PLATFORM_BREAK_GLASS_CONFIG };
        Object.defineProperty(config, field, { get() { reads++; throw new Error("sentinel"); } });
        reject(() => normalizePlatformBreakGlassConfig(config));
        assert.equal(reads, 0);
    }
    reject(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { breakGlass: { ttlMs: 0 } } })));
    reject(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { breakGlass: { token: "sentinel" } } })));
});
