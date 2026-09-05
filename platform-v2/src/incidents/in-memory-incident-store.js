const crypto = require("node:crypto");
const {
    incidentFields, incidentId, incidentInteger, incidentNow, authorizeIncident, rejectIncident
} = require("./incident-contract");
const { normalizePlatformIncidentsConfig } = require("../config/platform-incidents-config");
const {
    INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_TRANSITIONS, INCIDENT_ACTIONS,
    normalizeIncidentMetadata, changeIncidentMetadata, normalizeIncidentEvidence, createIncidentAudit
} = require("./incident-model");
const { incidentCandidateFromAlert } = require("./incident-alert-adapter");

const TERMINAL = Object.freeze(["closed", "false_positive"]);
const PROOF_TYPES = Object.freeze({
    contained: "containment_attestation", recovered: "recovery_attestation",
    verified: "verification_attestation", false_positive: "forensic_reference"
});

function createInMemoryIncidentStore(options = {}) {
    incidentFields(options, ["config", "clock", "maxRecords"]);
    const { config, clock = Date.now, maxRecords = 10_000 } = options;
    const policy = normalizePlatformIncidentsConfig(config);
    incidentInteger(maxRecords, 1, 100_000);
    if (typeof clock !== "function") rejectIncident("INVALID_CLOCK");
    const records = new Map();
    const correlations = new Map();
    const alertLinks = new Map();
    let lastNow = 0;

    function now() {
        let value;
        try { value = incidentNow(clock()); } catch { rejectIncident("INVALID_CLOCK"); }
        if (value < lastNow) rejectIncident("INVALID_CLOCK");
        lastNow = value;
        return value;
    }

    const key = (tenantId, id) => JSON.stringify([tenantId, id]);
    function scope(input, fields, write = true) {
        incidentFields(input, ["context", "tenantId", ...fields]);
        return authorizeIncident(input.context, input.tenantId, write);
    }

    function entryFor(input) {
        const entry = records.get(key(input.tenantId, incidentId(input.incidentId)));
        if (!entry) rejectIncident("INCIDENT_NOT_FOUND");
        return entry;
    }

    function writable(entry) {
        if (TERMINAL.includes(entry.incident.status)) rejectIncident("INCIDENT_TERMINAL");
    }

    function snapshot(entry) {
        return Object.freeze({
            ...entry.incident,
            evidence: Object.freeze([...entry.evidence.values()].map(receipt => receipt.value)),
            requiredActions: Object.freeze([...entry.actions.values()]),
            retentionEligibleAt: TERMINAL.includes(entry.incident.status)
                ? new Date(Date.parse(entry.incident.updatedAt) + policy.incidentRetentionDays * 86_400_000).toISOString() : null
        });
    }

    function replay(receipt, fingerprint) {
        if (receipt.fingerprint !== fingerprint) rejectIncident("IDEMPOTENCY_CONFLICT");
        return receipt.result;
    }

    function evidenceCapacity(entry, added = 1) {
        if (entry.evidence.size + entry.incident.sourceAlertIds.length + added > policy.maxEvidencePerIncident) rejectIncident("INCIDENT_EVIDENCE_CAPACITY");
    }

    function create(metadata, actorId, nowMs, creationFingerprint = null) {
        if (records.size >= maxRecords) rejectIncident("INCIDENT_STORE_CAPACITY");
        const openCount = [...records.values()].filter(entry => entry.incident.tenantId === metadata.tenantId &&
            !TERMINAL.includes(entry.incident.status)).length;
        if (openCount >= policy.maxOpenIncidents) rejectIncident("OPEN_INCIDENT_CAPACITY");
        if (metadata.sourceAlertIds.length > policy.maxEvidencePerIncident) rejectIncident("INCIDENT_EVIDENCE_CAPACITY");
        const incident = normalizeIncidentMetadata({
            ...metadata, incidentId: crypto.randomUUID(), status: "detected", updatedAt: new Date(nowMs).toISOString()
        }, nowMs);
        const audit = createIncidentAudit({ after: incident, actorId, actionType: "incident.created" });
        const entry = { incident, evidence: new Map(), actions: new Map(), transitions: new Map(), actionReceipts: new Map(), audits: [audit] };
        const result = snapshot(entry);
        entry.creation = { fingerprint: creationFingerprint, result };
        records.set(key(incident.tenantId, incident.incidentId), entry);
        correlations.set(key(incident.tenantId, incident.correlationId), entry);
        for (const alertId of incident.sourceAlertIds) alertLinks.set(key(incident.tenantId, alertId), entry);
        return result;
    }

    // All validation and audit creation precede the synchronous in-memory commit.
    function auditFor(entry, next, actorId, actionType) {
        return createIncidentAudit({ before: entry.incident, after: next, actorId, actionType });
    }

    return Object.freeze({
        createIncident(input) {
            const actorId = scope(input, ["metadata"]);
            incidentFields(input.metadata, ["severity", "category", "detectedAt", "actorId", "correlationId", "owner", "summaryCode"]);
            const raw = input.metadata;
            const nowMs = now();
            // Reject category objects before indexing an allowlist (no coercion hooks).
            if (typeof raw.category !== "string" || !Object.hasOwn(INCIDENT_CATEGORIES, raw.category)) rejectIncident();
            const metadata = normalizeIncidentMetadata({
                ...raw, incidentId: "validation-only", tenantId: input.tenantId, status: "detected",
                sourceAlertIds: [], detectedAt: raw.detectedAt ?? new Date(nowMs).toISOString(),
                updatedAt: new Date(nowMs).toISOString(), summaryCode: raw.summaryCode ?? INCIDENT_CATEGORIES[raw.category]
            }, nowMs);
            const fingerprint = JSON.stringify([actorId, metadata.category, metadata.severity, raw.detectedAt ?? null,
                metadata.actorId, metadata.owner, metadata.summaryCode]);
            const existing = correlations.get(key(input.tenantId, metadata.correlationId));
            if (existing) return replay(existing.creation, fingerprint);
            const { incidentId: ignoredId, status, updatedAt, containmentStatus, recoveryStatus, ...initial } = metadata;
            return create(initial, actorId, nowMs, fingerprint);
        },

        createIncidentFromAlert(input) {
            const actorId = scope(input, ["alert", "owner"]);
            const candidate = incidentCandidateFromAlert(input.alert);
            if (input.alert.tenantId !== input.tenantId) rejectIncident("TENANT_SCOPE_MISMATCH");
            const owner = incidentId(input.owner);
            if (!candidate) return null;
            const nowMs = now();
            // Apply the same timestamp, identifier and finite-category validation as manual creation.
            normalizeIncidentMetadata({ ...candidate, owner, incidentId: "validation-only", status: "detected",
                updatedAt: new Date(nowMs).toISOString() }, nowMs);
            const alertId = candidate.sourceAlertIds[0];
            const byAlert = alertLinks.get(key(input.tenantId, alertId));
            const byCorrelation = correlations.get(key(input.tenantId, candidate.correlationId));
            if (byAlert && (byCorrelation && byAlert !== byCorrelation ||
                byAlert.incident.correlationId !== candidate.correlationId)) rejectIncident("INCIDENT_DEDUPE_CONFLICT");
            const existing = byAlert || byCorrelation;
            if (!existing) return create({ ...candidate, owner }, actorId, nowMs);
            if (existing.incident.sourceAlertIds.includes(alertId)) return snapshot(existing);
            writable(existing);
            evidenceCapacity(existing);
            const before = existing.incident;
            const promoted = INCIDENT_SEVERITIES.indexOf(candidate.severity) > INCIDENT_SEVERITIES.indexOf(before.severity);
            const category = promoted || candidate.category === "admin_takeover" ? candidate.category : before.category;
            const next = changeIncidentMetadata(before, {
                severity: promoted ? candidate.severity : before.severity, category, summaryCode: INCIDENT_CATEGORIES[category],
                actorId: before.actorId === candidate.actorId ? before.actorId : null,
                sourceAlertIds: [...before.sourceAlertIds, alertId],
                detectedAt: candidate.detectedAt < before.detectedAt ? candidate.detectedAt : before.detectedAt,
                updatedAt: new Date(nowMs).toISOString()
            }, nowMs);
            const audit = auditFor(existing, next, actorId, "incident.alert_linked");
            existing.incident = next;
            existing.audits.push(audit);
            alertLinks.set(key(input.tenantId, alertId), existing);
            return snapshot(existing);
        },

        getIncident(input) {
            scope(input, ["incidentId"], false);
            const entry = records.get(key(input.tenantId, incidentId(input.incidentId)));
            return entry ? snapshot(entry) : null;
        },

        listIncidents(input) {
            scope(input, ["limit"], false);
            const limit = incidentInteger(input.limit === undefined ? 20 : input.limit, 1, 200);
            return Object.freeze([...records.values()].filter(entry => entry.incident.tenantId === input.tenantId)
                .sort((a, b) => b.incident.updatedAt.localeCompare(a.incident.updatedAt) || a.incident.incidentId.localeCompare(b.incident.incidentId))
                .slice(0, limit).map(snapshot));
        },

        transitionIncident(input) {
            const actorId = scope(input, ["incidentId", "transitionId", "toStatus", "evidenceId"]);
            const transitionId = incidentId(input.transitionId);
            if (typeof input.toStatus !== "string" || !Object.hasOwn(INCIDENT_TRANSITIONS, input.toStatus)) rejectIncident("INVALID_TRANSITION");
            const evidenceId = input.evidenceId == null ? null : incidentId(input.evidenceId);
            const fingerprint = JSON.stringify([actorId, input.toStatus, evidenceId]);
            const entry = entryFor(input);
            if (entry.transitions.has(transitionId)) return replay(entry.transitions.get(transitionId), fingerprint);
            writable(entry);
            if (!INCIDENT_TRANSITIONS[entry.incident.status].includes(input.toStatus)) rejectIncident("INVALID_TRANSITION");
            const proofType = Object.hasOwn(PROOF_TYPES, input.toStatus) ? PROOF_TYPES[input.toStatus] : null;
            if (proofType ? entry.evidence.get(evidenceId)?.value.evidenceType !== proofType : evidenceId !== null) rejectIncident("TRANSITION_EVIDENCE_REQUIRED");
            if (["verified", "closed"].includes(input.toStatus) && [...entry.actions.values()].some(action => action.status !== "completed")) rejectIncident("REQUIRED_ACTIONS_INCOMPLETE");
            const nowMs = now();
            const next = changeIncidentMetadata(entry.incident, {
                status: input.toStatus, severity: input.toStatus === "escalated" ? "critical" : entry.incident.severity,
                updatedAt: new Date(nowMs).toISOString()
            }, nowMs);
            const audit = auditFor(entry, next, actorId, "incident.transition");
            entry.incident = next;
            entry.audits.push(audit);
            const result = snapshot(entry);
            entry.transitions.set(transitionId, { fingerprint, result });
            return result;
        },

        attachEvidence(input) {
            const actorId = scope(input, ["incidentId", "evidence"]);
            const entry = entryFor(input);
            const nowMs = now();
            const evidence = normalizeIncidentEvidence(input.evidence, entry.incident, nowMs);
            const fingerprint = JSON.stringify([actorId, evidence]);
            if (entry.evidence.has(evidence.evidenceId)) return replay(entry.evidence.get(evidence.evidenceId), fingerprint);
            writable(entry);
            evidenceCapacity(entry);
            const next = changeIncidentMetadata(entry.incident, { updatedAt: new Date(nowMs).toISOString() }, nowMs);
            const audit = auditFor(entry, next, actorId, "incident.evidence_attached");
            const receipt = { fingerprint, value: evidence };
            entry.evidence.set(evidence.evidenceId, receipt);
            entry.incident = next;
            entry.audits.push(audit);
            receipt.result = snapshot(entry);
            return receipt.result;
        },

        // Metadata attestation only: no action executors or provider clients exist in this adapter.
        addRequiredAction(input) {
            const actorId = scope(input, ["incidentId", "actionType", "status", "evidenceId"]);
            if (!INCIDENT_ACTIONS.includes(input.actionType)) rejectIncident("INVALID_ACTION");
            const status = input.status === undefined ? "required" : input.status;
            if (!["required", "planned", "completed"].includes(status)) rejectIncident("INVALID_ACTION");
            const evidenceId = input.evidenceId == null ? null : incidentId(input.evidenceId);
            const entry = entryFor(input);
            const receiptKey = JSON.stringify([input.actionType, status]);
            const fingerprint = JSON.stringify([actorId, evidenceId]);
            if (entry.actionReceipts.has(receiptKey)) return replay(entry.actionReceipts.get(receiptKey), fingerprint);
            writable(entry);
            const previous = entry.actions.get(input.actionType);
            if (previous ? (previous.status === "required" ? status !== "planned" : previous.status === "planned"
                ? status !== "completed" : true) : status !== "required") rejectIncident("INVALID_ACTION_TRANSITION");
            if (status === "completed" ? !entry.evidence.has(evidenceId) : evidenceId !== null) rejectIncident("ACTION_EVIDENCE_REQUIRED");
            const nowMs = now();
            const at = new Date(nowMs).toISOString();
            const next = changeIncidentMetadata(entry.incident, { updatedAt: at }, nowMs);
            const action = Object.freeze({ actionType: input.actionType, status, evidenceId, updatedAt: at });
            const audit = auditFor(entry, next, actorId, `incident.action_${status}`);
            entry.incident = next;
            entry.actions.set(input.actionType, action);
            entry.audits.push(audit);
            const result = snapshot(entry);
            entry.actionReceipts.set(receiptKey, { fingerprint, result });
            return result;
        },

        listAudit(input) {
            scope(input, ["incidentId"], false);
            return Object.freeze([...entryFor(input).audits]);
        }
    });
}

module.exports = { createInMemoryIncidentStore };
