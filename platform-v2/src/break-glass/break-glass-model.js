const {
    breakGlassFields, breakGlassId, breakGlassNow, breakGlassTime, breakGlassScope, rejectBreakGlass
} = require("./break-glass-contract");
const { normalizePlatformBreakGlassConfig } = require("../config/platform-break-glass-config");

const BREAK_GLASS_OPERATION_RISKS = Object.freeze({
    "incident.read": "low",
    "incident.transition": "high",
    "tenant.security.read": "low",
    "backup.verify": "low",
    "credential.rotation.plan": "high",
    "admin.lockdown.plan": "high"
});
const BREAK_GLASS_REASONS = Object.freeze([
    "INCIDENT_RESPONSE_REQUIRED", "SECURITY_REVIEW_REQUIRED", "EMERGENCY_ACCESS_REQUIRED", "RECOVERY_REVIEW_REQUIRED"
]);
const BREAK_GLASS_TRANSITIONS = Object.freeze({
    requested: Object.freeze(["approved", "denied", "revoked", "expired"]),
    approved: Object.freeze(["active", "revoked", "expired"]),
    active: Object.freeze(["completed", "revoked", "expired"]),
    expired: Object.freeze([]), revoked: Object.freeze([]), completed: Object.freeze([]), denied: Object.freeze([])
});
const TERMINAL = Object.freeze(["expired", "revoked", "completed", "denied"]);
const METADATA_FIELDS = Object.freeze([
    "breakGlassId", "actorId", "requestedBy", "approvedBy", "reasonCode", "scope", "tenantId",
    "createdAt", "expiresAt", "status", "incidentId", "elevatedOperations", "usedAt", "revokedAt"
]);
const issuedRecords = new WeakSet();

function normalizeElevatedOperations(input) {
    if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype ||
        input.length < 1 || input.length > Object.keys(BREAK_GLASS_OPERATION_RISKS).length ||
        Reflect.ownKeys(input).length !== input.length + 1) rejectBreakGlass("INVALID_OPERATION");
    const result = [];
    for (let i = 0; i < input.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string" ||
            !Object.hasOwn(BREAK_GLASS_OPERATION_RISKS, descriptor.value) || result.includes(descriptor.value)) rejectBreakGlass("INVALID_OPERATION");
        result.push(descriptor.value);
    }
    return Object.freeze(result.sort());
}

function separateApprovalRequired(operations, policy) {
    // High-risk approval remains independent even if low-risk self-approval is configured.
    return policy.requireSeparateApprover || policy.approvalRequiredForHighRisk &&
        operations.some(operation => BREAK_GLASS_OPERATION_RISKS[operation] === "high");
}

function normalizeBreakGlassMetadata(input, { config, nowMs = Date.now() } = {}) {
    breakGlassFields(input, METADATA_FIELDS);
    const policy = normalizePlatformBreakGlassConfig(config);
    breakGlassNow(nowMs);
    const operations = normalizeElevatedOperations(input.elevatedOperations);
    if (!BREAK_GLASS_REASONS.includes(input.reasonCode) || typeof input.status !== "string" ||
        !Object.hasOwn(BREAK_GLASS_TRANSITIONS, input.status)) rejectBreakGlass();
    const actorId = breakGlassId(input.actorId);
    const requestedBy = breakGlassId(input.requestedBy);
    const approvedBy = input.approvedBy == null ? null : breakGlassId(input.approvedBy);
    if (["approved", "active", "completed"].includes(input.status) && approvedBy === null ||
        ["requested", "denied"].includes(input.status) && approvedBy !== null) rejectBreakGlass("APPROVAL_REQUIRED");
    if (approvedBy !== null && separateApprovalRequired(operations, policy) &&
        [requestedBy, actorId].includes(approvedBy)) rejectBreakGlass("SEPARATE_APPROVER_REQUIRED");
    const createdAtMs = breakGlassTime(input.createdAt);
    const expiresAtMs = breakGlassTime(input.expiresAt);
    if (createdAtMs > nowMs || expiresAtMs !== createdAtMs + policy.ttlMs) rejectBreakGlass("INVALID_EXPIRY");
    if (input.status === "expired" && nowMs < expiresAtMs) rejectBreakGlass("INVALID_EXPIRY");
    // 4B-1 never performs an elevated operation; usedAt is reserved for later integration.
    if (input.usedAt != null) rejectBreakGlass();
    const revokedAt = input.revokedAt ?? null;
    if (input.status === "revoked" ? revokedAt === null || breakGlassTime(revokedAt) < createdAtMs ||
        breakGlassTime(revokedAt) > nowMs || breakGlassTime(revokedAt) >= expiresAtMs : revokedAt !== null) rejectBreakGlass();
    const status = !TERMINAL.includes(input.status) && nowMs >= expiresAtMs ? "expired" : input.status;
    const record = Object.freeze({
        breakGlassId: breakGlassId(input.breakGlassId), actorId, requestedBy, approvedBy,
        reasonCode: input.reasonCode, scope: input.scope, tenantId: breakGlassScope(input.scope, input.tenantId),
        createdAt: input.createdAt, expiresAt: input.expiresAt, status,
        incidentId: input.incidentId == null ? null : breakGlassId(input.incidentId),
        elevatedOperations: operations, usedAt: null, revokedAt
    });
    issuedRecords.add(record);
    return record;
}

function refreshBreakGlassMetadata(record, options) {
    if (!issuedRecords.has(record)) rejectBreakGlass();
    return normalizeBreakGlassMetadata(record, options);
}

function changeBreakGlassMetadata(record, changes, options) {
    if (!issuedRecords.has(record)) rejectBreakGlass();
    breakGlassFields(changes, ["approvedBy", "status", "revokedAt"]);
    const before = refreshBreakGlassMetadata(record, options);
    if (!BREAK_GLASS_TRANSITIONS[before.status].includes(changes.status)) rejectBreakGlass("INVALID_TRANSITION");
    if (changes.status !== "approved" && changes.approvedBy !== undefined && changes.approvedBy !== before.approvedBy ||
        changes.status !== "revoked" && changes.revokedAt !== undefined && changes.revokedAt !== before.revokedAt) rejectBreakGlass();
    return normalizeBreakGlassMetadata({ ...before, ...changes }, options);
}

module.exports = {
    BREAK_GLASS_OPERATION_RISKS, BREAK_GLASS_REASONS, BREAK_GLASS_TRANSITIONS, TERMINAL,
    normalizeElevatedOperations, normalizeBreakGlassMetadata, refreshBreakGlassMetadata, changeBreakGlassMetadata
};
