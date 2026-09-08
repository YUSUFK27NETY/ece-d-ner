const {
    assertLifecycleFields, lifecycleId, lifecycleEnvironment, lifecycleInteger,
    lifecycleTime, lifecycleNow, lifecycleIds, rejectLifecycle
} = require("./secret-metadata-contract");
const { normalizePlatformSecretLifecycleConfig } = require("../config/platform-secret-lifecycle-config");

const DAY_MS = 86_400_000;
const SECRET_TYPES = Object.freeze(["backup_encryption_key", "service_account", "api_credential", "signing_key"]);
const LIFECYCLE_STATUSES = Object.freeze(["healthy", "due_soon", "overdue", "disabled"]);
const METADATA_FIELDS = Object.freeze([
    "secretId", "environment", "component", "secretType", "owner", "createdAt", "lastRotatedAt",
    "rotationIntervalDays", "status", "activeKeyId", "previousKeyIds", "overlapUntil"
]);
const metadataRecords = new WeakSet();
const audits = new WeakSet();
const ACTION_REASONS = Object.freeze({
    "secret.metadata.registered": "METADATA_REGISTERED",
    "secret.rotation.planned": "ROTATION_PLANNED",
    "secret.rotation.prepared": "ROTATION_PREPARED",
    "secret.rotation.verified": "ROTATION_VERIFIED",
    "secret.rotation.completed": "ROTATION_COMPLETED",
    "secret.rotation.rollback": "ROTATION_ROLLED_BACK"
});

function normalizeSecretMetadata(input, { config, nowMs = Date.now() } = {}) {
    assertLifecycleFields(input, METADATA_FIELDS);
    const policy = normalizePlatformSecretLifecycleConfig(config);
    lifecycleNow(nowMs);
    if (!SECRET_TYPES.includes(input.secretType)) rejectLifecycle();
    if (input.status !== undefined && !LIFECYCLE_STATUSES.includes(input.status)) rejectLifecycle();
    const createdAtMs = lifecycleTime(input.createdAt);
    const lastRotatedAt = input.lastRotatedAt ?? null;
    const lastRotatedAtMs = lastRotatedAt === null ? createdAtMs : lifecycleTime(lastRotatedAt);
    if (createdAtMs > nowMs || lastRotatedAtMs < createdAtMs || lastRotatedAtMs > nowMs) rejectLifecycle();
    const rotationIntervalDays = input.rotationIntervalDays === undefined
        ? policy.defaultRotationIntervalDays : lifecycleInteger(input.rotationIntervalDays, 1, 3650);
    if (policy.warningWindowDays >= rotationIntervalDays) rejectLifecycle("INVALID_CONFIG");
    const activeKeyId = input.activeKeyId == null ? null : lifecycleId(input.activeKeyId);
    const previousKeyIds = lifecycleIds(input.previousKeyIds === undefined ? [] : input.previousKeyIds, policy.maxPreviousKeyIds);
    if (previousKeyIds.includes(activeKeyId) || (input.secretType === "backup_encryption_key" && !activeKeyId)) rejectLifecycle();
    const overlapUntil = input.overlapUntil ?? null;
    if (overlapUntil !== null && (lifecycleTime(overlapUntil) < createdAtMs || previousKeyIds.length === 0)) rejectLifecycle();
    const nextRotationMs = lastRotatedAtMs + rotationIntervalDays * DAY_MS;
    const status = input.status === "disabled" ? "disabled" : nowMs >= nextRotationMs ? "overdue"
        : nowMs >= nextRotationMs - policy.warningWindowDays * DAY_MS ? "due_soon" : "healthy";
    const metadata = Object.freeze({
        secretId: lifecycleId(input.secretId),
        environment: lifecycleEnvironment(input.environment),
        component: lifecycleId(input.component),
        secretType: input.secretType,
        owner: lifecycleId(input.owner),
        createdAt: input.createdAt,
        lastRotatedAt,
        rotationIntervalDays,
        status,
        activeKeyId,
        previousKeyIds,
        overlapUntil,
        nextRotationAt: new Date(nextRotationMs).toISOString()
    });
    metadataRecords.add(metadata);
    return metadata;
}

function refreshSecretMetadata(metadata, options) {
    if (!metadataRecords.has(metadata)) rejectLifecycle();
    const input = {};
    for (const field of METADATA_FIELDS) input[field] = metadata[field];
    return normalizeSecretMetadata(input, options);
}

function changeSecretMetadata(metadata, changes, options) {
    if (!metadataRecords.has(metadata)) rejectLifecycle();
    assertLifecycleFields(changes, ["activeKeyId", "previousKeyIds", "lastRotatedAt", "overlapUntil"]);
    const input = {};
    for (const field of METADATA_FIELDS) input[field] = metadata[field];
    return normalizeSecretMetadata({ ...input, ...changes }, options);
}

function createLifecycleAudit(input) {
    assertLifecycleFields(input, ["actorId", "before", "after", "action", "keyId"]);
    const { actorId, before = null, after, action, keyId = null } = input;
    if (!metadataRecords.has(after) || (before !== null && !metadataRecords.has(before)) ||
        typeof action !== "string" || !Object.hasOwn(ACTION_REASONS, action)) rejectLifecycle();
    if (before && (before.environment !== after.environment || before.secretId !== after.secretId ||
        before.secretType !== after.secretType)) rejectLifecycle("ENVIRONMENT_SCOPE_MISMATCH");
    const audit = Object.freeze({
        actorId: lifecycleId(actorId),
        secretId: after.secretId,
        environment: after.environment,
        secretType: after.secretType,
        action,
        oldStatus: before?.status ?? null,
        newStatus: after.status,
        keyId: keyId === null ? null : lifecycleId(keyId),
        reasonCode: ACTION_REASONS[action]
    });
    audits.add(audit);
    return audit;
}

function buildSecretLifecycleAuditMetadata(audit) {
    if (!audits.has(audit)) rejectLifecycle();
    return Object.freeze({
        actorId: audit.actorId, secretId: audit.secretId, environment: audit.environment,
        secretType: audit.secretType, action: audit.action, oldStatus: audit.oldStatus,
        newStatus: audit.newStatus, keyId: audit.keyId, reasonCode: audit.reasonCode
    });
}

module.exports = {
    DAY_MS, SECRET_TYPES, LIFECYCLE_STATUSES, normalizeSecretMetadata,
    refreshSecretMetadata, changeSecretMetadata, createLifecycleAudit, buildSecretLifecycleAuditMetadata
};
