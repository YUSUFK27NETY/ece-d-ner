const test = require("node:test");
const assert = require("node:assert/strict");
const { createInMemoryBreakGlassStore } = require("../src/break-glass/in-memory-break-glass-store");
const { DEFAULT_PLATFORM_BREAK_GLASS_CONFIG } = require("../src/config/platform-break-glass-config");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const TTL = DEFAULT_PLATFORM_BREAK_GLASS_CONFIG.ttlMs;
const iso = value => new Date(value).toISOString();
const code = (fn, expected) => assert.throws(fn, error => error.code === expected);
function scope(tenantId = "tenant-one", actorId = "requester", extra = {}) {
    const scope = tenantId === null ? "platform" : "tenant";
    return { context: { role: "platform_admin", actorId, scope, tenantId }, scope, tenantId, ...extra };
}
function requestInput(extra = {}, tenantId = "tenant-one", actorId = "requester") {
    return scope(tenantId, actorId, { requestId: "request-one", reasonCode: "INCIDENT_RESPONSE_REQUIRED",
        elevatedOperations: ["incident.read", "incident.transition"], ...extra });
}
function command(record, actorId = "requester", extra = {}) {
    return scope(record.tenantId, actorId, { breakGlassId: record.breakGlassId, ...extra });
}
function fixture(options = {}) {
    let now = NOW;
    return { store: createInMemoryBreakGlassStore({ clock: () => now, ...options }), setNow: value => { now = value; } };
}
function request(store, extra = {}, tenantId) { return store.requestBreakGlass(requestInput(extra, tenantId)); }
function approve(store, record, actorId = "approver", extra = {}) {
    return store.approveBreakGlass(command(record, actorId, { transitionId: "approval-one", ...extra }));
}
function activate(store, record, extra = {}) {
    return store.activateBreakGlass(command(record, record.actorId, { transitionId: "activation-one", ...extra }));
}
function revoke(store, record, extra = {}) {
    return store.revokeBreakGlass(command(record, "approver", { transitionId: "revocation-one", ...extra }));
}
function complete(store, record, extra = {}) {
    return store.completeBreakGlass(command(record, record.actorId, { transitionId: "completion-one", ...extra }));
}

test("valid request/approval/activation records only safe metadata and never renews TTL", () => {
    const { store, setNow } = fixture();
    assert.deepEqual(Object.keys(store).sort(), ["requestBreakGlass", "approveBreakGlass", "activateBreakGlass",
        "revokeBreakGlass", "completeBreakGlass", "getBreakGlass", "listBreakGlass"].sort());
    const requested = request(store, { incidentId: "opaque-incident-pointer" });
    assert.match(requested.breakGlassId, /^[0-9a-f-]{36}$/);
    assert.equal(requested.actorId, "requester");
    assert.equal(requested.requestedBy, "requester");
    assert.equal(requested.approvedBy, null);
    assert.equal(requested.status, "requested");
    setNow(NOW + 1000);
    const approved = approve(store, requested);
    assert.equal(approved.status, "approved");
    assert.equal(approved.approvedBy, "approver");
    setNow(NOW + 2000);
    const active = activate(store, requested);
    assert.equal(active.status, "active");
    assert.equal(active.createdAt, iso(NOW));
    assert.equal(active.expiresAt, iso(NOW + TTL));
    assert.equal(active.usedAt, null, "activation is not real session use");
    assert.equal(active.incidentId, "opaque-incident-pointer", "no incident integration/lookup");
    assert.ok(Object.isFrozen(active));
    assert.deepEqual(store.getBreakGlass(command(active)), active);
});

test("requester or beneficiary cannot self-approve by default; failed approval leaves requested state", () => {
    const { store } = fixture();
    const requested = request(store);
    code(() => approve(store, requested, "requester"), "SEPARATE_APPROVER_REQUIRED");
    assert.equal(store.getBreakGlass(command(requested)).status, "requested");
    const delegated = request(store, { requestId: "delegated-request", actorId: "beneficiary" });
    code(() => approve(store, delegated, "beneficiary"), "SEPARATE_APPROVER_REQUIRED");
    code(() => approve(store, delegated, "requester"), "SEPARATE_APPROVER_REQUIRED");
    assert.equal(approve(store, delegated).status, "approved");
});

test("only the intended beneficiary can activate or complete, regardless of reviewer role", () => {
    const { store } = fixture();
    const requested = request(store, { actorId: "beneficiary" });
    approve(store, requested);
    code(() => activate(store, requested, { context: scope("tenant-one").context }), "BENEFICIARY_REQUIRED");
    code(() => activate(store, requested, { context: scope("tenant-one", "approver").context }), "BENEFICIARY_REQUIRED");
    activate(store, requested);
    code(() => complete(store, requested, { context: scope("tenant-one", "approver").context }), "BENEFICIARY_REQUIRED");
    assert.equal(complete(store, requested).status, "completed");
});

test("expired pending/approved/active records cannot activate, including the old successful activation retry", () => {
    for (const from of ["requested", "approved", "active"]) {
        const { store, setNow } = fixture();
        const record = request(store);
        if (from !== "requested") approve(store, record);
        if (from === "active") activate(store, record);
        setNow(NOW + TTL - 1);
        assert.equal(store.getBreakGlass(command(record)).status, from);
        setNow(NOW + TTL);
        assert.equal(store.getBreakGlass(command(record)).status, "expired");
        assert.equal(store.listBreakGlass(scope())[0].status, "expired");
        code(() => activate(store, record), "BREAK_GLASS_TERMINAL");
        code(() => approve(store, record), "BREAK_GLASS_TERMINAL");
        code(() => complete(store, record), "BREAK_GLASS_TERMINAL");
        assert.equal(request(store).status, "expired", "request retry does not create a new lifespan");
    }
});

test("revocation from every nonterminal stage is permanent and preserves server-owned revokedAt", () => {
    for (const from of ["requested", "approved", "active"]) {
        const { store, setNow } = fixture();
        const record = request(store);
        if (from !== "requested") approve(store, record);
        if (from === "active") activate(store, record);
        setNow(NOW + 1000);
        const revoked = revoke(store, record);
        assert.equal(revoked.status, "revoked");
        assert.equal(revoked.revokedAt, iso(NOW + 1000));
        setNow(NOW + 2000);
        assert.deepEqual(revoke(store, record), revoked);
        code(() => activate(store, record), "BREAK_GLASS_TERMINAL");
        code(() => approve(store, record), "BREAK_GLASS_TERMINAL");
        setNow(NOW + TTL * 2);
        assert.equal(store.getBreakGlass(command(record)).status, "revoked");
    }
});

test("completed and denied are terminal; exact terminal retries are harmless", () => {
    const { store, setNow } = fixture();
    const first = request(store);
    approve(store, first); activate(store, first);
    const completed = complete(store, first);
    assert.deepEqual(complete(store, first), completed);
    const second = request(store, { requestId: "request-two" });
    const denied = approve(store, second, "approver", { decision: "deny" });
    assert.equal(denied.status, "denied");
    assert.equal(denied.approvedBy, null);
    assert.deepEqual(approve(store, second, "approver", { decision: "deny" }), denied);
    for (const record of [first, second]) {
        code(() => activate(store, record), "BREAK_GLASS_TERMINAL");
        code(() => approve(store, record), "BREAK_GLASS_TERMINAL");
        code(() => revoke(store, record), "BREAK_GLASS_TERMINAL");
    }
    setNow(NOW + TTL * 2);
    assert.equal(store.getBreakGlass(command(first)).status, "completed");
    assert.equal(store.getBreakGlass(command(second)).status, "denied");
});

test("invalid transition order/approval decisions never create active metadata", () => {
    const { store } = fixture();
    const record = request(store);
    code(() => activate(store, record), "INVALID_TRANSITION");
    code(() => complete(store, record), "INVALID_TRANSITION");
    for (const decision of [null, "approved", "sentinel", {}, true]) code(() => approve(store, record, "approver", { decision }), "INVALID_APPROVAL_DECISION");
    approve(store, record); activate(store, record);
    code(() => approve(store, record, "approver", { transitionId: "new-approval" }), "INVALID_TRANSITION");
    code(() => activate(store, record, { transitionId: "new-activation" }), "INVALID_TRANSITION");
    assert.equal(store.getBreakGlass(command(record)).status, "active");
});

test("same transition/request retries preserve expiry and return current state; conflicts reject", () => {
    const { store, setNow } = fixture();
    const record = request(store);
    setNow(NOW + 1000);
    assert.deepEqual(request(store, { elevatedOperations: ["incident.transition", "incident.read"] }), record);
    const approved = approve(store, record);
    assert.deepEqual(approve(store, record), approved);
    code(() => approve(store, record, "different-approver"), "IDEMPOTENCY_CONFLICT");
    code(() => activate(store, record, { transitionId: "approval-one" }), "IDEMPOTENCY_CONFLICT");
    code(() => request(store, { elevatedOperations: ["backup.verify"] }), "IDEMPOTENCY_CONFLICT");
    activate(store, record);
    setNow(NOW + 2000);
    assert.equal(activate(store, record).status, "active");
    assert.equal(approve(store, record).status, "active", "late approval retry cannot rewind state");
    assert.equal(request(store).expiresAt, iso(NOW + TTL));
    assert.equal(store.listBreakGlass(scope()).length, 1);
});

test("approval flags never bypass approved stage; high-risk independent approval remains default", () => {
    const config = { ...DEFAULT_PLATFORM_BREAK_GLASS_CONFIG, requireSeparateApprover: false };
    const { store } = fixture({ config });
    const low = request(store, { elevatedOperations: ["incident.read"] });
    code(() => activate(store, low), "INVALID_TRANSITION");
    assert.equal(approve(store, low, "requester").status, "approved");
    const high = request(store, { requestId: "high-request", elevatedOperations: ["admin.lockdown.plan"] });
    code(() => approve(store, high, "requester"), "SEPARATE_APPROVER_REQUIRED");
    config.approvalRequiredForHighRisk = false;
    code(() => approve(store, high, "requester"), "SEPARATE_APPROVER_REQUIRED", "constructor snapshots policy");
    const permissive = fixture({ config }).store;
    const other = request(permissive, { elevatedOperations: ["credential.rotation.plan"] });
    code(() => activate(permissive, other), "INVALID_TRANSITION");
    assert.equal(approve(permissive, other, "requester").status, "approved");
});

test("maxActiveSessions is atomic and store-wide across tenant/platform scopes", async () => {
    const { store } = fixture();
    const first = request(store);
    const second = request(store, {}, null);
    approve(store, first); approve(store, second);
    const results = await Promise.allSettled([first, second].map(async record => activate(store, record)));
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(results.find(result => result.status === "rejected").reason.code, "ACTIVE_SESSION_CAPACITY");
    const active = results[0].status === "fulfilled" ? first : second;
    const pending = active === first ? second : first;
    assert.equal(store.getBreakGlass(command(pending)).status, "approved");
    revoke(store, active);
    assert.equal(activate(store, pending).status, "active");
});

test("expired sessions release active capacity without extending other pending records", () => {
    const { store, setNow } = fixture();
    const first = request(store);
    approve(store, first); activate(store, first);
    setNow(NOW + 1000);
    const second = request(store, { requestId: "request-two" });
    approve(store, second);
    code(() => activate(store, second), "ACTIVE_SESSION_CAPACITY");
    setNow(NOW + TTL);
    assert.equal(activate(store, second).status, "active");
    assert.equal(store.getBreakGlass(command(first)).status, "expired");
    assert.equal(store.getBreakGlass(command(second)).expiresAt, iso(NOW + 1000 + TTL));
});

test("all reads/writes require matched explicit scope even for platform admins", () => {
    const { store } = fixture();
    const record = request(store);
    const wrong = command(record, "requester", { tenantId: "tenant-two" });
    const calls = [
        () => store.getBreakGlass(wrong), () => store.listBreakGlass(scope("tenant-one", "requester", { tenantId: "tenant-two" })),
        () => store.requestBreakGlass(requestInput({ tenantId: "tenant-two" })),
        ...["approveBreakGlass", "activateBreakGlass", "revokeBreakGlass", "completeBreakGlass"]
            .map(method => () => store[method]({ ...wrong, transitionId: "cross-tenant" }))
    ];
    for (const call of calls) code(call, "TENANT_SCOPE_MISMATCH");
    for (const role of ["tenant_admin", "tenant_owner", "viewer", undefined, true]) {
        const context = { ...scope().context, role };
        code(() => store.getBreakGlass(command(record, "requester", { context })), "PERMISSION_DENIED");
        code(() => store.requestBreakGlass(requestInput({ context })), "PERMISSION_DENIED");
    }
    for (const extra of [{ scope: undefined }, { tenantId: undefined }, { scope: "platform" }, { scope: "tenant", tenantId: null }]) {
        code(() => store.listBreakGlass(scope("tenant-one", "requester", extra)), "INVALID_SCOPE");
    }
    code(() => store.getBreakGlass(command(record, "requester", { context: scope(null).context })), "TENANT_SCOPE_MISMATCH");
});

test("same request ID across scopes creates isolated records and other tenant IDs cannot be read or mutated", () => {
    const { store } = fixture();
    const records = ["tenant-one", "tenant-two", "platform", null].map(tenantId => request(store, {}, tenantId));
    assert.equal(new Set(records.map(record => record.breakGlassId)).size, 4);
    for (const record of records) {
        assert.deepEqual(store.listBreakGlass(scope(record.tenantId)), [record]);
        const other = records.find(candidate => candidate.breakGlassId !== record.breakGlassId);
        assert.equal(store.getBreakGlass(command(record, "requester", { breakGlassId: other.breakGlassId })), null);
        code(() => approve(store, record, "approver", { breakGlassId: other.breakGlassId }), "BREAK_GLASS_NOT_FOUND");
    }
});

test("unknown operations, secret payloads, arbitrary nested data and getters reject before storage", () => {
    const { store } = fixture();
    const record = request(store);
    for (const elevatedOperations of [["production.destructive"], ["secret.rotate"], [{ token: "sentinel" }]]) {
        code(() => request(store, { requestId: "invalid-request", elevatedOperations }), "INVALID_OPERATION");
    }
    const envelopes = [
        ["requestBreakGlass", requestInput({ requestId: "new-request" })],
        ["approveBreakGlass", command(record, "approver", { transitionId: "approve" })],
        ["activateBreakGlass", command(record, "requester", { transitionId: "activate" })],
        ["revokeBreakGlass", command(record, "approver", { transitionId: "revoke" })],
        ["completeBreakGlass", command(record, "requester", { transitionId: "complete" })]
    ];
    for (const [method, base] of envelopes) {
        for (const field of ["token", "secret", "password", "body", "email", "credential", "approvedBy", "expiresAt", "usedAt"]) {
            assert.throws(() => store[method]({ ...base, [field]: { value: "sentinel" } }), TypeError);
            let reads = 0;
            const candidate = { ...base };
            Object.defineProperty(candidate, field, { get() { reads++; throw new Error("sentinel"); } });
            assert.throws(() => store[method](candidate), TypeError);
            assert.equal(reads, 0, field);
        }
    }
    for (const extra of [{ reasonCode: "user@example.test" }, { actorId: "user@example.test" }, { actorId: "5551234567" },
        { incidentId: { secret: "sentinel" } }, { context: { ...scope().context, token: "sentinel" } }]) {
        assert.throws(() => request(store, extra), TypeError);
    }
    assert.equal(store.listBreakGlass(scope()).length, 1);
    assert.equal(store.getBreakGlass(command(record)).status, "requested");
});

test("store bounds retain terminal records and defensive snapshots do not share mutable input arrays", () => {
    const { store } = fixture({ maxRecords: 1 });
    const operations = ["incident.read"];
    const record = request(store, { elevatedOperations: operations });
    operations.push("production.destructive");
    assert.deepEqual(store.getBreakGlass(command(record)).elevatedOperations, ["incident.read"]);
    approve(store, record, "approver", { decision: "deny" });
    code(() => request(store, { requestId: "second" }), "BREAK_GLASS_STORE_CAPACITY");
    assert.equal(store.listBreakGlass(scope())[0].status, "denied");
    assert.ok(Object.isFrozen(store.listBreakGlass(scope())));
    for (const limit of [0, 201, "20", null]) assert.throws(() => store.listBreakGlass(scope("tenant-one", "requester", { limit })), TypeError);
});

test("invalid config and clocks fail closed without raw errors or partial transition writes", () => {
    assert.throws(() => createInMemoryBreakGlassStore({ config: {} }), TypeError);
    for (const clock of [null, () => NaN, () => Infinity, () => NOW.toString(), () => { throw new Error("provider-sentinel"); }]) {
        assert.throws(() => request(createInMemoryBreakGlassStore({ clock })), error => error.code === "INVALID_CLOCK" && !String(error).includes("sentinel"));
    }
    const { store, setNow } = fixture();
    const record = request(store);
    setNow(NOW - 1);
    code(() => approve(store, record), "INVALID_CLOCK");
    code(() => store.getBreakGlass(command(record)), "INVALID_CLOCK");
    setNow(NOW);
    assert.equal(store.getBreakGlass(command(record)).status, "requested");
});
