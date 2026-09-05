const {
    incidentFields, incidentId, incidentUuid, incidentTenant, incidentIds,
    incidentTime, incidentNow, rejectIncident
} = require("./incident-contract");
const { SECURITY_EVENT_OPERATIONS, SECURITY_EVENT_REASON_CODES } = require("../security/security-alert-model");

const INCIDENT_CATEGORIES = Object.freeze({
    admin_takeover: "ADMIN_TAKEOVER_CONFIRMED",
    tenant_boundary_violation: "TENANT_BOUNDARY_VIOLATION",
    credential_exposure: "CREDENTIAL_EXPOSURE_SUSPECTED",
    destructive_operation_attempt: "DESTRUCTIVE_OPERATION_ATTEMPT",
    auth_anomaly: "AUTH_ANOMALY",
    provider_security_event: "PROVIDER_SECURITY_SIGNAL",
    supply_chain_signal: "SUPPLY_CHAIN_SIGNAL"
});
const INCIDENT_SEVERITIES = Object.freeze(["warning", "high", "critical"]);
const INCIDENT_TRANSITIONS = Object.freeze({
    detected: Object.freeze(["triaged", "escalated", "false_positive"]),
    escalated: Object.freeze(["triaged", "false_positive"]),
    triaged: Object.freeze(["contained", "false_positive"]),
    contained: Object.freeze(["recovery_in_progress"]),
    recovery_in_progress: Object.freeze(["recovered"]),
    recovered: Object.freeze(["verified"]),
    verified: Object.freeze(["closed"]),
    closed: Object.freeze([]),
    false_positive: Object.freeze([])
});
const INCIDENT_ACTIONS = Object.freeze([
    "contain_session", "revoke_credential_required", "rotate_secret_required", "disable_admin_required",
    "isolate_tenant_required", "backup_verify_required", "restore_review_required",
    "provider_contact_required", "forensic_review_required"
]);
const EVIDENCE_TYPES = Object.freeze([
    "alert_reference", "audit_reference", "containment_attestation", "recovery_attestation",
    "verification_attestation", "forensic_reference"
]);
const TRANSITION_REASONS = Object.freeze({
    triaged: "INCIDENT_TRIAGED", escalated: "INCIDENT_ESCALATED", contained: "CONTAINMENT_RECORDED",
    recovery_in_progress: "RECOVERY_STARTED", recovered: "RECOVERY_RECORDED",
    verified: "VERIFICATION_RECORDED", closed: "INCIDENT_CLOSED", false_positive: "FALSE_POSITIVE_REVIEWED"
});
const AUDIT_REASONS = Object.freeze({
    "incident.created": "INCIDENT_DETECTED", "incident.alert_linked": "SOURCE_ALERT_LINKED",
    "incident.evidence_attached": "EVIDENCE_ATTACHED", "incident.action_required": "ACTION_REQUIRED",
    "incident.action_planned": "ACTION_PLANNED", "incident.action_completed": "ACTION_COMPLETION_RECORDED"
});
const EVIDENCE_REASONS = Object.freeze([...new Set([
    ...SECURITY_EVENT_REASON_CODES, ...Object.values(INCIDENT_CATEGORIES),
    ...Object.values(TRANSITION_REASONS), ...Object.values(AUDIT_REASONS)
])]);
const issuedIncidents = new WeakSet();
const issuedAudits = new WeakSet();
const optional = (value, validate) => value == null ? null : validate(value);

function normalizeIncidentMetadata(input, nowMs) {
    incidentFields(input, ["incidentId", "severity", "category", "status", "detectedAt", "updatedAt",
        "tenantId", "actorId", "correlationId", "sourceAlertIds", "owner", "summaryCode"]);
    incidentNow(nowMs);
    if (typeof input.category !== "string" || !Object.hasOwn(INCIDENT_CATEGORIES, input.category) ||
        !INCIDENT_SEVERITIES.includes(input.severity) || typeof input.status !== "string" ||
        !Object.hasOwn(INCIDENT_TRANSITIONS, input.status) || input.summaryCode !== INCIDENT_CATEGORIES[input.category]) rejectIncident();
    if (input.category === "admin_takeover" && input.severity !== "critical" ||
        ["tenant_boundary_violation", "destructive_operation_attempt"].includes(input.category) && input.severity === "warning") rejectIncident();
    if (incidentTime(input.detectedAt) > incidentTime(input.updatedAt) || incidentTime(input.updatedAt) > nowMs) rejectIncident();
    const contained = ["contained", "recovery_in_progress", "recovered", "verified", "closed"].includes(input.status);
    const recoveryStatus = input.status === "false_positive" ? "not_required" :
        ["verified", "closed"].includes(input.status) ? "verified" : input.status === "recovered" ? "recovered" :
            input.status === "recovery_in_progress" ? "in_progress" : "pending";
    const output = Object.freeze({
        incidentId: incidentId(input.incidentId), severity: input.severity, category: input.category, status: input.status,
        detectedAt: input.detectedAt, updatedAt: input.updatedAt, tenantId: incidentTenant(input.tenantId),
        actorId: optional(input.actorId, incidentId), correlationId: incidentUuid(input.correlationId),
        sourceAlertIds: incidentIds(input.sourceAlertIds), owner: incidentId(input.owner), summaryCode: input.summaryCode,
        containmentStatus: input.status === "false_positive" ? "not_required" : contained ? "contained" : "required",
        recoveryStatus
    });
    issuedIncidents.add(output);
    return output;
}

function changeIncidentMetadata(before, changes, nowMs) {
    if (!issuedIncidents.has(before)) rejectIncident();
    incidentFields(changes, ["severity", "category", "summaryCode", "status", "detectedAt", "updatedAt", "sourceAlertIds", "actorId"]);
    const { containmentStatus, recoveryStatus, ...metadata } = before;
    return normalizeIncidentMetadata({ ...metadata, ...changes }, nowMs);
}

function normalizeIncidentEvidence(input, incident, nowMs) {
    incidentFields(input, ["evidenceId", "evidenceType", "occurredAt", "requestId", "correlationId", "alertId",
        "auditEventId", "tenantId", "actorId", "operation", "reasonCode", "referenceId", "sha256"]);
    if (!issuedIncidents.has(incident)) rejectIncident();
    incidentNow(nowMs);
    if (!EVIDENCE_TYPES.includes(input.evidenceType) || !EVIDENCE_REASONS.includes(input.reasonCode) ||
        input.operation != null && !SECURITY_EVENT_OPERATIONS.includes(input.operation)) rejectIncident();
    if (incidentTenant(input.tenantId) !== incident.tenantId || incidentUuid(input.correlationId) !== incident.correlationId) rejectIncident("EVIDENCE_SCOPE_MISMATCH");
    if (incidentTime(input.occurredAt) > nowMs) rejectIncident();
    const alertId = optional(input.alertId, incidentId);
    const auditEventId = optional(input.auditEventId, incidentId);
    const referenceId = optional(input.referenceId, incidentId);
    const sha256 = input.sha256 ?? null;
    if (sha256 !== null && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256))) rejectIncident();
    if (alertId !== null && !incident.sourceAlertIds.includes(alertId)) rejectIncident("EVIDENCE_ALERT_MISMATCH");
    if (input.evidenceType === "alert_reference" ? alertId === null : input.evidenceType === "audit_reference"
        ? auditEventId === null : referenceId === null && sha256 === null) rejectIncident("EVIDENCE_REFERENCE_REQUIRED");
    return Object.freeze({
        evidenceId: incidentId(input.evidenceId), evidenceType: input.evidenceType, occurredAt: input.occurredAt,
        requestId: optional(input.requestId, incidentUuid), correlationId: input.correlationId,
        alertId, auditEventId, tenantId: input.tenantId, actorId: optional(input.actorId, incidentId),
        operation: input.operation ?? null, reasonCode: input.reasonCode, referenceId, sha256
    });
}

function createIncidentAudit(input) {
    incidentFields(input, ["before", "after", "actorId", "actionType"]);
    const { before = null, after, actorId, actionType } = input;
    if (!issuedIncidents.has(after) || before !== null && !issuedIncidents.has(before) ||
        typeof actionType !== "string") rejectIncident();
    if (before && (before.incidentId !== after.incidentId || before.tenantId !== after.tenantId)) rejectIncident("TENANT_SCOPE_MISMATCH");
    const reasonCode = actionType === "incident.transition" ? TRANSITION_REASONS[after.status]
        : Object.hasOwn(AUDIT_REASONS, actionType) ? AUDIT_REASONS[actionType] : null;
    if (!reasonCode) rejectIncident();
    const audit = Object.freeze({
        incidentId: after.incidentId, oldStatus: before?.status ?? null, newStatus: after.status,
        actorId: incidentId(actorId), tenantId: after.tenantId, reasonCode, actionType, timestamp: after.updatedAt
    });
    issuedAudits.add(audit);
    return audit;
}

function buildIncidentAuditMetadata(audit) {
    if (!issuedAudits.has(audit)) rejectIncident();
    return Object.freeze({ ...audit });
}

module.exports = {
    INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, INCIDENT_TRANSITIONS, INCIDENT_ACTIONS, EVIDENCE_TYPES,
    normalizeIncidentMetadata, changeIncidentMetadata, normalizeIncidentEvidence,
    createIncidentAudit, buildIncidentAuditMetadata
};
