const test = require("node:test");
const assert = require("node:assert/strict");
const { createBreakGlassIntegrationService, buildBreakGlassAuditMetadata } = require("../src/break-glass/break-glass-integration-service");
const { createInMemoryIncidentStore } = require("../src/incidents/in-memory-incident-store");
const { DEFAULT_PLATFORM_STEP_UP_CONFIG } = require("../src/config/platform-step-up-config");
const { DEFAULT_PLATFORM_BREAK_GLASS_CONFIG } = require("../src/config/platform-break-glass-config");
const { DEFAULT_PLATFORM_BREAK_GLASS_INTEGRATION_CONFIG, normalizePlatformBreakGlassIntegrationConfig } = require("../src/config/platform-break-glass-integration-config");
const { DEFAULT_PLATFORM_GUARDRAILS_CONFIG, loadPlatformGuardrailsConfig, normalizePlatformGuardrailsConfig } = require("../src/config/platform-guardrails-config");
const { snapshotBreakGlassAuth } = require("../src/break-glass/break-glass-step-up-adapter");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const CORRELATION = "12345678-1234-4234-8234-123456789012";
const ALL_OPERATIONS = ["incident.read", "incident.transition", "tenant.security.read", "backup.verify", "credential.rotation.plan", "admin.lockdown.plan"];
const AUDIT_FIELDS = ["breakGlassId", "actorId", "approvedBy", "incidentId", "tenantId", "oldStatus", "newStatus", "reasonCode", "operation", "ttlBucket", "freshnessBucket", "decision"];
function scope(tenantId = "tenant-one", actorId = "responder", extra = {}) {
    const scope = tenantId === null ? "platform" : "tenant";
    return { context: { actorId, role: "platform_admin", scope, tenantId }, scope, tenantId, ...extra };
}
function incidentScope(tenantId = "tenant-one") {
    return { context: { actorId: "responder", role: "platform_admin", tenantId }, tenantId };
}
function auth(extra = {}, at = NOW, actorId = "responder") {
    return { actorId, platformAdmin: true, verified: true, authenticatedAtMs: at,
        verifiedFactors: [{ type: "passkey", verified: true, actorId, authenticatedAtMs: at, verifiedAtMs: at }], ...extra };
}
function command(session, actorId = "responder", extra = {}) {
    return scope(session.tenantId, actorId, { breakGlassId: session.breakGlassId, ...extra });
}
function fixture(options = {}) {
    let now = NOW;
    const incidents = createInMemoryIncidentStore({ clock: () => now });
    const service = createBreakGlassIntegrationService({ incidentStore: incidents, clock: () => now, ...options });
    return { incidents, service, setNow: value => { now = value; } };
}
function incident(store, tenantId = "tenant-one", extra = {}) {
    return store.createIncident({ ...incidentScope(tenantId), metadata: {
        category: "auth_anomaly", severity: "high", correlationId: CORRELATION, owner: "security-team", ...extra
    } });
}
function requestInput(linked, extra = {}) {
    return scope(linked?.tenantId ?? null, "responder", { requestId: "request-one", reasonCode: "INCIDENT_RESPONSE_REQUIRED",
        incidentId: linked?.incidentId ?? null, elevatedOperations: ALL_OPERATIONS, ...extra });
}
function allow(result) { assert.equal(result.decision, "allow", result.reasonCode); return result.session; }
function deny(result, reasonCode) {
    assert.equal(result.decision, "deny");
    assert.equal(result.reasonCode, reasonCode);
    assert.equal(result.session, null);
    assert.equal(buildBreakGlassAuditMetadata(result).decision, "deny");
}
function prepared(f, extra = {}) {
    const linked = incident(f.incidents, extra.tenantId === undefined ? "tenant-one" : extra.tenantId, extra.incident || {});
    const session = allow(f.service.requestBreakGlass(requestInput(linked, extra.request || {})));
    allow(f.service.approveBreakGlass(command(session, "approver", { transitionId: "approval-one" })));
    return { linked, session };
}
function activation(session, extra = {}) { return command(session, "responder", { transitionId: "activation-one", verifiedAuth: auth(), ...extra }); }
function authorization(session, extra = {}) { return command(session, "responder", { operation: "incident.read", verifiedAuth: auth(), ...extra }); }
function closeIncident(f, linked, falsePositive = false) {
    const base = { ...incidentScope(linked.tenantId), incidentId: linked.incidentId };
    const proofs = falsePositive ? ["forensic_reference"] : ["containment_attestation", "recovery_attestation", "verification_attestation"];
    for (const type of proofs) f.incidents.attachEvidence({ ...base, evidence: {
        evidenceId: type, evidenceType: type, occurredAt: new Date(NOW).toISOString(), tenantId: linked.tenantId,
        correlationId: CORRELATION, reasonCode: "UNSPECIFIED", referenceId: "opaque-proof"
    } });
    const transitions = falsePositive ? [["false_positive", "forensic_reference"]] : [
        ["triaged"], ["contained", "containment_attestation"], ["recovery_in_progress"],
        ["recovered", "recovery_attestation"], ["verified", "verification_attestation"], ["closed"]
    ];
    for (const [toStatus, evidenceId = null] of transitions) f.incidents.transitionIncident({ ...base, toStatus, evidenceId, transitionId: `move-${toStatus}` });
}

test("Paket 1 recent verified platformAdmin and event-bound factor activate an approved high-incident session", () => {
    const f = fixture();
    const { session, linked } = prepared(f);
    const result = f.service.activateBreakGlass(activation(session));
    const active = allow(result);
    assert.equal(active.status, "active");
    assert.equal(active.incidentId, linked.incidentId);
    assert.equal(active.usedAt, null, "no operation or credential is created");
    assert.deepEqual(buildBreakGlassAuditMetadata(result), {
        breakGlassId: session.breakGlassId, actorId: "responder", approvedBy: "approver", incidentId: linked.incidentId,
        tenantId: "tenant-one", oldStatus: "approved", newStatus: "active", reasonCode: "BREAK_GLASS_LIFECYCLE_RECORDED",
        operation: "break_glass.activate", ttlBucket: "over_five_minutes", freshnessBucket: "recent", decision: "allow"
    });
});

test("critical and platform-scoped incidents are accepted without weakening explicit scope binding", () => {
    for (const tenantId of ["tenant-one", null]) {
        const f = fixture();
        const { session } = prepared(f, { tenantId, incident: { category: "admin_takeover", severity: "critical" } });
        allow(f.service.activateBreakGlass(activation(session)));
        assert.equal(allow(f.service.authorizeBreakGlassOperation(authorization(session))).tenantId, tenantId);
    }
});

test("expired/missing/future auth and non-admin/unverified metadata deny activation without changing approved state", () => {
    const cases = [
        [auth({}, NOW - 300_000), "AUTH_EXPIRED"], [auth({ authenticatedAtMs: null }), "AUTH_TIME_MISSING"],
        [auth({}, NOW + 1), "AUTH_TIME_INVALID"], [auth({ platformAdmin: false }), "NOT_PLATFORM_ADMIN"],
        [auth({ verified: false }), "UNVERIFIED_AUTH"], [null, "MISSING_ACTOR"]
    ];
    for (const [verifiedAuth, reason] of cases) {
        const f = fixture(); const { session } = prepared(f);
        deny(f.service.activateBreakGlass(activation(session, { verifiedAuth })), reason);
        assert.equal(allow(f.service.getBreakGlass(command(session))).status, "approved");
    }
});

test("missing, unverified, wrong actor or wrong auth-event factors cannot satisfy Paket 1 high-risk gate", () => {
    const baseFactor = auth().verifiedFactors[0];
    for (const verifiedFactors of [[], undefined, [{ ...baseFactor, verified: false }], [{ ...baseFactor, actorId: "another-actor" }],
        [{ ...baseFactor, authenticatedAtMs: NOW - 1 }], [{ ...baseFactor, verifiedAtMs: NOW + 1 }]]) {
        const f = fixture(); const { session } = prepared(f);
        deny(f.service.activateBreakGlass(activation(session, { verifiedAuth: auth({ verifiedFactors }) })), "VERIFIED_FACTOR_REQUIRED");
    }
});

test("step-up identity is bound to trusted context and session beneficiary", () => {
    const f = fixture(); const { session } = prepared(f);
    deny(f.service.activateBreakGlass(activation(session, { verifiedAuth: auth({}, NOW, "another-actor") })), "AUTH_ACTOR_MISMATCH");
    deny(f.service.activateBreakGlass(activation(session, {
        context: scope("tenant-one", "approver").context, verifiedAuth: auth({}, NOW, "approver")
    })), "BENEFICIARY_REQUIRED");
});

test("actual Paket 1 TTL and required factor configuration govern the reusable integration decision", () => {
    const f = fixture({ stepUpConfig: { ...DEFAULT_PLATFORM_STEP_UP_CONFIG, elevatedSessionTtlMs: 1000, requiredFactorTypes: ["totp"] } });
    const { session } = prepared(f);
    deny(f.service.activateBreakGlass(activation(session)), "VERIFIED_FACTOR_REQUIRED");
    const verifiedAuth = auth({ verifiedFactors: [{ ...auth().verifiedFactors[0], type: "totp" }] });
    allow(f.service.activateBreakGlass(activation(session, { verifiedAuth })));
    f.setNow(NOW + 1000);
    const result = f.service.authorizeBreakGlassOperation(authorization(session, { verifiedAuth }));
    deny(result, "AUTH_EXPIRED");
    assert.equal(buildBreakGlassAuditMetadata(result).freshnessBucket, "expired");
});

test("closed or false-positive incident denies activation based on fresh 4A state", () => {
    for (const falsePositive of [false, true]) {
        const f = fixture(); const { linked, session } = prepared(f);
        closeIncident(f, linked, falsePositive);
        deny(f.service.activateBreakGlass(activation(session)), falsePositive ? "INCIDENT_NOT_OPEN" : "INCIDENT_CLOSED");
        assert.equal(allow(f.service.getBreakGlass(command(session))).status, "approved");
    }
});

test("incident closure invalidates activation retry and operation authorization without blocking revocation", () => {
    const f = fixture(); const { linked, session } = prepared(f);
    allow(f.service.activateBreakGlass(activation(session)));
    closeIncident(f, linked);
    deny(f.service.activateBreakGlass(activation(session)), "INCIDENT_CLOSED");
    deny(f.service.authorizeBreakGlassOperation(authorization(session)), "INCIDENT_CLOSED");
    const revoked = allow(f.service.revokeBreakGlass(command(session, "approver", { transitionId: "revoke-one" })));
    assert.equal(revoked.status, "revoked");
});

test("warning, missing and cross-tenant incident links fail closed without storing a session", () => {
    const f = fixture();
    const warning = incident(f.incidents, "tenant-one", { severity: "warning" });
    deny(f.service.requestBreakGlass(requestInput(warning)), "INCIDENT_SEVERITY_REQUIRED");
    const other = incident(f.incidents, "tenant-two");
    deny(f.service.requestBreakGlass({ ...requestInput(other), ...scope("tenant-one") }), "INCIDENT_NOT_FOUND");
    deny(f.service.requestBreakGlass({ ...requestInput(other), incidentId: "missing-incident" }), "INCIDENT_NOT_FOUND");
    assert.equal(f.service.listBreakGlass(scope()).sessions.length, 0);
});

test("incident-less policy is explicit, defaults closed and never permits unbound tenant sessions", () => {
    const defaultService = createBreakGlassIntegrationService();
    deny(defaultService.requestBreakGlass(requestInput(null)), "INCIDENT_REQUIRED");
    const f = fixture({ integrationConfig: { allowPlatformWithoutIncident: true } });
    const session = allow(f.service.requestBreakGlass(requestInput(null)));
    allow(f.service.approveBreakGlass(command(session, "approver", { transitionId: "approve-one" })));
    allow(f.service.activateBreakGlass(activation(session)));
    allow(f.service.authorizeBreakGlassOperation(authorization(session)));
    deny(f.service.requestBreakGlass({ ...requestInput(null), ...scope("tenant-one") }), "INCIDENT_REQUIRED");
});

test("all six allowed operations work only when included in the active session's elevated operations", () => {
    const f = fixture(); const { session } = prepared(f);
    deny(f.service.authorizeBreakGlassOperation(authorization(session)), "BREAK_GLASS_NOT_ACTIVE");
    allow(f.service.activateBreakGlass(activation(session)));
    for (const operation of ALL_OPERATIONS) {
        const result = f.service.authorizeBreakGlassOperation(authorization(session, { operation }));
        allow(result);
        assert.equal(buildBreakGlassAuditMetadata(result).operation, operation);
        assert.equal(result.session.usedAt, null);
    }
    const limited = fixture(); const small = prepared(limited, { request: { elevatedOperations: ["incident.read"] } }).session;
    allow(limited.service.activateBreakGlass(activation(small)));
    deny(limited.service.authorizeBreakGlassOperation(authorization(small, { operation: "admin.lockdown.plan" })), "OPERATION_NOT_ELEVATED");
});

test("unknown/destructive operations deny and their raw values cannot reach audit metadata", () => {
    const f = fixture(); const { session } = prepared(f);
    allow(f.service.activateBreakGlass(activation(session)));
    for (const operation of ["production.destructive", "secret.rotate", "user@example.test", { token: "sentinel" }, "__proto__"]) {
        const result = f.service.authorizeBreakGlassOperation(authorization(session, { operation }));
        deny(result, "UNKNOWN_OPERATION");
        assert.equal(buildBreakGlassAuditMetadata(result).operation, "unknown");
        assert.ok(!JSON.stringify(result).includes("sentinel"));
    }
});

test("revoked, completed, denied and expired sessions deny authorization and cannot re-activate", () => {
    for (const status of ["revoked", "completed", "denied", "expired"]) {
        const f = fixture(); const linked = incident(f.incidents);
        const session = allow(f.service.requestBreakGlass(requestInput(linked)));
        if (status === "denied") allow(f.service.approveBreakGlass(command(session, "approver", { transitionId: "deny-one", decision: "deny" })));
        else {
            allow(f.service.approveBreakGlass(command(session, "approver", { transitionId: "approve-one" })));
            allow(f.service.activateBreakGlass(activation(session)));
            if (status === "revoked") allow(f.service.revokeBreakGlass(command(session, "approver", { transitionId: "revoke-one" })));
            if (status === "completed") allow(f.service.completeBreakGlass(command(session, "responder", { transitionId: "complete-one" })));
            if (status === "expired") f.setNow(NOW + DEFAULT_PLATFORM_BREAK_GLASS_CONFIG.ttlMs);
        }
        const result = f.service.authorizeBreakGlassOperation(authorization(session));
        deny(result, "BREAK_GLASS_NOT_ACTIVE");
        assert.equal(buildBreakGlassAuditMetadata(result).newStatus, status);
        deny(f.service.activateBreakGlass(activation(session)), "BREAK_GLASS_NOT_ACTIVE");
    }
});

test("idempotent activation/authorization retries re-evaluate auth and never cache a previous allow", () => {
    const f = fixture(); const { session } = prepared(f);
    const first = f.service.activateBreakGlass(activation(session));
    const second = f.service.activateBreakGlass(activation(session));
    assert.deepEqual(allow(second), allow(first));
    const firstOperation = f.service.authorizeBreakGlassOperation(authorization(session));
    assert.deepEqual(f.service.authorizeBreakGlassOperation(authorization(session)), firstOperation);
    assert.equal(f.service.listBreakGlass(scope()).sessions.length, 1);
    f.setNow(NOW + 300_000);
    deny(f.service.activateBreakGlass(activation(session)), "AUTH_EXPIRED");
    deny(f.service.authorizeBreakGlassOperation(authorization(session)), "AUTH_EXPIRED");
    const fresh = auth({}, NOW + 300_000);
    allow(f.service.authorizeBreakGlassOperation(authorization(session, { verifiedAuth: fresh })));
    assert.equal(allow(f.service.getBreakGlass(command(session))).expiresAt, session.expiresAt);
});

test("cross-tenant/platform session access denies without exposing the other scope's IDs in audit", () => {
    const f = fixture(); const { session } = prepared(f);
    allow(f.service.activateBreakGlass(activation(session)));
    const mismatch = f.service.authorizeBreakGlassOperation(authorization(session, { tenantId: "tenant-two" }));
    deny(mismatch, "TENANT_SCOPE_MISMATCH");
    const audit = buildBreakGlassAuditMetadata(mismatch);
    for (const field of ["breakGlassId", "approvedBy", "incidentId", "tenantId", "actorId"]) assert.equal(audit[field], null);
    const cross = f.service.authorizeBreakGlassOperation({ ...authorization(session), ...scope("tenant-two") });
    deny(cross, "BREAK_GLASS_NOT_FOUND");
    assert.equal(buildBreakGlassAuditMetadata(cross).incidentId, null);
    deny(f.service.activateBreakGlass({ ...activation(session), ...scope(null) }), "BREAK_GLASS_NOT_FOUND");
});

test("unavailable, malformed, cross-scope or asynchronous incident adapter results never allow activation", () => {
    const variants = [
        [() => { throw new Error("provider-sentinel"); }, "INCIDENT_UNAVAILABLE"],
        [() => null, "INCIDENT_NOT_FOUND"], [() => Promise.resolve(null), "INCIDENT_INVALID"],
        [() => ({ incidentId: "wrong-id", tenantId: "tenant-two", severity: "critical", status: "detected" }), "INCIDENT_SCOPE_MISMATCH"],
        [() => ({}), "INCIDENT_INVALID"]
    ];
    for (const [changed, expected] of variants) {
        let reader;
        const f = fixture({ incidentStore: { getIncident(input) { return reader(input); } } });
        reader = input => f.incidents.getIncident(input);
        const { session } = prepared(f);
        reader = changed;
        const result = f.service.activateBreakGlass(activation(session));
        deny(result, expected);
        assert.ok(!JSON.stringify(result).includes("sentinel"));
    }
});

test("incident adapter reads safe descriptors only and ignores unrelated secret payload fields", () => {
    let reads = 0;
    let invalid = false;
    const f = fixture({ incidentStore: { getIncident(input) {
        const snapshot = { ...f.incidents.getIncident(input) };
        Object.defineProperty(snapshot, invalid ? "status" : "token", { get() { reads++; throw new Error("sentinel"); } });
        return snapshot;
    } } });
    const { session } = prepared(f);
    invalid = true;
    deny(f.service.activateBreakGlass(activation(session)), "INCIDENT_INVALID");
    assert.equal(reads, 0);
});

test("every lifecycle/read/list/authorization outcome produces an exact immutable model-issued audit contract", () => {
    const f = fixture(); const linked = incident(f.incidents);
    const requested = f.service.requestBreakGlass(requestInput(linked));
    const session = allow(requested);
    const outcomes = [requested, f.service.approveBreakGlass(command(session, "responder", { transitionId: "self-approval" })),
        f.service.approveBreakGlass(command(session, "approver", { transitionId: "approve-one" })),
        f.service.activateBreakGlass(activation(session)), f.service.authorizeBreakGlassOperation(authorization(session)),
        f.service.getBreakGlass(command(session)), f.service.listBreakGlass(scope()),
        f.service.revokeBreakGlass(command(session, "approver", { transitionId: "revoke-one" }))];
    for (const result of outcomes) {
        const audit = buildBreakGlassAuditMetadata(result);
        assert.deepEqual(Object.keys(audit).sort(), AUDIT_FIELDS.slice().sort());
        assert.ok(Object.isFrozen(audit)); assert.ok(Object.isFrozen(result));
        assert.throws(() => buildBreakGlassAuditMetadata({ ...result }), TypeError);
        assert.throws(() => buildBreakGlassAuditMetadata({ ...audit }), TypeError);
        assert.ok(!Object.hasOwn(audit, "verifiedAuth"));
    }
    assert.equal(buildBreakGlassAuditMetadata(outcomes[1]).reasonCode, "SEPARATE_APPROVER_REQUIRED");
    assert.equal(buildBreakGlassAuditMetadata(outcomes.at(-1)).newStatus, "revoked");
});

test("secret/body/PII auth metadata and nested/getter payloads reject before audit projection", () => {
    const f = fixture(); const { session } = prepared(f);
    for (const field of ["token", "body", "credential", "secret", "privateKey", "email", "phone", "rawAuth", "__proto__", "constructor"]) {
        const extra = { ...auth() };
        Object.defineProperty(extra, field, { enumerable: true, value: "sentinel" });
        const result = f.service.activateBreakGlass(activation(session, { verifiedAuth: extra }));
        deny(result, "INVALID_AUTH_METADATA");
        assert.ok(!JSON.stringify(buildBreakGlassAuditMetadata(result)).includes("sentinel"));
    }
    for (const extra of [{ actorId: "user@example.test" }, { actorId: "5551234567" }, { authenticatedAtMs: { token: "sentinel" } }]) {
        deny(f.service.activateBreakGlass(activation(session, { verifiedAuth: auth(extra) })), "INVALID_AUTH_METADATA");
    }
    let reads = 0;
    for (const level of ["envelope", "auth", "factor", "array"]) {
        const input = activation(session);
        const target = level === "envelope" ? input : level === "auth" ? input.verifiedAuth :
            level === "factor" ? input.verifiedAuth.verifiedFactors[0] : input.verifiedAuth.verifiedFactors;
        Object.defineProperty(target, level === "array" ? "0" : "token", { get() { reads++; throw new Error("sentinel"); } });
        const result = f.service.activateBreakGlass(input);
        assert.equal(result.decision, "deny");
        assert.ok(!JSON.stringify(buildBreakGlassAuditMetadata(result)).includes("sentinel"));
    }
    assert.equal(reads, 0);
});

test("auth snapshots are defensive and cannot be promoted from unsafe prototypes/symbols/raw nested factors", () => {
    const input = auth();
    const copy = snapshotBreakGlassAuth(input);
    input.verifiedFactors[0].verified = false;
    assert.equal(copy.verifiedFactors[0].verified, true);
    assert.ok(Object.isFrozen(copy.verifiedFactors[0]));
    const extra = auth(); extra.verifiedFactors[Symbol("secret")] = "sentinel";
    for (const input of [Object.assign(Object.create(null), auth()), { ...auth(), [Symbol("secret")]: "sentinel" },
        auth({ verifiedFactors: [[{ token: "sentinel" }]] }), extra]) assert.throws(() => snapshotBreakGlassAuth(input), TypeError);
});

test("invalid core/step-up/integration config and clocks fail closed without provider details", () => {
    for (const options of [{ breakGlassConfig: {} }, { stepUpConfig: { ...DEFAULT_PLATFORM_STEP_UP_CONFIG, elevatedSessionTtlMs: 0 } },
        { integrationConfig: {} }, { integrationConfig: { allowPlatformWithoutIncident: "true" } }]) {
        assert.throws(() => createBreakGlassIntegrationService(options), TypeError);
    }
    let reads = 0;
    const config = { ...DEFAULT_PLATFORM_STEP_UP_CONFIG };
    Object.defineProperty(config, "elevatedSessionTtlMs", { get() { reads++; throw new Error("sentinel"); } });
    assert.throws(() => createBreakGlassIntegrationService({ stepUpConfig: config }), TypeError);
    assert.equal(reads, 0);
    const f = fixture(); const { session } = prepared(f);
    f.setNow(NOW - 1);
    deny(f.service.activateBreakGlass(activation(session)), "INVALID_CLOCK");
    f.setNow(NOW);
    assert.equal(allow(f.service.getBreakGlass(command(session))).status, "approved");
});

test("central integration policy is additive and does not alter 4B-1 or prior package defaults", () => {
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.breakGlassIntegration;
    const normalized = normalizePlatformGuardrailsConfig(legacy);
    assert.deepEqual(normalized.security.breakGlassIntegration, { allowPlatformWithoutIncident: false });
    for (const field of ["stepUp", "alerts", "secretLifecycle", "incidents", "breakGlass"]) assert.deepEqual(normalized.security[field], legacy.security[field]);
    assert.ok(Object.isFrozen(DEFAULT_PLATFORM_BREAK_GLASS_INTEGRATION_CONFIG));
    assert.ok(Object.isFrozen(normalizePlatformBreakGlassIntegrationConfig()));
    assert.equal(loadPlatformGuardrailsConfig(JSON.stringify({ security: { breakGlassIntegration: { allowPlatformWithoutIncident: true } } })).security.breakGlassIntegration.allowPlatformWithoutIncident, true);
    for (const value of [0, "true", null]) assert.throws(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { breakGlassIntegration: { allowPlatformWithoutIncident: value } } })), TypeError);
});
