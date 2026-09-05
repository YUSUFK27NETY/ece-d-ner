const { assertSecurityAlert } = require("../security/security-alert-model");
const { INCIDENT_CATEGORIES } = require("./incident-model");

// Only Paket 2 model-issued alerts are accepted; decoded JSON/client labels are not proof.
function incidentCandidateFromAlert(alert) {
    assertSecurityAlert(alert);
    const takeover = alert.eventType === "admin_takeover_confirmed";
    const highRisk = ["tenant_boundary_violation", "destructive_operation_attempt"].includes(alert.eventType);
    if (alert.severity !== "critical" && !(highRisk && alert.severity === "high") && !takeover) return null;
    const category = takeover ? "admin_takeover" : highRisk ? alert.eventType : "auth_anomaly";
    return Object.freeze({
        category, severity: takeover ? "critical" : alert.severity,
        summaryCode: INCIDENT_CATEGORIES[category], tenantId: alert.tenantId, actorId: alert.actorId,
        correlationId: alert.correlationId, detectedAt: alert.firstSeenAt,
        sourceAlertIds: Object.freeze([alert.alertId])
    });
}

module.exports = { incidentCandidateFromAlert };
