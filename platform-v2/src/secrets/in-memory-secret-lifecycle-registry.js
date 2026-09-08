const {
    assertLifecycleFields, lifecycleId, lifecycleEnvironment, lifecycleInteger,
    lifecycleTime, lifecycleNow, authorizeLifecycleScope, rejectLifecycle
} = require("./secret-metadata-contract");
const { normalizePlatformSecretLifecycleConfig } = require("../config/platform-secret-lifecycle-config");
const {
    DAY_MS, normalizeSecretMetadata, refreshSecretMetadata, changeSecretMetadata, createLifecycleAudit
} = require("./secret-lifecycle-model");

const COMMAND_FIELDS = Object.freeze(["context", "environment", "secretId", "rotationId"]);
const ROLLBACK_REASONS = Object.freeze(["ROTATION_ABORTED", "VERIFICATION_FAILED", "POST_ROTATION_CHECK_FAILED"]);
const TRANSITIONS = Object.freeze({ prepared: "planned", verified: "prepared", completed: "verified" });

function createInMemorySecretLifecycleRegistry({ config, clock = Date.now, maxRecords = 1000 } = {}) {
    const policy = normalizePlatformSecretLifecycleConfig(config);
    lifecycleInteger(maxRecords, 1, 100_000);
    if (typeof clock !== "function") rejectLifecycle("INVALID_CLOCK");
    const records = new Map();
    let lastNow = 0;

    function now() {
        let value;
        try { value = lifecycleNow(clock()); } catch { rejectLifecycle("INVALID_CLOCK"); }
        if (value < lastNow) rejectLifecycle("INVALID_CLOCK");
        lastNow = value;
        return value;
    }

    function recordKey(environment, secretId) {
        return JSON.stringify([lifecycleEnvironment(environment), lifecycleId(secretId)]);
    }

    function command(input, extraFields = [], withRotation = true) {
        assertLifecycleFields(input, withRotation ? [...COMMAND_FIELDS, ...extraFields]
            : ["context", "environment", "secretId", ...extraFields]);
        const actorId = authorizeLifecycleScope(input.context, input.environment);
        const key = recordKey(input.environment, input.secretId);
        const rotationId = withRotation ? lifecycleId(input.rotationId) : null;
        return { actorId, key, rotationId };
    }

    function entryFor(key) {
        const entry = records.get(key);
        if (!entry) rejectLifecycle("METADATA_NOT_FOUND");
        return entry;
    }

    function refreshed(entry, nowMs) {
        return refreshSecretMetadata(entry.metadata, { config: policy, nowMs });
    }

    function replay(receipt, fingerprint) {
        if (receipt.fingerprint !== fingerprint) rejectLifecycle("IDEMPOTENCY_CONFLICT");
        return receipt.result;
    }

    function overlapUntil(before, nowMs, needsOverlap) {
        if (!needsOverlap) return before.overlapUntil;
        return new Date(Math.max(
            nowMs + policy.dualKeyOverlapDays * DAY_MS,
            before.overlapUntil === null ? 0 : lifecycleTime(before.overlapUntil)
        )).toISOString();
    }

    function transition(input, stage) {
        const fields = stage === "prepared" ? ["candidateKeyId"] : stage === "verified"
            ? ["verified", "verificationId", "keyId"] : stage === "rollback" ? ["reasonCode"] : [];
        const { actorId, key, rotationId } = command(input, fields);
        const candidateKeyId = stage === "prepared" && input.candidateKeyId != null ? lifecycleId(input.candidateKeyId) : null;
        const verificationId = stage === "verified" ? lifecycleId(input.verificationId) : null;
        const verifiedKeyId = stage === "verified" && input.keyId != null ? lifecycleId(input.keyId) : null;
        if (stage === "verified" && input.verified !== true) rejectLifecycle("VERIFICATION_REQUIRED");
        if (stage === "rollback" && !ROLLBACK_REASONS.includes(input.reasonCode)) rejectLifecycle("INVALID_ROLLBACK_REASON");
        const fingerprint = JSON.stringify([actorId, candidateKeyId, verificationId, verifiedKeyId, stage === "rollback" ? input.reasonCode : null]);
        const entry = entryFor(key);
        const rotation = entry.rotations.get(rotationId);
        if (!rotation) rejectLifecycle("ROTATION_NOT_FOUND");
        if (rotation.receipts.has(stage)) return replay(rotation.receipts.get(stage), fingerprint);
        if (entry.currentRotationId !== rotationId) rejectLifecycle("STALE_ROTATION");
        if (stage === "rollback" ? !["planned", "prepared", "verified", "completed"].includes(rotation.view.state)
            : rotation.view.state !== TRANSITIONS[stage]) rejectLifecycle("INVALID_TRANSITION");

        const nowMs = now();
        const at = new Date(nowMs).toISOString();
        const before = refreshed(entry, nowMs);
        let after = before;
        const next = { ...rotation.view, state: stage === "rollback" ? "rolled_back" : stage };
        const retainedSince = new Map(entry.retainedSince);
        if (stage === "prepared") {
            if ((before.activeKeyId !== null && candidateKeyId === null) || candidateKeyId === before.activeKeyId && candidateKeyId !== null ||
                before.previousKeyIds.includes(candidateKeyId)) rejectLifecycle("INVALID_CANDIDATE_KEY");
            // Reserve room for both completion's old key and rollback's prepared candidate.
            if (candidateKeyId !== null && before.previousKeyIds.length >= policy.maxPreviousKeyIds) rejectLifecycle("KEY_RETENTION_CAPACITY");
            next.candidateKeyId = candidateKeyId;
            next.preparedAt = at;
        } else if (stage === "verified") {
            if (verifiedKeyId !== rotation.view.candidateKeyId) rejectLifecycle("VERIFICATION_KEY_MISMATCH");
            next.verificationId = verificationId;
            next.verifiedAt = at;
        } else if (stage === "completed") {
            const previousKeyIds = [...before.previousKeyIds];
            if (before.activeKeyId !== null) {
                previousKeyIds.push(before.activeKeyId);
                retainedSince.set(before.activeKeyId, nowMs);
            }
            after = changeSecretMetadata(before, {
                activeKeyId: rotation.view.candidateKeyId,
                previousKeyIds,
                lastRotatedAt: at,
                overlapUntil: overlapUntil(before, nowMs, previousKeyIds.length > 0)
            }, { config: policy, nowMs });
            next.completedAt = at;
        } else {
            // Rollback never drops the candidate: it may already protect newly written backups.
            const baseline = rotation.baseline;
            const previousKeyIds = [...new Set([
                ...before.previousKeyIds, ...baseline.previousKeyIds,
                ...(rotation.view.candidateKeyId === null ? [] : [rotation.view.candidateKeyId])
            ])].filter(id => id !== baseline.activeKeyId);
            if (rotation.view.candidateKeyId !== null) retainedSince.set(rotation.view.candidateKeyId, nowMs);
            after = changeSecretMetadata(before, {
                activeKeyId: baseline.activeKeyId, previousKeyIds,
                lastRotatedAt: baseline.lastRotatedAt,
                overlapUntil: overlapUntil(before, nowMs, rotation.view.candidateKeyId !== null)
            }, { config: policy, nowMs });
            next.rolledBackAt = at;
            next.rollbackReasonCode = input.reasonCode;
        }
        const view = Object.freeze(next);
        const audit = createLifecycleAudit({
            actorId, before, after, action: `secret.rotation.${stage}`,
            keyId: stage === "prepared" ? candidateKeyId : rotation.view.candidateKeyId
        });
        const result = Object.freeze({ metadata: after, rotation: view, audit });
        // All validation above is complete; state + audit commit synchronously in this adapter.
        entry.metadata = after;
        entry.retainedSince = retainedSince;
        rotation.view = view;
        rotation.receipts.set(stage, { fingerprint, result });
        entry.audits.push(audit);
        return result;
    }

    return Object.freeze({
        register(input) {
            assertLifecycleFields(input, ["context", "metadata"]);
            // Validate metadata before using its environment; arbitrary secret envelopes are rejected.
            const nowMs = now();
            const metadata = normalizeSecretMetadata(input.metadata, { config: policy, nowMs });
            const actorId = authorizeLifecycleScope(input.context, metadata.environment);
            const key = recordKey(metadata.environment, metadata.secretId);
            const fingerprint = JSON.stringify([actorId, { ...metadata, status: metadata.status === "disabled" }]);
            const current = records.get(key);
            if (current) return replay(current.registration, fingerprint);
            if (records.size >= maxRecords) rejectLifecycle("REGISTRY_CAPACITY");
            const audit = createLifecycleAudit({ actorId, after: metadata, action: "secret.metadata.registered", keyId: metadata.activeKeyId });
            const result = Object.freeze({ metadata, audit });
            records.set(key, {
                metadata, registration: { fingerprint, result }, currentRotationId: null,
                retainedSince: new Map(metadata.previousKeyIds.map(id => [id, nowMs])),
                rotations: new Map(), audits: [audit]
            });
            return result;
        },

        get(input) {
            const { key } = command(input, [], false);
            const entry = records.get(key);
            return entry ? refreshed(entry, now()) : null;
        },

        list(input) {
            assertLifecycleFields(input, ["context", "environment"]);
            authorizeLifecycleScope(input.context, input.environment);
            const nowMs = now();
            return Object.freeze([...records.values()]
                .filter(entry => entry.metadata.environment === input.environment)
                .map(entry => refreshed(entry, nowMs)).sort((a, b) => a.secretId.localeCompare(b.secretId)));
        },

        getRotation(input) {
            const { key, rotationId } = command(input);
            return entryFor(key).rotations.get(rotationId)?.view || null;
        },

        listAudit(input) {
            const { key } = command(input, [], false);
            return Object.freeze([...entryFor(key).audits]);
        },

        planRotation(input) {
            const { actorId, key, rotationId } = command(input);
            const entry = entryFor(key);
            const fingerprint = JSON.stringify([actorId]);
            const existing = entry.rotations.get(rotationId);
            if (existing) return replay(existing.receipts.get("planned"), fingerprint);
            const current = entry.rotations.get(entry.currentRotationId);
            if (current && !["completed", "rolled_back"].includes(current.view.state)) rejectLifecycle("ROTATION_IN_PROGRESS");
            const nowMs = now();
            const metadata = refreshed(entry, nowMs);
            if (metadata.status === "disabled") rejectLifecycle("SECRET_DISABLED");
            const rotation = Object.freeze({
                rotationId, secretId: metadata.secretId, environment: metadata.environment,
                state: "planned", fromKeyId: metadata.activeKeyId, candidateKeyId: null,
                plannedAt: new Date(nowMs).toISOString(), preparedAt: null, verifiedAt: null,
                completedAt: null, rolledBackAt: null, verificationId: null, rollbackReasonCode: null
            });
            const audit = createLifecycleAudit({ actorId, before: metadata, after: metadata, action: "secret.rotation.planned", keyId: metadata.activeKeyId });
            const result = Object.freeze({ metadata, rotation, audit });
            entry.rotations.set(rotationId, { baseline: metadata, view: rotation, receipts: new Map([["planned", { fingerprint, result }]]) });
            entry.currentRotationId = rotationId;
            entry.audits.push(audit);
            return result;
        },

        markRotationPrepared(input) { return transition(input, "prepared"); },
        markRotationVerified(input) { return transition(input, "verified"); },
        markRotationCompleted(input) { return transition(input, "completed"); },
        markRollback(input) { return transition(input, "rollback"); },

        // Assessment only: never removes an ID or calls a provider to revoke a key.
        planKeyRetirement(input) {
            const { key } = command(input, ["keyId", "evidence"], false);
            const keyId = lifecycleId(input.keyId);
            const entry = entryFor(key);
            const nowMs = now();
            const metadata = refreshed(entry, nowMs);
            const decision = (reasonCode, allowed = false) => Object.freeze({
                secretId: metadata.secretId, environment: metadata.environment, keyId,
                decision: allowed ? "allow" : "deny", reasonCode
            });
            if (keyId === metadata.activeKeyId) return decision("ACTIVE_KEY_REQUIRED");
            if (!metadata.previousKeyIds.includes(keyId)) return decision("KEY_NOT_RETAINED");
            const rotation = entry.rotations.get(entry.currentRotationId);
            if (rotation && ["planned", "prepared", "verified"].includes(rotation.view.state)) return decision("ROTATION_IN_PROGRESS");
            if (metadata.overlapUntil && nowMs < lifecycleTime(metadata.overlapUntil)) return decision("DUAL_KEY_OVERLAP_ACTIVE");
            const retainedSince = entry.retainedSince.get(keyId);
            if (retainedSince === undefined || nowMs < retainedSince + policy.oldKeyRetentionDays * DAY_MS) return decision("OLD_KEY_RETENTION_ACTIVE");
            const evidence = input.evidence;
            if (evidence === undefined || evidence === null) return decision("RETENTION_EVIDENCE_REQUIRED");
            try {
                assertLifecycleFields(evidence, ["environment", "secretId", "keyId", "verified", "complete",
                    "checkedAt", "retainedBackupCount", "otherReferenceCount", "rollbackRequired"]);
                if (evidence.verified !== true || evidence.complete !== true ||
                    lifecycleEnvironment(evidence.environment) !== metadata.environment ||
                    lifecycleId(evidence.secretId) !== metadata.secretId || lifecycleId(evidence.keyId) !== keyId) {
                    return decision("RETENTION_EVIDENCE_INVALID");
                }
                const checkedAt = lifecycleTime(evidence.checkedAt);
                if (checkedAt < retainedSince || checkedAt > nowMs || nowMs - checkedAt >= policy.inventoryEvidenceTtlMs) return decision("RETENTION_EVIDENCE_STALE");
                const backups = lifecycleInteger(evidence.retainedBackupCount, 0, Number.MAX_SAFE_INTEGER);
                const references = lifecycleInteger(evidence.otherReferenceCount, 0, Number.MAX_SAFE_INTEGER);
                if (backups > 0) return decision("BACKUP_KEY_STILL_REFERENCED");
                if (references > 0) return decision("KEY_STILL_REFERENCED");
                if (evidence.rollbackRequired !== false) return decision("ROLLBACK_KEY_REQUIRED");
            } catch { return decision("RETENTION_EVIDENCE_INVALID"); }
            return decision("RETIREMENT_METADATA_ELIGIBLE", true);
        }
    });
}

module.exports = { createInMemorySecretLifecycleRegistry };
