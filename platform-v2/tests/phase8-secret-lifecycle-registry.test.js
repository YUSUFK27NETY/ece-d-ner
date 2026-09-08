const test = require("node:test");
const assert = require("node:assert/strict");
const { createInMemorySecretLifecycleRegistry } = require("../src/secrets/in-memory-secret-lifecycle-registry");
const { DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG } = require("../src/config/platform-secret-lifecycle-config");
const { buildSecretLifecycleAuditMetadata, DAY_MS } = require("../src/secrets/secret-lifecycle-model");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const staging = Object.freeze({ actorId: "admin-staging", role: "platform_admin", environment: "staging" });
const production = Object.freeze({ actorId: "admin-production", role: "platform_admin", environment: "production" });

function metadata(overrides = {}) {
    return {
        secretId: "backup-keyring", environment: "staging", component: "backup-worker",
        secretType: "backup_encryption_key", owner: "platform-ops",
        createdAt: new Date(NOW - 100 * DAY_MS).toISOString(),
        lastRotatedAt: new Date(NOW - 91 * DAY_MS).toISOString(),
        activeKeyId: "key-current", previousKeyIds: ["key-legacy"], ...overrides
    };
}

function fixture(options = {}) {
    let now = NOW;
    const registry = createInMemorySecretLifecycleRegistry({ clock: () => now, ...options });
    return { registry, setNow: value => { now = value; } };
}

function scoped(overrides = {}) {
    return { context: staging, environment: "staging", secretId: "backup-keyring", ...overrides };
}

function rotation(overrides = {}) {
    return scoped({ rotationId: "rotation-one", ...overrides });
}

function register(registry, overrides = {}) {
    return registry.register({ context: staging, metadata: metadata(overrides) });
}

function prepare(registry, overrides = {}) {
    return registry.markRotationPrepared(rotation({ candidateKeyId: "key-next", ...overrides }));
}

function verify(registry, overrides = {}) {
    return registry.markRotationVerified(rotation({ verified: true, verificationId: "verification-one", keyId: "key-next", ...overrides }));
}

function complete(registry) {
    registry.planRotation(rotation());
    prepare(registry);
    verify(registry);
    return registry.markRotationCompleted(rotation());
}

function evidence(now = NOW, overrides = {}) {
    return {
        environment: "staging", secretId: "backup-keyring", keyId: "key-current",
        verified: true, complete: true, checkedAt: new Date(now).toISOString(),
        retainedBackupCount: 0, otherReferenceCount: 0, rollbackRequired: false,
        ...overrides
    };
}

function retire(registry, proof, keyId = "key-current") {
    return registry.planKeyRetirement(scoped({ keyId, evidence: proof }));
}

function expectCode(action, code) {
    assert.throws(action, error => {
        assert.equal(error.code, code);
        assert.ok(!String(error).includes("sentinel"));
        return true;
    });
}

test("same opaque secret ID is registered and listed independently in each environment", () => {
    const { registry } = fixture();
    const stage = register(registry);
    registry.register({ context: production, metadata: metadata({ environment: "production", activeKeyId: "key-production" }) });
    assert.equal(stage.metadata.status, "overdue");
    assert.equal(registry.get(scoped()).activeKeyId, "key-current");
    assert.equal(registry.get(scoped({ context: production, environment: "production" })).activeKeyId, "key-production");
    const stageList = registry.list({ context: staging, environment: "staging" });
    assert.equal(stageList.length, 1);
    assert.ok(stageList.every(record => record.environment === "staging"));
    assert.equal(registry.list({ context: production, environment: "production" }).length, 1);
    assert.equal(registry.get(scoped({ secretId: "missing-id" })), null);
});

test("every registry access denies mismatched environment and non-admin trusted contexts", () => {
    const { registry } = fixture();
    registry.register({ context: production, metadata: metadata({ environment: "production" }) });
    const wrong = scoped({ environment: "production" });
    const commands = [
        () => registry.get(wrong), () => registry.list({ context: staging, environment: "production" }),
        () => registry.planRotation({ ...wrong, rotationId: "rotation-one" }),
        () => registry.getRotation({ ...wrong, rotationId: "rotation-one" }),
        () => registry.markRotationPrepared({ ...wrong, rotationId: "rotation-one", candidateKeyId: "key-next" }),
        () => registry.markRotationVerified({ ...wrong, rotationId: "rotation-one", verified: true, verificationId: "verify-one", keyId: "key-next" }),
        () => registry.markRotationCompleted({ ...wrong, rotationId: "rotation-one" }),
        () => registry.markRollback({ ...wrong, rotationId: "rotation-one", reasonCode: "ROTATION_ABORTED" }),
        () => registry.planKeyRetirement({ ...wrong, keyId: "key-legacy" }),
        () => registry.listAudit(wrong),
        () => registry.register({ context: staging, metadata: metadata({ environment: "production" }) })
    ];
    for (const command of commands) expectCode(command, "ENVIRONMENT_SCOPE_MISMATCH");
    for (const role of ["tenant_owner", "viewer", undefined, true]) {
        expectCode(() => registry.get(scoped({ environment: "production", context: { ...production, role } })), "PERMISSION_DENIED");
    }
    assert.throws(() => registry.get(scoped({ environment: undefined })), TypeError);
    assert.throws(() => registry.get(scoped({ context: { ...staging, environment: undefined } })), TypeError);
    assert.equal(registry.listAudit(scoped({ context: production, environment: "production" })).length, 1);
});

test("valid rotation transitions change only metadata and retain all old key IDs", () => {
    const { registry, setNow } = fixture();
    register(registry);
    const plan = registry.planRotation(rotation());
    assert.equal(plan.rotation.state, "planned");
    assert.equal(plan.metadata.activeKeyId, "key-current");
    setNow(NOW + 1000);
    assert.equal(prepare(registry).rotation.state, "prepared");
    assert.equal(registry.get(scoped()).activeKeyId, "key-current");
    setNow(NOW + 2000);
    assert.equal(verify(registry).rotation.state, "verified");
    setNow(NOW + 3000);
    const result = registry.markRotationCompleted(rotation());
    assert.equal(result.rotation.state, "completed");
    assert.equal(result.metadata.status, "healthy");
    assert.equal(result.metadata.activeKeyId, "key-next");
    assert.deepEqual(result.metadata.previousKeyIds, ["key-legacy", "key-current"]);
    assert.equal(result.metadata.lastRotatedAt, new Date(NOW + 3000).toISOString());
    assert.equal(result.metadata.nextRotationAt, new Date(NOW + 3000 + 90 * DAY_MS).toISOString());
    assert.equal(result.metadata.overlapUntil, new Date(NOW + 3000 + 7 * DAY_MS).toISOString());
    assert.equal(result.audit.oldStatus, "overdue");
    assert.equal(result.audit.newStatus, "healthy");
    assert.equal(registry.listAudit(scoped()).length, 5);
});

test("invalid transitions, unverified evidence and invalid candidates leave state/audit unchanged", () => {
    const { registry } = fixture();
    register(registry);
    expectCode(() => prepare(registry), "ROTATION_NOT_FOUND");
    registry.planRotation(rotation());
    expectCode(() => verify(registry), "INVALID_TRANSITION");
    expectCode(() => registry.markRotationCompleted(rotation()), "INVALID_TRANSITION");
    expectCode(() => registry.planRotation(rotation({ rotationId: "another-rotation" })), "ROTATION_IN_PROGRESS");
    for (const candidateKeyId of [null, "key-current", "key-legacy"]) {
        expectCode(() => prepare(registry, { candidateKeyId }), "INVALID_CANDIDATE_KEY");
    }
    assert.equal(registry.listAudit(scoped()).length, 2);
    prepare(registry);
    for (const verified of [undefined, false, "true", 1]) expectCode(() => verify(registry, { verified }), "VERIFICATION_REQUIRED");
    expectCode(() => verify(registry, { keyId: "key-wrong" }), "VERIFICATION_KEY_MISMATCH");
    assert.equal(registry.getRotation(rotation()).state, "prepared");
    assert.equal(registry.listAudit(scoped()).length, 3);
});

test("exact retries return original receipts without resetting timestamps or duplicating audit", () => {
    const { registry, setNow } = fixture();
    const registration = register(registry);
    assert.equal(register(registry), registration);
    const plan = registry.planRotation(rotation());
    assert.equal(registry.planRotation(rotation()), plan);
    const prepared = prepare(registry);
    assert.equal(prepare(registry), prepared);
    const verified = verify(registry);
    assert.equal(verify(registry), verified);
    const completed = registry.markRotationCompleted(rotation());
    setNow(NOW + DAY_MS);
    assert.equal(registry.markRotationCompleted(rotation()), completed);
    assert.equal(prepare(registry), prepared, "late retry returns receipt, never rewinds state");
    assert.equal(registry.getRotation(rotation()).state, "completed");
    assert.equal(registry.get(scoped()).activeKeyId, "key-next");
    assert.equal(registry.listAudit(scoped()).length, 5);
    expectCode(() => prepare(registry, { candidateKeyId: "different-key" }), "IDEMPOTENCY_CONFLICT");
    expectCode(() => verify(registry, { verificationId: "different-proof" }), "IDEMPOTENCY_CONFLICT");
    expectCode(() => registry.planRotation(rotation({ context: { ...staging, actorId: "other-admin" } })), "IDEMPOTENCY_CONFLICT");
    expectCode(() => register(registry, { previousKeyIds: [] }), "IDEMPOTENCY_CONFLICT");
    assert.equal(registry.listAudit(scoped()).length, 5);
});

test("disabled records are visible but cannot plan a rotation", () => {
    const { registry } = fixture();
    register(registry, { status: "disabled" });
    assert.equal(registry.get(scoped()).status, "disabled");
    expectCode(() => registry.planRotation(rotation()), "SECRET_DISABLED");
});

test("rollback from every stage restores scheduling and preserves any prepared/new key", () => {
    for (const fromState of ["planned", "prepared", "verified", "completed"]) {
        const { registry, setNow } = fixture();
        const initial = register(registry).metadata;
        registry.planRotation(rotation());
        if (fromState !== "planned") prepare(registry);
        if (["verified", "completed"].includes(fromState)) verify(registry);
        if (fromState === "completed") registry.markRotationCompleted(rotation());
        setNow(NOW + DAY_MS);
        const command = rotation({ reasonCode: "VERIFICATION_FAILED" });
        const rollback = registry.markRollback(command);
        assert.equal(rollback.rotation.state, "rolled_back");
        assert.equal(rollback.metadata.activeKeyId, initial.activeKeyId);
        assert.equal(rollback.metadata.lastRotatedAt, initial.lastRotatedAt);
        assert.equal(rollback.metadata.nextRotationAt, initial.nextRotationAt);
        assert.equal(rollback.metadata.status, "overdue");
        assert.ok(rollback.metadata.previousKeyIds.includes("key-legacy"));
        assert.equal(rollback.metadata.previousKeyIds.includes("key-next"), fromState !== "planned");
        assert.ok(!rollback.metadata.previousKeyIds.includes("key-current"));
        assert.equal(registry.markRollback(command), rollback);
        expectCode(() => registry.markRollback(rotation({ reasonCode: "ROTATION_ABORTED" })), "IDEMPOTENCY_CONFLICT");
        if (fromState !== "completed") expectCode(() => registry.markRotationCompleted(rotation()), "INVALID_TRANSITION");
        else {
            registry.markRotationCompleted(rotation());
            assert.equal(registry.get(scoped()).activeKeyId, "key-current", "historical completion receipt must not reapply");
        }
    }
});

test("rollback of a superseded rotation cannot revert the newer active key", () => {
    const { registry } = fixture();
    register(registry);
    complete(registry);
    const second = rotation({ rotationId: "rotation-two" });
    registry.planRotation(second);
    expectCode(() => registry.markRollback(rotation({ reasonCode: "POST_ROTATION_CHECK_FAILED" })), "STALE_ROTATION");
    registry.markRotationPrepared({ ...second, candidateKeyId: "key-third" });
    registry.markRotationVerified({ ...second, verified: true, verificationId: "verification-two", keyId: "key-third" });
    registry.markRotationCompleted(second);
    assert.equal(registry.get(scoped()).activeKeyId, "key-third");
    assert.deepEqual(registry.get(scoped()).previousKeyIds, ["key-legacy", "key-current", "key-next"]);
});

test("retirement is denied for active keys, unknown keys, overlap, and minimum retention", () => {
    const { registry, setNow } = fixture();
    register(registry);
    assert.equal(retire(registry).reasonCode, "ACTIVE_KEY_REQUIRED");
    assert.equal(retire(registry, undefined, "unknown-key").reasonCode, "KEY_NOT_RETAINED");
    registry.planRotation(rotation());
    assert.equal(retire(registry, undefined, "key-legacy").reasonCode, "ROTATION_IN_PROGRESS");
    prepare(registry); verify(registry); registry.markRotationCompleted(rotation());
    assert.equal(retire(registry, evidence()).reasonCode, "DUAL_KEY_OVERLAP_ACTIVE");
    setNow(NOW + 7 * DAY_MS);
    assert.equal(retire(registry, evidence(NOW + 7 * DAY_MS)).reasonCode, "OLD_KEY_RETENTION_ACTIVE");
    setNow(NOW + 30 * DAY_MS - 1);
    assert.equal(retire(registry).reasonCode, "OLD_KEY_RETENTION_ACTIVE");
});

test("old backups and rollback references prevent retirement even after overlap and retention expire", () => {
    const { registry, setNow } = fixture();
    register(registry); complete(registry);
    const later = NOW + 30 * DAY_MS;
    setNow(later);
    assert.equal(retire(registry).reasonCode, "RETENTION_EVIDENCE_REQUIRED");
    assert.equal(retire(registry, evidence(later, { retainedBackupCount: 1 })).reasonCode, "BACKUP_KEY_STILL_REFERENCED");
    assert.equal(retire(registry, evidence(later, { otherReferenceCount: 1 })).reasonCode, "KEY_STILL_REFERENCED");
    assert.equal(retire(registry, evidence(later, { rollbackRequired: true })).reasonCode, "ROLLBACK_KEY_REQUIRED");
    const before = registry.get(scoped());
    const auditCount = registry.listAudit(scoped()).length;
    assert.equal(retire(registry, evidence(later)).decision, "allow");
    assert.deepEqual(registry.get(scoped()), before, "eligibility never removes a key ID");
    assert.equal(registry.listAudit(scoped()).length, auditCount, "planning is read-only");
});

test("retirement evidence is bound to exact environment, secret and key and must be current and complete", () => {
    const { registry, setNow } = fixture();
    register(registry); complete(registry);
    const later = NOW + 30 * DAY_MS;
    setNow(later);
    for (const changes of [
        { environment: "production" }, { secretId: "another-secret" }, { keyId: "key-legacy" },
        { verified: false }, { verified: "true" }, { complete: false }, { complete: undefined },
        { retainedBackupCount: null }, { retainedBackupCount: "0" }, { retainedBackupCount: -1 },
        { otherReferenceCount: undefined }, { token: "sentinel" }, { raw: { secret: "sentinel" } }
    ]) {
        assert.equal(retire(registry, evidence(later, changes)).decision, "deny");
    }
    for (const checkedAt of [later + 1, later - 300_000, NOW - 1]) {
        assert.equal(retire(registry, evidence(checkedAt)).reasonCode, "RETENTION_EVIDENCE_STALE");
    }
    assert.equal(retire(registry, evidence(later - 299_999)).decision, "allow");
    const malicious = evidence(later);
    let reads = 0;
    Object.defineProperty(malicious, "retainedBackupCount", { get() { reads++; return 0; } });
    assert.equal(retire(registry, malicious).decision, "deny");
    assert.equal(reads, 0);
});

test("imported previous keys conservatively start retention at registration, not historical creation", () => {
    const { registry, setNow } = fixture();
    register(registry);
    assert.equal(retire(registry, evidence(NOW, { keyId: "key-legacy" }), "key-legacy").reasonCode, "OLD_KEY_RETENTION_ACTIVE");
    setNow(NOW + 30 * DAY_MS);
    assert.equal(retire(registry, evidence(NOW + 30 * DAY_MS, { keyId: "key-legacy" }), "key-legacy").decision, "allow");
});

test("rollback retains the candidate and starts its own overlap and retention protection", () => {
    const { registry, setNow } = fixture();
    register(registry); complete(registry);
    const rollbackAt = NOW + 40 * DAY_MS;
    setNow(rollbackAt);
    registry.markRollback(rotation({ reasonCode: "POST_ROTATION_CHECK_FAILED" }));
    assert.equal(retire(registry, evidence(rollbackAt, { keyId: "key-next" }), "key-next").reasonCode, "DUAL_KEY_OVERLAP_ACTIVE");
    setNow(rollbackAt + 7 * DAY_MS);
    assert.equal(retire(registry, evidence(rollbackAt + 7 * DAY_MS, { keyId: "key-next" }), "key-next").reasonCode, "OLD_KEY_RETENTION_ACTIVE");
});

test("keyless credential lifecycle supports state transitions without manufacturing key material or IDs", () => {
    const { registry } = fixture();
    register(registry, { secretType: "api_credential", activeKeyId: null, previousKeyIds: [] });
    registry.planRotation(rotation());
    prepare(registry, { candidateKeyId: null });
    verify(registry, { keyId: null });
    const completed = registry.markRotationCompleted(rotation());
    assert.equal(completed.metadata.activeKeyId, null);
    assert.deepEqual(completed.metadata.previousKeyIds, []);
    assert.equal(completed.metadata.overlapUntil, null);
    assert.equal(completed.metadata.status, "healthy");
    registry.markRollback(rotation({ reasonCode: "ROTATION_ABORTED" }));
    assert.equal(registry.get(scoped()).status, "overdue");
});

test("retained key capacity fails before preparation and preserves existing evidence", () => {
    const config = { ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, maxPreviousKeyIds: 1 };
    const { registry } = fixture({ config });
    register(registry); registry.planRotation(rotation());
    expectCode(() => prepare(registry), "KEY_RETENTION_CAPACITY");
    assert.equal(registry.getRotation(rotation()).state, "planned");
    assert.deepEqual(registry.get(scoped()).previousKeyIds, ["key-legacy"]);
    assert.equal(registry.listAudit(scoped()).length, 2);
});

test("all mutation envelopes reject secret fields and nested/accessor payloads before any metadata commit", () => {
    const { registry } = fixture();
    register(registry); registry.planRotation(rotation());
    for (const extra of [
        { token: "sentinel" }, { value: "sentinel" }, { privateKey: "sentinel" },
        { credentials: { password: "sentinel" } }, { body: { material: "sentinel" } }
    ]) {
        assert.throws(() => prepare(registry, extra), TypeError);
        assert.throws(() => registry.planRotation(rotation(extra)), TypeError);
        assert.throws(() => registry.markRollback(rotation({ reasonCode: "ROTATION_ABORTED", ...extra })), TypeError);
    }
    let reads = 0;
    const envelope = rotation({ candidateKeyId: "key-next" });
    Object.defineProperty(envelope, "token", { get() { reads++; throw new Error("sentinel"); } });
    assert.throws(() => registry.markRotationPrepared(envelope), TypeError);
    assert.equal(reads, 0);
    assert.equal(registry.getRotation(rotation()).state, "planned");
    assert.equal(registry.listAudit(scoped()).length, 2);
    assert.ok(!JSON.stringify(registry.listAudit(scoped())).includes("sentinel"));
});

test("audit projection contains exactly approved metadata fields, not rotation proof or timestamps", () => {
    const { registry } = fixture();
    register(registry); complete(registry);
    const audit = registry.listAudit(scoped()).at(-1);
    assert.deepEqual(Object.keys(buildSecretLifecycleAuditMetadata(audit)).sort(), [
        "actorId", "secretId", "environment", "secretType", "action", "oldStatus", "newStatus", "keyId", "reasonCode"
    ].sort());
    assert.equal(audit.keyId, "key-next");
    assert.equal(audit.reasonCode, "ROTATION_COMPLETED");
    assert.equal(audit.environment, "staging");
    assert.ok(Object.isFrozen(audit));
    assert.throws(() => buildSecretLifecycleAuditMetadata({ ...audit, token: "sentinel" }), TypeError);
});

test("read models recalculate status and remain immutable independently of mutation receipts", () => {
    const { registry, setNow } = fixture();
    const raw = metadata({ lastRotatedAt: new Date(NOW).toISOString() });
    registry.register({ context: staging, metadata: raw });
    raw.previousKeyIds.push("injected-id");
    raw.activeKeyId = "injected-id";
    setNow(NOW + 76 * DAY_MS);
    assert.equal(registry.get(scoped()).status, "due_soon");
    setNow(NOW + 90 * DAY_MS);
    assert.equal(registry.list({ context: staging, environment: "staging" })[0].status, "overdue");
    const stored = registry.get(scoped());
    assert.equal(stored.activeKeyId, "key-current");
    assert.deepEqual(stored.previousKeyIds, ["key-legacy"]);
    assert.ok(Object.isFrozen(stored));
    assert.throws(() => stored.previousKeyIds.push("injected-id"), TypeError);
});

test("invalid config and clocks fail closed without provider errors or side effects", () => {
    assert.throws(() => createInMemorySecretLifecycleRegistry({ config: {} }), TypeError);
    for (const clock of [null, () => NaN, () => NOW.toString(), () => { throw new Error("provider-sentinel"); }]) {
        assert.throws(() => register(createInMemorySecretLifecycleRegistry({ clock })), error => {
            assert.ok(!String(error).includes("sentinel"));
            return error.code === "INVALID_CLOCK";
        });
    }
    const { registry, setNow } = fixture();
    register(registry);
    setNow(NOW - 1);
    expectCode(() => registry.planRotation(rotation()), "INVALID_CLOCK");
    assert.equal(registry.listAudit(scoped()).length, 1);
});
