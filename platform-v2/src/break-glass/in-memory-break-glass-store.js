const crypto = require("node:crypto");
const {
    breakGlassFields, breakGlassId, breakGlassInteger, breakGlassNow, authorizeBreakGlass, rejectBreakGlass
} = require("./break-glass-contract");
const { normalizePlatformBreakGlassConfig } = require("../config/platform-break-glass-config");
const {
    BREAK_GLASS_TRANSITIONS, TERMINAL, normalizeBreakGlassMetadata,
    refreshBreakGlassMetadata, changeBreakGlassMetadata
} = require("./break-glass-model");

// Metadata only: no auth/session grant, step-up, incident lookup, audit sink or provider client.
// All activation paths require an explicit approved state. Policy flags never skip that stage.
// Returned objects are snapshots, never authorization tickets; later enforcement must re-read
// current state/expiry and independently validate identity. No real operation is executed here.
function createInMemoryBreakGlassStore(options = {}) {
    breakGlassFields(options, ["config", "clock", "maxRecords"]);
    const { config, clock = Date.now, maxRecords = 1000 } = options;
    const policy = normalizePlatformBreakGlassConfig(config);
    breakGlassInteger(maxRecords, 1, 10_000);
    if (typeof clock !== "function") rejectBreakGlass("INVALID_CLOCK");
    const records = new Map();
    const requests = new Map();
    let lastNow = 0;

    function now() {
        let value;
        try { value = breakGlassNow(clock()); } catch { rejectBreakGlass("INVALID_CLOCK"); }
        if (value < lastNow) rejectBreakGlass("INVALID_CLOCK");
        lastNow = value;
        return value;
    }

    const key = (scope, tenantId, id) => JSON.stringify([scope, tenantId, id]);
    function authorize(input, fields) {
        breakGlassFields(input, ["context", "scope", "tenantId", ...fields]);
        return authorizeBreakGlass(input.context, input.scope, input.tenantId);
    }

    function current(entry, nowMs) {
        return refreshBreakGlassMetadata(entry.record, { config: policy, nowMs });
    }

    function entryFor(input) {
        const entry = records.get(key(input.scope, input.tenantId, breakGlassId(input.breakGlassId)));
        if (!entry) rejectBreakGlass("BREAK_GLASS_NOT_FOUND");
        return entry;
    }

    function transition(input, action) {
        const actorId = authorize(input, ["breakGlassId", "transitionId", ...(action === "approve" ? ["decision"] : [])]);
        const transitionId = breakGlassId(input.transitionId);
        const decision = action === "approve" ? input.decision === undefined ? "approve" : input.decision : null;
        if (action === "approve" && !["approve", "deny"].includes(decision)) rejectBreakGlass("INVALID_APPROVAL_DECISION");
        const target = action === "approve" ? decision === "deny" ? "denied" : "approved"
            : action === "activate" ? "active" : action === "revoke" ? "revoked" : "completed";
        const fingerprint = JSON.stringify([actorId, action, target]);
        const entry = entryFor(input);
        const nowMs = now();
        const before = current(entry, nowMs);
        const receipt = entry.transitions.get(transitionId);
        // A historical active receipt must never resurrect an expired/revoked/finished record.
        if (TERMINAL.includes(before.status) && (!receipt || target !== before.status)) rejectBreakGlass("BREAK_GLASS_TERMINAL");
        if (receipt) {
            if (receipt !== fingerprint) rejectBreakGlass("IDEMPOTENCY_CONFLICT");
            return before; // Current safe state, not an old active snapshot.
        }
        if (!BREAK_GLASS_TRANSITIONS[before.status].includes(target)) rejectBreakGlass("INVALID_TRANSITION");
        if (["activate", "complete"].includes(action) && actorId !== before.actorId) rejectBreakGlass("BENEFICIARY_REQUIRED");
        if (target === "active") {
            // Global store-wide cap across scopes. Expired metadata never consumes active capacity.
            const activeCount = [...records.values()].filter(record => current(record, nowMs).status === "active").length;
            if (activeCount >= policy.maxActiveSessions) rejectBreakGlass("ACTIVE_SESSION_CAPACITY");
        }
        const after = changeBreakGlassMetadata(before, {
            status: target,
            approvedBy: target === "approved" ? actorId : before.approvedBy,
            revokedAt: target === "revoked" ? new Date(nowMs).toISOString() : before.revokedAt
        }, { config: policy, nowMs });
        // Validation is complete before this synchronous, metadata-only commit.
        entry.record = after;
        entry.transitions.set(transitionId, fingerprint);
        return after;
    }

    return Object.freeze({
        requestBreakGlass(input) {
            const requestedBy = authorize(input, ["requestId", "actorId", "reasonCode", "incidentId", "elevatedOperations"]);
            const requestId = breakGlassId(input.requestId);
            const nowMs = now();
            const metadata = normalizeBreakGlassMetadata({
                breakGlassId: "validation-only", actorId: input.actorId === undefined ? requestedBy : input.actorId,
                requestedBy, approvedBy: null, reasonCode: input.reasonCode, scope: input.scope, tenantId: input.tenantId,
                createdAt: new Date(nowMs).toISOString(), expiresAt: new Date(nowMs + policy.ttlMs).toISOString(),
                status: "requested", incidentId: input.incidentId, elevatedOperations: input.elevatedOperations,
                usedAt: null, revokedAt: null
            }, { config: policy, nowMs });
            const requestKey = JSON.stringify([input.scope, input.tenantId, requestedBy, requestId]);
            const fingerprint = JSON.stringify([metadata.actorId, metadata.reasonCode, metadata.incidentId, metadata.elevatedOperations]);
            const existing = requests.get(requestKey);
            if (existing) {
                if (existing.fingerprint !== fingerprint) rejectBreakGlass("IDEMPOTENCY_CONFLICT");
                return current(existing.entry, nowMs);
            }
            if (records.size >= maxRecords) rejectBreakGlass("BREAK_GLASS_STORE_CAPACITY");
            const record = normalizeBreakGlassMetadata({ ...metadata, breakGlassId: crypto.randomUUID() }, { config: policy, nowMs });
            const entry = { record, transitions: new Map() };
            records.set(key(record.scope, record.tenantId, record.breakGlassId), entry);
            requests.set(requestKey, { fingerprint, entry });
            return record;
        },

        // decision: "deny" records the terminal denial; omitting decision means explicit approval.
        approveBreakGlass(input) { return transition(input, "approve"); },
        activateBreakGlass(input) { return transition(input, "activate"); },
        revokeBreakGlass(input) { return transition(input, "revoke"); },
        completeBreakGlass(input) { return transition(input, "complete"); },

        getBreakGlass(input) {
            authorize(input, ["breakGlassId"]);
            const entry = records.get(key(input.scope, input.tenantId, breakGlassId(input.breakGlassId)));
            const nowMs = now();
            return entry ? current(entry, nowMs) : null;
        },

        listBreakGlass(input) {
            authorize(input, ["limit"]);
            const limit = breakGlassInteger(input.limit === undefined ? 20 : input.limit, 1, 200);
            const nowMs = now();
            return Object.freeze([...records.values()]
                .filter(entry => entry.record.scope === input.scope && entry.record.tenantId === input.tenantId)
                .map(entry => current(entry, nowMs))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.breakGlassId.localeCompare(b.breakGlassId))
                .slice(0, limit));
        }
    });
}

module.exports = { createInMemoryBreakGlassStore };
