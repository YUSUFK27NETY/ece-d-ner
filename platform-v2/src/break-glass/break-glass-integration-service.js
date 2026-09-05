const { createInMemoryBreakGlassStore } = require("./in-memory-break-glass-store");
const {
    breakGlassFields, breakGlassId, breakGlassNow, authorizeBreakGlass, rejectBreakGlass
} = require("./break-glass-contract");
const { BREAK_GLASS_OPERATION_RISKS, normalizeElevatedOperations } = require("./break-glass-model");
const { snapshotBreakGlassAuth, safeBreakGlassStepUpConfig } = require("./break-glass-step-up-adapter");
const { createPlatformAdminStepUpPolicy, buildStepUpAuditMetadata } = require("../auth/platform-admin-step-up");
const { INCIDENT_TRANSITIONS } = require("../incidents/incident-model");
const { normalizePlatformBreakGlassIntegrationConfig } = require("../config/platform-break-glass-integration-config");

const METHOD_FIELDS = Object.freeze({
    request: Object.freeze(["requestId", "actorId", "reasonCode", "incidentId", "elevatedOperations"]),
    approve: Object.freeze(["breakGlassId", "transitionId", "decision"]),
    activate: Object.freeze(["breakGlassId", "transitionId", "verifiedAuth"]),
    revoke: Object.freeze(["breakGlassId", "transitionId"]),
    complete: Object.freeze(["breakGlassId", "transitionId"]),
    read: Object.freeze(["breakGlassId"]), list: Object.freeze(["limit"]),
    authorize: Object.freeze(["breakGlassId", "operation", "verifiedAuth"])
});
const SAFE_FAILURES = Object.freeze([
    "INVALID_BREAK_GLASS_METADATA", "INVALID_BREAK_GLASS_CONFIG", "INVALID_CLOCK", "INVALID_SCOPE",
    "PERMISSION_DENIED", "TENANT_SCOPE_MISMATCH", "BREAK_GLASS_NOT_FOUND", "BREAK_GLASS_TERMINAL",
    "INVALID_APPROVAL_DECISION", "IDEMPOTENCY_CONFLICT", "INVALID_TRANSITION", "BENEFICIARY_REQUIRED",
    "ACTIVE_SESSION_CAPACITY", "BREAK_GLASS_STORE_CAPACITY", "INVALID_OPERATION", "APPROVAL_REQUIRED",
    "SEPARATE_APPROVER_REQUIRED", "INVALID_EXPIRY", "MISSING_ACTOR", "NOT_PLATFORM_ADMIN", "UNVERIFIED_AUTH",
    "AUTH_TIME_MISSING", "AUTH_TIME_INVALID", "AUTH_EXPIRED", "VERIFIED_FACTOR_REQUIRED", "INVALID_CONFIG",
    "INVALID_OPERATION_POLICY", "UNKNOWN_OPERATION", "INVALID_AUTH_METADATA", "AUTH_ACTOR_MISMATCH",
    "BREAK_GLASS_NOT_ACTIVE", "OPERATION_NOT_ELEVATED", "INCIDENT_REQUIRED", "INCIDENT_UNAVAILABLE",
    "INCIDENT_INVALID", "INCIDENT_NOT_FOUND", "INCIDENT_SCOPE_MISMATCH", "INCIDENT_CLOSED",
    "INCIDENT_NOT_OPEN", "INCIDENT_SEVERITY_REQUIRED"
]);
const audits = new WeakMap();

function ttlBucket(session, nowMs) {
    if (!session || nowMs === null) return "unknown";
    const remaining = Date.parse(session.expiresAt) - nowMs;
    return remaining <= 0 ? "expired" : remaining <= 60_000 ? "under_minute" : remaining <= 300_000 ? "under_five_minutes" : "over_five_minutes";
}

function issue(facts, decision, reasonCode, sessions = null) {
    const session = facts.after || facts.before;
    const audit = Object.freeze({
        breakGlassId: session?.breakGlassId ?? null, actorId: facts.actorId,
        approvedBy: session?.approvedBy ?? null, incidentId: session?.incidentId ?? null,
        tenantId: facts.tenantId, oldStatus: facts.before?.status ?? null,
        newStatus: session?.status ?? null, reasonCode, operation: facts.operation,
        ttlBucket: ttlBucket(session, facts.nowMs), freshnessBucket: facts.freshnessBucket, decision
    });
    const result = Object.freeze({ decision, reasonCode, session: decision === "allow" ? session : null,
        sessions: decision === "allow" ? sessions : null });
    audits.set(result, audit);
    return result;
}

function safeFailure(error) {
    // Never evaluate or forward an exception's message, stack, body, cause or accessor code.
    const descriptor = error && typeof error === "object" ? Object.getOwnPropertyDescriptor(error, "code") : null;
    return descriptor && Object.hasOwn(descriptor, "value") && SAFE_FAILURES.includes(descriptor.value)
        ? descriptor.value : "BREAK_GLASS_INTEGRATION_FAILED";
}

// This facade owns the unchanged 4B-1 core; callers cannot inject a pre-activated session.
// Synchronous in-memory evaluation only. No operation execution or persistent audit/provider I/O.
function createBreakGlassIntegrationService(options = {}) {
    breakGlassFields(options, ["breakGlassConfig", "stepUpConfig", "integrationConfig", "incidentStore", "clock", "maxRecords"]);
    const { clock = Date.now, incidentStore } = options;
    if (typeof clock !== "function") rejectBreakGlass("INVALID_CLOCK");
    const policy = normalizePlatformBreakGlassIntegrationConfig(options.integrationConfig);
    const stepUpConfig = safeBreakGlassStepUpConfig(options.stepUpConfig);
    let incidentReader = null;
    if (incidentStore !== undefined) {
        if (!incidentStore || typeof incidentStore !== "object" || Object.getPrototypeOf(incidentStore) !== Object.prototype) rejectBreakGlass("INCIDENT_INVALID");
        const descriptor = Object.getOwnPropertyDescriptor(incidentStore, "getIncident");
        if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "function") rejectBreakGlass("INCIDENT_INVALID");
        incidentReader = descriptor.value.bind(incidentStore);
    }
    let evaluationTime = 0;
    let running = false;
    const core = createInMemoryBreakGlassStore({ config: options.breakGlassConfig, maxRecords: options.maxRecords, clock: () => evaluationTime });
    const stepUp = createPlatformAdminStepUpPolicy({ config: stepUpConfig, clock: () => evaluationTime,
        additionalOperations: { "break_glass.activate": "high", "break_glass.authorize": "high" } });

    function incidentBinding(session, context) {
        if (session.incidentId === null) {
            if (policy.allowPlatformWithoutIncident && session.scope === "platform" && session.tenantId === null) return;
            rejectBreakGlass("INCIDENT_REQUIRED");
        }
        if (!incidentReader) rejectBreakGlass("INCIDENT_UNAVAILABLE");
        let incident;
        try {
            incident = incidentReader({ context: { actorId: context.actorId, role: context.role, tenantId: session.tenantId },
                tenantId: session.tenantId, incidentId: session.incidentId });
        } catch { rejectBreakGlass("INCIDENT_UNAVAILABLE"); }
        if (incident === null) rejectBreakGlass("INCIDENT_NOT_FOUND");
        if (!incident || typeof incident !== "object" || Object.getPrototypeOf(incident) !== Object.prototype) rejectBreakGlass("INCIDENT_INVALID");
        // Read only four metadata fields; never traverse evidence, raw payloads or provider details.
        const safe = {};
        for (const field of ["incidentId", "tenantId", "severity", "status"]) {
            const descriptor = Object.getOwnPropertyDescriptor(incident, field);
            if (!descriptor || !Object.hasOwn(descriptor, "value")) rejectBreakGlass("INCIDENT_INVALID");
            safe[field] = descriptor.value;
        }
        if (safe.incidentId !== session.incidentId || safe.tenantId !== session.tenantId) rejectBreakGlass("INCIDENT_SCOPE_MISMATCH");
        if (typeof safe.status !== "string" || !Object.hasOwn(INCIDENT_TRANSITIONS, safe.status)) rejectBreakGlass("INCIDENT_INVALID");
        if (safe.status === "closed") rejectBreakGlass("INCIDENT_CLOSED");
        if (safe.status === "false_positive") rejectBreakGlass("INCIDENT_NOT_OPEN");
        if (!["high", "critical"].includes(safe.severity)) rejectBreakGlass("INCIDENT_SEVERITY_REQUIRED");
    }

    function requireStepUp(input, facts, action) {
        let verifiedAuth;
        try { verifiedAuth = snapshotBreakGlassAuth(input.verifiedAuth); } catch { rejectBreakGlass("INVALID_AUTH_METADATA"); }
        const decision = buildStepUpAuditMetadata(stepUp.evaluate({ operation: `break_glass.${action}`, verifiedAuth }));
        facts.freshnessBucket = decision.freshnessBucket;
        if (decision.decision !== "allow") rejectBreakGlass(decision.reasonCode);
        if (decision.actorId !== facts.actorId) rejectBreakGlass("AUTH_ACTOR_MISMATCH");
        if (facts.before.actorId !== facts.actorId) rejectBreakGlass("BENEFICIARY_REQUIRED");
    }

    function run(action, input) {
        const facts = { actorId: null, tenantId: null, before: null, after: null, nowMs: null,
            operation: action === "authorize" ? "unknown" : `break_glass.${action}`, freshnessBucket: "unknown" };
        if (running) return issue(facts, "deny", "BREAK_GLASS_INTEGRATION_BUSY");
        running = true;
        try {
            breakGlassFields(input, ["context", "scope", "tenantId", ...METHOD_FIELDS[action]]);
            facts.actorId = authorizeBreakGlass(input.context, input.scope, input.tenantId);
            facts.tenantId = input.tenantId;
            const context = Object.freeze({ ...input.context });
            let nowMs;
            try { nowMs = breakGlassNow(clock()); } catch { rejectBreakGlass("INVALID_CLOCK"); }
            if (nowMs < evaluationTime) rejectBreakGlass("INVALID_CLOCK");
            facts.nowMs = evaluationTime = nowMs;
            const query = { context, scope: input.scope, tenantId: input.tenantId };
            if (action === "list") return issue(facts, "allow", "BREAK_GLASS_LISTED", core.listBreakGlass({ ...query, limit: input.limit }));
            if (action === "request") {
                const incidentId = input.incidentId == null ? null : breakGlassId(input.incidentId);
                const elevatedOperations = normalizeElevatedOperations(input.elevatedOperations);
                const payload = { ...query, incidentId, elevatedOperations, requestId: input.requestId,
                    actorId: input.actorId, reasonCode: input.reasonCode };
                incidentBinding(payload, context);
                facts.after = core.requestBreakGlass(payload);
                return issue(facts, "allow", "BREAK_GLASS_REQUESTED");
            }
            query.breakGlassId = breakGlassId(input.breakGlassId);
            facts.before = core.getBreakGlass(query);
            if (!facts.before) rejectBreakGlass("BREAK_GLASS_NOT_FOUND");
            if (action === "read") return issue(facts, "allow", "BREAK_GLASS_READ");
            if (action === "authorize") {
                if (typeof input.operation !== "string" || !Object.hasOwn(BREAK_GLASS_OPERATION_RISKS, input.operation)) rejectBreakGlass("UNKNOWN_OPERATION");
                facts.operation = input.operation;
                if (facts.before.status !== "active") rejectBreakGlass("BREAK_GLASS_NOT_ACTIVE");
                if (!facts.before.elevatedOperations.includes(input.operation)) rejectBreakGlass("OPERATION_NOT_ELEVATED");
                requireStepUp(input, facts, "authorize");
                incidentBinding(facts.before, context);
                return issue(facts, "allow", "BREAK_GLASS_OPERATION_ALLOWED");
            }
            const transitionId = breakGlassId(input.transitionId);
            if (action === "activate") {
                if (!["approved", "active"].includes(facts.before.status)) rejectBreakGlass("BREAK_GLASS_NOT_ACTIVE");
                requireStepUp(input, facts, "activate");
                incidentBinding(facts.before, context);
                facts.after = core.activateBreakGlass({ ...query, transitionId });
            } else if (action === "approve") {
                if (input.decision === "deny") facts.operation = "break_glass.deny";
                else incidentBinding(facts.before, context);
                facts.after = core.approveBreakGlass({ ...query, transitionId, decision: input.decision });
            } else if (action === "revoke") {
                facts.after = core.revokeBreakGlass({ ...query, transitionId });
            } else {
                facts.after = core.completeBreakGlass({ ...query, transitionId });
            }
            return issue(facts, "allow", facts.after.status === "denied" ? "BREAK_GLASS_DENIED" : "BREAK_GLASS_LIFECYCLE_RECORDED");
        } catch (error) {
            return issue(facts, "deny", safeFailure(error));
        } finally { running = false; }
    }

    return Object.freeze({
        requestBreakGlass(input) { return run("request", input); },
        approveBreakGlass(input) { return run("approve", input); },
        activateBreakGlass(input) { return run("activate", input); },
        revokeBreakGlass(input) { return run("revoke", input); },
        completeBreakGlass(input) { return run("complete", input); },
        getBreakGlass(input) { return run("read", input); },
        listBreakGlass(input) { return run("list", input); },
        authorizeBreakGlassOperation(input) { return run("authorize", input); }
    });
}

// A raw, copied or hydrated object can never be promoted into a safe audit event.
function buildBreakGlassAuditMetadata(result) {
    if (!audits.has(result)) rejectBreakGlass("INVALID_BREAK_GLASS_AUDIT");
    return audits.get(result);
}

module.exports = { createBreakGlassIntegrationService, buildBreakGlassAuditMetadata };
