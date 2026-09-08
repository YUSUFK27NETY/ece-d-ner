const test = require("node:test");
const assert = require("node:assert/strict");
const {
    DAY_MS, normalizeSecretMetadata, refreshSecretMetadata, changeSecretMetadata,
    createLifecycleAudit, buildSecretLifecycleAuditMetadata
} = require("../src/secrets/secret-lifecycle-model");
const {
    authorizeLifecycleScope, lifecycleId, lifecycleIds
} = require("../src/secrets/secret-metadata-contract");
const {
    DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, normalizePlatformSecretLifecycleConfig
} = require("../src/config/platform-secret-lifecycle-config");
const {
    DEFAULT_PLATFORM_GUARDRAILS_CONFIG, normalizePlatformGuardrailsConfig, loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");

const CREATED_MS = Date.parse("2026-01-01T00:00:00.000Z");
const NOW = CREATED_MS + 10 * DAY_MS;
const ACTOR = { actorId: "actor-01", role: "platform_admin", environment: "staging" };
const FORBIDDEN_FIELDS = [
    "secretValue", "value", "privateKey", "private_key", "token", "password", "credential",
    "credentials", "credentialJson", "recoveryCode", "encryptionKeyMaterial", "rawAuth", "body",
    "providerPayload", "metadata", "__proto__", "constructor", "prototype"
];

function input(overrides = {}) {
    return {
        secretId: "secret-01", environment: "staging", component: "backup-service",
        secretType: "backup_encryption_key", owner: "team-platform", createdAt: iso(CREATED_MS),
        lastRotatedAt: null, activeKeyId: "key-current", previousKeyIds: [], ...overrides
    };
}

function iso(timestamp) {
    return new Date(timestamp).toISOString();
}

function normalize(overrides = {}, options = {}) {
    return normalizeSecretMetadata(input(overrides), { nowMs: NOW, ...options });
}

function assertRejected(call, code) {
    assert.throws(call, error => {
        assert.equal(error instanceof TypeError, true);
        if (code) assert.equal(error.code, code);
        assert.equal(error.message.includes("sentinel"), false);
        return true;
    });
}

test("metadata derives healthy, due_soon and overdue at exact policy boundaries", () => {
    const dueAt = CREATED_MS + 90 * DAY_MS;
    for (const [nowMs, expected] of [
        [dueAt - 14 * DAY_MS - 1, "healthy"], [dueAt - 14 * DAY_MS, "due_soon"],
        [dueAt - 1, "due_soon"], [dueAt, "overdue"], [dueAt + DAY_MS, "overdue"]
    ]) {
        const metadata = normalize({}, { nowMs });
        assert.equal(metadata.status, expected);
        assert.equal(metadata.nextRotationAt, iso(dueAt));
    }
});

test("disabled records remain disabled while their next rotation remains derived", () => {
    const metadata = normalize({ status: "disabled" }, { nowMs: CREATED_MS + 100 * DAY_MS });
    assert.equal(metadata.status, "disabled");
    assert.equal(metadata.nextRotationAt, iso(CREATED_MS + 90 * DAY_MS));
    assert.equal(refreshSecretMetadata(metadata, { nowMs: CREATED_MS + 120 * DAY_MS }).status, "disabled");
});

test("last rotation and per-record interval control the next due date", () => {
    const metadata = normalize({ lastRotatedAt: iso(CREATED_MS + 5 * DAY_MS), rotationIntervalDays: 30 });
    assert.equal(metadata.nextRotationAt, iso(CREATED_MS + 35 * DAY_MS));
    assert.equal(metadata.status, "healthy");
    assert.equal(normalize({}, {
        nowMs: CREATED_MS + 90 * DAY_MS - 1,
        config: { ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, warningWindowDays: 0 }
    }).status, "healthy");
});

test("caller status cannot conceal overdue metadata or invent an overdue result", () => {
    assert.equal(normalize({ status: "overdue" }).status, "healthy");
    assert.equal(normalize({ status: "healthy" }, { nowMs: CREATED_MS + 90 * DAY_MS }).status, "overdue");
    assertRejected(() => normalize({ nextRotationAt: iso(CREATED_MS + 1000 * DAY_MS) }));
    assertRejected(() => normalize({ status: "unknown" }));
});

test("refresh recalculates age and accepts only model-owned immutable projections", () => {
    const original = normalize();
    const refreshed = refreshSecretMetadata(original, { nowMs: CREATED_MS + 90 * DAY_MS });
    assert.equal(refreshed.status, "overdue");
    assert.equal(original.status, "healthy");
    assert.notEqual(refreshed, original);
    assertRejected(() => refreshSecretMetadata({ ...original }, { nowMs: NOW }));
    assertRejected(() => changeSecretMetadata({ ...original }, {}, { nowMs: NOW }));
});

test("metadata and key-ID arrays are defensive frozen copies with an exact projection", () => {
    const previousKeyIds = ["key-old"];
    const metadata = normalize({ previousKeyIds });
    previousKeyIds.push("key-mutated");
    assert.deepEqual(metadata.previousKeyIds, ["key-old"]);
    assert.equal(Object.isFrozen(metadata), true);
    assert.equal(Object.isFrozen(metadata.previousKeyIds), true);
    assert.deepEqual(Object.keys(metadata).sort(), [
        "secretId", "environment", "component", "secretType", "owner", "createdAt", "lastRotatedAt",
        "rotationIntervalDays", "status", "activeKeyId", "previousKeyIds", "overlapUntil", "nextRotationAt"
    ].sort());
});

test("metadata rejects every non-contract sensitive or arbitrary field before reading a getter", () => {
    for (const field of FORBIDDEN_FIELDS) {
        let reads = 0;
        const candidate = input();
        Object.defineProperty(candidate, field, {
            enumerable: true, get() { reads += 1; throw new Error("sentinel"); }
        });
        assertRejected(() => normalizeSecretMetadata(candidate, { nowMs: NOW }));
        assert.equal(reads, 0, field);
    }
});

test("metadata rejects nested payloads and does not coerce opaque fields", () => {
    for (const field of ["secretId", "environment", "component", "secretType", "owner", "createdAt",
        "lastRotatedAt", "rotationIntervalDays", "status", "activeKeyId", "overlapUntil"]) {
        let reads = 0;
        const nested = { password: "sentinel", toString() { reads += 1; throw new Error("sentinel"); } };
        assertRejected(() => normalize({ [field]: nested }));
        assert.equal(reads, 0, field);
    }
    assertRejected(() => normalize({ previousKeyIds: [{ password: "sentinel" }] }));
});

test("metadata rejects non-plain prototypes, symbols and accessors on allowed fields", () => {
    for (const candidate of [null, [], Object.assign(Object.create(null), input()),
        Object.assign(Object.create({ secretValue: "sentinel" }), input()), { ...input(), [Symbol("extra")]: "sentinel" }]) {
        assertRejected(() => normalizeSecretMetadata(candidate, { nowMs: NOW }));
    }
    let reads = 0;
    const candidate = input();
    Object.defineProperty(candidate, "activeKeyId", { get() { reads += 1; return "sentinel"; } });
    assertRejected(() => normalizeSecretMetadata(candidate, { nowMs: NOW }));
    assert.equal(reads, 0);
});

test("key ID arrays must be ordinary dense, duplicate-free arrays without extra properties", () => {
    const sparse = new Array(1);
    const extra = ["key-old"];
    extra.metadata = { password: "sentinel" };
    const symbol = ["key-old"];
    symbol[Symbol("payload")] = "sentinel";
    const prototype = ["key-old"];
    Object.setPrototypeOf(prototype, Object.create(Array.prototype));
    for (const candidate of [sparse, extra, symbol, prototype, ["key-old", "key-old"], [["key-old"]], "key-old"]) {
        assertRejected(() => normalize({ previousKeyIds: candidate }));
    }
    let reads = 0;
    const accessor = [];
    Object.defineProperty(accessor, "0", { get() { reads += 1; throw new Error("sentinel"); } });
    assertRejected(() => normalize({ previousKeyIds: accessor }));
    assert.equal(reads, 0);
    assertRejected(() => lifecycleIds(["key-old", "key-older"], 1));
});

test("opaque identifiers exclude contact, URL, path, whitespace and object-shaped values", () => {
    for (const invalid of ["", "x", " user-01", "user@example.test", "+905551234567", "5551234567",
        "https://example.test/key", "../key", "key/current", "key.current", "key\ncurrent", "x".repeat(129), 123, {}]) {
        assertRejected(() => lifecycleId(invalid));
    }
    for (const field of ["secretId", "component", "owner", "activeKeyId"]) {
        assertRejected(() => normalize({ [field]: "user@example.test" }));
    }
    assert.equal(lifecycleId("opaque_01-A"), "opaque_01-A");
});

test("environment and secret type use finite allowlists", () => {
    for (const environment of ["dev", "prod", "STAGING", null]) assertRejected(() => normalize({ environment }));
    for (const secretType of ["token", "other", "__proto__", null]) assertRejected(() => normalize({ secretType }));
    for (const secretType of ["service_account", "api_credential", "signing_key"]) {
        assert.equal(normalize({ secretType, activeKeyId: null }).secretType, secretType);
    }
});

test("backup metadata requires an active key ID distinct from all previous IDs", () => {
    assertRejected(() => normalize({ activeKeyId: null }));
    assertRejected(() => normalize({ activeKeyId: undefined }));
    assertRejected(() => normalize({ previousKeyIds: ["key-current"] }));
    assert.deepEqual(normalize({ previousKeyIds: ["key-old"] }).previousKeyIds, ["key-old"]);
});

test("timestamps reject malformed, impossible, future and reversed creation/rotation chronology", () => {
    for (const createdAt of ["2026-01-01", "2026-02-30T00:00:00.000Z", "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00.000+00:00", iso(NOW + 1), 0]) assertRejected(() => normalize({ createdAt }));
    assertRejected(() => normalize({ lastRotatedAt: iso(CREATED_MS - 1) }));
    assertRejected(() => normalize({ lastRotatedAt: iso(NOW + 1) }));
    assertRejected(() => normalize({ overlapUntil: iso(CREATED_MS - 1), previousKeyIds: ["key-old"] }));
    assertRejected(() => normalize({ overlapUntil: iso(NOW + DAY_MS) }));
    assert.equal(normalize({ previousKeyIds: ["key-old"], overlapUntil: iso(NOW + DAY_MS) }).overlapUntil,
        iso(NOW + DAY_MS));
    for (const nowMs of [0, NaN, Infinity, "sentinel", -1, NOW + 0.5]) {
        assertRejected(() => normalize({}, { nowMs }), "INVALID_CLOCK");
    }
});

test("metadata changes only accept rotation fields and retain immutable identity", () => {
    const metadata = normalize();
    const changed = changeSecretMetadata(metadata, {
        activeKeyId: "key-next", previousKeyIds: ["key-current"], lastRotatedAt: iso(NOW),
        overlapUntil: iso(NOW + 7 * DAY_MS)
    }, { nowMs: NOW });
    assert.equal(changed.secretId, metadata.secretId);
    assert.equal(changed.environment, "staging");
    assert.equal(changed.activeKeyId, "key-next");
    assert.equal(changed.nextRotationAt, iso(NOW + 90 * DAY_MS));
    for (const field of ["environment", "secretId", "status", "nextRotationAt", "secretValue"]) {
        assertRejected(() => changeSecretMetadata(metadata, { [field]: "sentinel" }, { nowMs: NOW }));
    }
});

test("scope authorization requires same-environment platform admin and opaque actor identity", () => {
    assert.equal(authorizeLifecycleScope(ACTOR, "staging"), "actor-01");
    assert.equal(authorizeLifecycleScope({ ...ACTOR, environment: "production" }, "production"), "actor-01");
    assertRejected(() => authorizeLifecycleScope(ACTOR, "production"), "ENVIRONMENT_SCOPE_MISMATCH");
    assertRejected(() => authorizeLifecycleScope({ ...ACTOR, environment: "production" }, "staging"), "ENVIRONMENT_SCOPE_MISMATCH");
    assertRejected(() => authorizeLifecycleScope({ ...ACTOR, role: "tenant_admin" }, "staging"), "PERMISSION_DENIED");
    assertRejected(() => authorizeLifecycleScope({ ...ACTOR, actorId: "user@example.test" }, "staging"));
    assertRejected(() => authorizeLifecycleScope({ ...ACTOR, token: "sentinel" }, "staging"));
    assertRejected(() => authorizeLifecycleScope(null, "staging"));
});

test("lifecycle defaults are immutable and central legacy configuration remains compatible", () => {
    const config = normalizePlatformSecretLifecycleConfig();
    assert.deepEqual(config, {
        defaultRotationIntervalDays: 90, warningWindowDays: 14, dualKeyOverlapDays: 7,
        oldKeyRetentionDays: 30, inventoryEvidenceTtlMs: 300_000, maxPreviousKeyIds: 64
    });
    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.isFrozen(DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG), true);
    assert.deepEqual(loadPlatformGuardrailsConfig("").security.secretLifecycle, config);
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.secretLifecycle;
    const normalized = normalizePlatformGuardrailsConfig(legacy);
    assert.deepEqual(normalized.security.secretLifecycle, config);
    assert.deepEqual(normalized.security.stepUp, DEFAULT_PLATFORM_GUARDRAILS_CONFIG.security.stepUp);
    assert.deepEqual(normalized.security.alerts, DEFAULT_PLATFORM_GUARDRAILS_CONFIG.security.alerts);
    const override = loadPlatformGuardrailsConfig(JSON.stringify({ security: { secretLifecycle: { warningWindowDays: 5 } } }));
    assert.equal(override.security.secretLifecycle.warningWindowDays, 5);
    assert.equal(override.security.secretLifecycle.defaultRotationIntervalDays, 90);
});

test("invalid lifecycle config numbers and policy ordering fail closed without coercion", () => {
    const invalidOverrides = [
        { defaultRotationIntervalDays: 0 }, { defaultRotationIntervalDays: 3651 }, { defaultRotationIntervalDays: "90" },
        { defaultRotationIntervalDays: 90.5 }, { warningWindowDays: -1 }, { warningWindowDays: 366 },
        { warningWindowDays: 90 }, { warningWindowDays: NaN }, { dualKeyOverlapDays: 0 }, { dualKeyOverlapDays: 91 },
        { oldKeyRetentionDays: 6 }, { oldKeyRetentionDays: 3651 }, { inventoryEvidenceTtlMs: 999 },
        { inventoryEvidenceTtlMs: 3_600_001 }, { maxPreviousKeyIds: 0 }, { maxPreviousKeyIds: 1001 }
    ];
    for (const override of invalidOverrides) {
        assertRejected(() => normalizePlatformSecretLifecycleConfig({ ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, ...override }),
            "INVALID_CONFIG");
        assertRejected(() => normalize({}, { config: { ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, ...override } }), "INVALID_CONFIG");
    }
    assertRejected(() => normalizePlatformSecretLifecycleConfig({}), "INVALID_CONFIG");
    assertRejected(() => normalizePlatformSecretLifecycleConfig(null));
    for (const rotationIntervalDays of [0, -1, 14, 3651, 15.5, "90", null]) {
        assertRejected(() => normalize({ rotationIntervalDays }), "INVALID_CONFIG");
    }
    assertRejected(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { secretLifecycle: { warningWindowDays: 90 } } })));
});

test("config rejects unrecognized fields and accessor values without reading them", () => {
    let reads = 0;
    const config = { ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG };
    Object.defineProperty(config, "warningWindowDays", { get() { reads += 1; throw new Error("sentinel"); } });
    assertRejected(() => normalizePlatformSecretLifecycleConfig(config));
    assert.equal(reads, 0);
    assertRejected(() => normalizePlatformSecretLifecycleConfig({ ...DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, secretValue: "sentinel" }));
    assertRejected(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { secretLifecycle: { secretValue: "sentinel" } } })));
});

test("audit exposes only the exact allowlist and fixed reason code from model-owned metadata", () => {
    const after = normalize();
    const audit = createLifecycleAudit({ actorId: "actor-01", after, action: "secret.metadata.registered" });
    const projection = buildSecretLifecycleAuditMetadata(audit);
    assert.deepEqual(projection, {
        actorId: "actor-01", secretId: "secret-01", environment: "staging", secretType: "backup_encryption_key",
        action: "secret.metadata.registered", oldStatus: null, newStatus: "healthy", keyId: null,
        reasonCode: "METADATA_REGISTERED"
    });
    assert.equal(Object.isFrozen(audit), true);
    assert.equal(Object.isFrozen(projection), true);
    assert.equal(JSON.stringify(projection).includes("team-platform"), false);
    assert.equal(JSON.stringify(projection).includes("backup-service"), false);
    for (const field of FORBIDDEN_FIELDS) assert.equal(Object.hasOwn(projection, field), false);
    assertRejected(() => buildSecretLifecycleAuditMetadata({ ...audit }));
    assertRejected(() => buildSecretLifecycleAuditMetadata(projection));
    assertRejected(() => createLifecycleAudit({ actorId: "actor-01", after: { ...after }, action: "secret.metadata.registered" }));
});

test("audit rejects mixed secret, environment and type provenance", () => {
    const before = normalize();
    for (const after of [normalize({ environment: "production" }), normalize({ secretId: "secret-02" }),
        normalize({ secretType: "signing_key" })]) {
        assertRejected(() => createLifecycleAudit({ actorId: "actor-01", before, after, action: "secret.rotation.completed" }),
            "ENVIRONMENT_SCOPE_MISMATCH");
    }
    assertRejected(() => createLifecycleAudit({ actorId: "actor-01", before: { ...before }, after: before,
        action: "secret.rotation.completed" }));
    assertRejected(() => createLifecycleAudit({ actorId: "user@example.test", after: before, action: "secret.metadata.registered" }));
    assertRejected(() => createLifecycleAudit({ actorId: "actor-01", after: before, action: "secret.metadata.registered", keyId: {} }));
});

test("audit action reasons cannot be supplied or extended by an arbitrary caller", () => {
    const before = normalize();
    const after = refreshSecretMetadata(before, { nowMs: CREATED_MS + 90 * DAY_MS });
    for (const [action, reasonCode] of [
        ["secret.rotation.planned", "ROTATION_PLANNED"], ["secret.rotation.prepared", "ROTATION_PREPARED"],
        ["secret.rotation.verified", "ROTATION_VERIFIED"], ["secret.rotation.completed", "ROTATION_COMPLETED"],
        ["secret.rotation.rollback", "ROTATION_ROLLED_BACK"]
    ]) {
        const audit = buildSecretLifecycleAuditMetadata(createLifecycleAudit({ actorId: "actor-01", before, after, action,
            keyId: "key-current" }));
        assert.equal(audit.reasonCode, reasonCode);
        assert.equal(audit.oldStatus, "healthy");
        assert.equal(audit.newStatus, "overdue");
        assert.equal(audit.keyId, "key-current");
    }
    for (const action of ["secret.rotate.real", "__proto__", "constructor"]) {
        assertRejected(() => createLifecycleAudit({ actorId: "actor-01", after, action }));
    }
    assertRejected(() => createLifecycleAudit({ actorId: "actor-01", after, action: "secret.rotation.planned",
        reasonCode: "sentinel" }));
});

test("audit rejects arbitrary outer payloads and allowed-field getters before accessing data", () => {
    const after = normalize();
    for (const field of [...FORBIDDEN_FIELDS, "actorId", "after", "action", "keyId", "before"]) {
        let reads = 0;
        const candidate = { actorId: "actor-01", after, action: "secret.metadata.registered" };
        Object.defineProperty(candidate, field, { enumerable: true, get() { reads += 1; throw new Error("sentinel"); } });
        assertRejected(() => createLifecycleAudit(candidate));
        assert.equal(reads, 0, field);
    }
    for (const candidate of [null, [], Object.create(null), undefined]) {
        assertRejected(() => createLifecycleAudit(candidate));
    }
});

test("audit rejects nested action payloads without invoking string coercion", () => {
    const after = normalize();
    let reads = 0;
    const nestedAction = {
        password: "sentinel",
        get toString() {
            reads += 1;
            return () => "secret.rotation.completed";
        }
    };
    for (const action of [nestedAction, ["secret.rotation.completed"], new String("secret.rotation.completed"), null, 1]) {
        assertRejected(() => createLifecycleAudit({ actorId: "actor-01", after, action }));
    }
    assert.equal(reads, 0);
});
