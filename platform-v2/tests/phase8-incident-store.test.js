const test = require("node:test");
const assert = require("node:assert/strict");
const { createInMemoryIncidentStore } = require("../src/incidents/in-memory-incident-store");
const { incidentCandidateFromAlert } = require("../src/incidents/incident-alert-adapter");
const { INCIDENT_ACTIONS, buildIncidentAuditMetadata } = require("../src/incidents/incident-model");
const { DEFAULT_PLATFORM_INCIDENTS_CONFIG } = require("../src/config/platform-incidents-config");
const { createSecurityAlertService } = require("../src/security/security-alert-service");
const { createInMemorySecurityAlertSink } = require("../src/security/in-memory-security-alert-sink");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const CORRELATION = "12345678-1234-4234-8234-123456789012";
const OTHER_CORRELATION = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
const THIRD_CORRELATION = "abcdefab-abcd-4abc-8abc-abcdefabcdee";
const ADMIN = { role: "platform_admin", actorId: "responder-one", tenantId: "tenant-one" };
const scope = (tenantId = "tenant-one", extra = {}) => ({ context: { ...ADMIN, tenantId }, tenantId, ...extra });
const command = (incident, extra = {}) => scope(incident.tenantId, { incidentId: incident.incidentId, ...extra });
const raw = (extra = {}) => ({ category: "auth_anomaly", severity: "warning", correlationId: CORRELATION,
    owner: "security-team", actorId: "subject-one", ...extra });
const code = (fn, expected) => assert.throws(fn, error => error.code === expected);

function fixture(options = {}) {
    let now = NOW;
    return { store: createInMemoryIncidentStore({ clock: () => now, ...options }), setNow: value => { now = value; } };
}
function create(store, extra = {}, tenantId = "tenant-one") {
    return store.createIncident(scope(tenantId, { metadata: raw(extra) }));
}
function evidence(incident, evidenceType = "forensic_reference", extra = {}) {
    return { evidenceId: evidenceType, evidenceType, occurredAt: new Date(NOW).toISOString(),
        tenantId: incident.tenantId, correlationId: incident.correlationId, actorId: "reviewer-one",
        referenceId: "opaque-proof", reasonCode: "UNSPECIFIED", ...extra };
}
function attach(store, incident, evidenceType, extra = {}) {
    return store.attachEvidence(command(incident, { evidence: evidence(incident, evidenceType, extra) }));
}
function move(store, incident, toStatus, evidenceId = null, extra = {}) {
    return store.transitionIncident(command(incident, { transitionId: `move-${toStatus}`, toStatus, evidenceId, ...extra }));
}
function throughRecovery(store, incident) {
    for (const type of ["containment_attestation", "recovery_attestation", "verification_attestation"]) attach(store, incident, type);
    move(store, incident, "triaged");
    move(store, incident, "contained", "containment_attestation");
    move(store, incident, "recovery_in_progress");
    move(store, incident, "recovered", "recovery_attestation");
}
async function alert(extra = {}) {
    const service = createSecurityAlertService({ sink: createInMemorySecurityAlertSink(), clock: () => NOW });
    return service.record({ eventType: "tenant_boundary_violation", source: "security.monitor", tenantId: "tenant-one",
        actorId: "subject-one", correlationId: CORRELATION, reasonCode: "UNSPECIFIED", ...extra });
}
function fromAlert(store, alert, extra = {}) {
    return store.createIncidentFromAlert(scope(alert.tenantId, { alert, owner: "security-team", ...extra }));
}

test("valid manual incident creation is server-ID owned, immutable and auditable", () => {
    const { store } = fixture();
    const incident = create(store);
    assert.match(incident.incidentId, /^[0-9a-f-]{36}$/);
    assert.equal(incident.status, "detected");
    assert.equal(incident.summaryCode, "AUTH_ANOMALY");
    assert.equal(incident.detectedAt, new Date(NOW).toISOString());
    assert.equal(incident.updatedAt, incident.detectedAt);
    assert.equal(incident.retentionEligibleAt, null);
    assert.deepEqual(incident.sourceAlertIds, []);
    assert.deepEqual(incident.evidence, []);
    assert.deepEqual(store.getIncident(command(incident)), incident);
    assert.deepEqual(store.listIncidents(scope()), [incident]);
    assert.ok(Object.isFrozen(incident.requiredActions));
    assert.equal(store.listAudit(command(incident))[0].actorId, "responder-one");
    assert.equal(store.listAudit(command(incident))[0].reasonCode, "INCIDENT_DETECTED");
});

test("same correlation manual creation has immutable idempotent retry and conflict protection", () => {
    const { store, setNow } = fixture();
    const first = create(store);
    setNow(NOW + 1000);
    assert.equal(create(store), first);
    code(() => create(store, { owner: "different-team" }), "IDEMPOTENCY_CONFLICT");
    assert.equal(store.listIncidents(scope()).length, 1);
    assert.equal(store.listAudit(command(first)).length, 1);
});

test("Paket 2 critical takeover, high boundary and high destructive alerts map to safe candidates", async () => {
    for (const [eventType, category, severity] of [
        ["admin_takeover_confirmed", "admin_takeover", "critical"],
        ["tenant_boundary_violation", "tenant_boundary_violation", "high"],
        ["destructive_operation_attempt", "destructive_operation_attempt", "high"]
    ]) {
        const source = await alert({ eventType });
        const candidate = incidentCandidateFromAlert(source);
        assert.equal(candidate.severity, severity);
        assert.equal(candidate.category, category);
        assert.deepEqual(candidate.sourceAlertIds, [source.alertId]);
        assert.equal(candidate.correlationId, source.correlationId);
        assert.ok(Object.isFrozen(candidate));
        const { store } = fixture();
        const incident = fromAlert(store, source);
        assert.equal(incident.status, "detected");
        assert.equal(incident.category, category);
        assert.equal(incident.severity, severity);
    }
});

test("non-qualifying alerts create no incident and forged/hydrated alerts cannot claim critical severity", async () => {
    const source = await alert({ eventType: "auth_anomaly" });
    const { store } = fixture();
    assert.equal(incidentCandidateFromAlert(source), null);
    assert.equal(fromAlert(store, source), null);
    assert.equal(store.listIncidents(scope()).length, 0);
    for (const forged of [{ ...source }, { ...source, severity: "critical", eventType: "admin_takeover_confirmed" }, null]) {
        assert.throws(() => incidentCandidateFromAlert(forged), TypeError);
    }
    let reads = 0;
    assert.throws(() => incidentCandidateFromAlert({ get severity() { reads++; return "critical"; } }), TypeError);
    assert.equal(reads, 0);
});

test("updated Paket 2 aggregates and concurrent deliveries cannot multiply incidents", async () => {
    const { store } = fixture();
    let time = NOW;
    const service = createSecurityAlertService({ sink: createInMemorySecurityAlertSink(), clock: () => time });
    const event = { eventType: "tenant_boundary_violation", source: "security.monitor", tenantId: "tenant-one",
        actorId: "subject-one", correlationId: CORRELATION };
    const first = await service.record(event);
    const incident = fromAlert(store, first);
    time += 1000;
    const second = await service.record(event);
    assert.equal(second.alertId, first.alertId);
    assert.equal(second.eventCount, 2);
    const results = await Promise.all(Array.from({ length: 10 }, async () => fromAlert(store, second)));
    assert.ok(results.every(result => result.incidentId === incident.incidentId));
    assert.equal(store.listIncidents(scope()).length, 1);
    assert.equal(store.listAudit(command(incident)).length, 1);
});

test("duplicate alert and correlation bind one incident; new high-risk source promotes without losing evidence", async () => {
    const { store, setNow } = fixture();
    const boundary = await alert();
    const first = fromAlert(store, boundary);
    attach(store, first, "alert_reference", { alertId: boundary.alertId, referenceId: null });
    setNow(NOW + 1000);
    assert.equal(fromAlert(store, boundary).incidentId, first.incidentId);
    assert.equal(store.listAudit(command(first)).length, 2, "duplicate delivery adds no audit");
    const takeover = await alert({ eventType: "admin_takeover_confirmed", actorId: "subject-two" });
    const promoted = fromAlert(store, takeover);
    assert.equal(promoted.incidentId, first.incidentId);
    assert.equal(promoted.category, "admin_takeover");
    assert.equal(promoted.severity, "critical");
    assert.equal(promoted.actorId, null, "mixed subject actors are not incorrectly attributed");
    assert.deepEqual(promoted.sourceAlertIds, [boundary.alertId, takeover.alertId]);
    assert.equal(promoted.evidence.length, 1);
    assert.equal(promoted.updatedAt, new Date(NOW + 1000).toISOString());
    assert.equal(store.listIncidents(scope()).length, 1);
});

test("same correlation across tenants/platform scope never merges or leaks incident data", async () => {
    const { store } = fixture();
    const incidents = [];
    for (const tenantId of ["tenant-one", "tenant-two", null, "platform", "unknown"]) {
        incidents.push(fromAlert(store, await alert({ tenantId })));
        const list = store.listIncidents(scope(tenantId));
        assert.equal(list.length, 1);
        assert.ok(list.every(incident => incident.tenantId === tenantId));
    }
    assert.equal(new Set(incidents.map(incident => incident.incidentId)).size, incidents.length);
    const other = incidents[1];
    const otherSource = await alert({ tenantId: "tenant-two" });
    code(() => store.createIncidentFromAlert(scope("tenant-one", { alert: otherSource, owner: "security-team" })), "TENANT_SCOPE_MISMATCH");
    assert.equal(store.getIncident(command(incidents[0], { incidentId: other.incidentId })), null);
    code(() => store.transitionIncident(command(incidents[0], { incidentId: other.incidentId, transitionId: "cross", toStatus: "triaged" })), "INCIDENT_NOT_FOUND");
});

test("every read/write requires explicit matched context scope, including privileged platform callers", async () => {
    const { store } = fixture();
    const incident = create(store);
    const source = await alert();
    const wrong = command(incident, { tenantId: "tenant-two" });
    const commands = [
        () => store.getIncident(wrong), () => store.listIncidents({ context: ADMIN, tenantId: "tenant-two" }),
        () => store.listAudit(wrong),
        () => store.transitionIncident({ ...wrong, transitionId: "cross", toStatus: "triaged" }),
        () => store.attachEvidence({ ...wrong, evidence: evidence(incident) }),
        () => store.addRequiredAction({ ...wrong, actionType: "contain_session" }),
        () => store.createIncident({ context: ADMIN, tenantId: "tenant-two", metadata: raw() }),
        () => store.createIncidentFromAlert({ context: ADMIN, tenantId: "tenant-two", owner: "security-team", alert: source })
    ];
    for (const fn of commands) code(fn, "TENANT_SCOPE_MISMATCH");
    for (const tenantId of [undefined, "Tenant-One"]) assert.throws(() => store.listIncidents(scope(tenantId, { tenantId })), TypeError);
    code(() => store.createIncidentFromAlert(scope(null, { alert: source, owner: "security-team" })), "TENANT_SCOPE_MISMATCH");
    code(() => store.getIncident(command(incident, { context: { ...ADMIN, tenantId: null } })), "TENANT_SCOPE_MISMATCH");
    for (const role of ["tenant_owner", "tenant_admin"]) {
        assert.equal(store.getIncident(command(incident, { context: { ...ADMIN, role } })).incidentId, incident.incidentId);
        code(() => store.transitionIncident(command(incident, { context: { ...ADMIN, role }, transitionId: "no", toStatus: "triaged" })), "PERMISSION_DENIED");
        code(() => store.listIncidents(scope(null, { context: { ...ADMIN, tenantId: null, role } })), "PERMISSION_DENIED");
    }
    for (const role of ["staff", "viewer", undefined]) code(() => store.getIncident(command(incident, { context: { ...ADMIN, role } })), "PERMISSION_DENIED");
});

test("valid incident lifecycle records evidence-backed containment/recovery and immutable closure", () => {
    const { store, setNow } = fixture();
    const incident = create(store);
    throughRecovery(store, incident);
    assert.equal(store.getIncident(command(incident)).status, "recovered");
    move(store, incident, "verified", "verification_attestation");
    setNow(NOW + 1000);
    const closed = move(store, incident, "closed");
    assert.equal(closed.containmentStatus, "contained");
    assert.equal(closed.recoveryStatus, "verified");
    assert.equal(closed.retentionEligibleAt, new Date(NOW + 1000 + 90 * 86_400_000).toISOString());
    assert.equal(store.listAudit(command(incident)).filter(audit => audit.actionType === "incident.transition").length, 6);
    for (const toStatus of ["detected", "triaged", "escalated", "false_positive"]) code(() => move(store, incident, toStatus, null, { transitionId: "reopen" }), "INCIDENT_TERMINAL");
    code(() => attach(store, incident, "forensic_reference"), "INCIDENT_TERMINAL");
    code(() => store.addRequiredAction(command(incident, { actionType: "contain_session" })), "INCIDENT_TERMINAL");
    setNow(NOW + 100 * 86_400_000);
    assert.equal(store.getIncident(command(incident)).status, "closed", "retention metadata never runs purge");
});

test("invalid order and absent/wrong checkpoint evidence fail without state/audit changes", () => {
    const { store } = fixture();
    const incident = create(store);
    for (const toStatus of ["contained", "recovery_in_progress", "recovered", "verified", "closed", "detected", "unknown", "__proto__"]) {
        code(() => move(store, incident, toStatus), "INVALID_TRANSITION");
    }
    assert.equal(store.listAudit(command(incident)).length, 1);
    move(store, incident, "triaged");
    code(() => move(store, incident, "contained"), "TRANSITION_EVIDENCE_REQUIRED");
    attach(store, incident, "forensic_reference");
    code(() => move(store, incident, "contained", "forensic_reference"), "TRANSITION_EVIDENCE_REQUIRED");
    assert.equal(store.getIncident(command(incident)).status, "triaged");
});

test("transition retries replay historical receipts without rewinding later or closed state", () => {
    const { store, setNow } = fixture();
    const incident = create(store);
    const first = move(store, incident, "triaged");
    setNow(NOW + 1000);
    assert.equal(move(store, incident, "triaged"), first);
    code(() => move(store, incident, "contained", null, { transitionId: "move-triaged" }), "IDEMPOTENCY_CONFLICT");
    code(() => move(store, incident, "triaged", null, { context: { ...ADMIN, actorId: "other-responder" } }), "IDEMPOTENCY_CONFLICT");
    throughRecovery(store, incident);
    move(store, incident, "verified", "verification_attestation");
    const closed = move(store, incident, "closed");
    const count = store.listAudit(command(incident)).length;
    assert.equal(move(store, incident, "triaged"), first);
    assert.equal(move(store, incident, "closed"), closed);
    assert.equal(store.getIncident(command(incident)).status, "closed");
    assert.equal(store.listAudit(command(incident)).length, count);
});

test("escalated requires triage and false-positive needs a forensic reference and is terminal", () => {
    const { store } = fixture();
    const incident = create(store);
    assert.equal(move(store, incident, "escalated").severity, "critical");
    code(() => move(store, incident, "contained"), "INVALID_TRANSITION");
    move(store, incident, "triaged");
    code(() => move(store, incident, "false_positive"), "TRANSITION_EVIDENCE_REQUIRED");
    attach(store, incident, "forensic_reference");
    const terminal = move(store, incident, "false_positive", "forensic_reference");
    assert.equal(terminal.containmentStatus, "not_required");
    code(() => move(store, incident, "detected"), "INCIDENT_TERMINAL");
});

test("closed incident duplicate alerts remain linked but new same-correlation alerts never reopen", async () => {
    const { store } = fixture();
    const source = await alert();
    const incident = fromAlert(store, source);
    throughRecovery(store, incident);
    move(store, incident, "verified", "verification_attestation");
    move(store, incident, "closed");
    const count = store.listAudit(command(incident)).length;
    assert.equal(fromAlert(store, source).status, "closed");
    const takeover = await alert({ eventType: "admin_takeover_confirmed" });
    code(() => fromAlert(store, takeover), "INCIDENT_TERMINAL");
    assert.equal(store.listIncidents(scope()).length, 1);
    assert.equal(store.listAudit(command(incident)).length, count);
});

test("evidence attachments are defensive, idempotent, scope-bound and cannot be replaced", () => {
    const { store } = fixture();
    const incident = create(store);
    const input = evidence(incident);
    const result = store.attachEvidence(command(incident, { evidence: input }));
    input.referenceId = "changed-proof";
    assert.equal(store.getIncident(command(incident)).evidence[0].referenceId, "opaque-proof");
    assert.equal(attach(store, incident, "forensic_reference"), result);
    code(() => store.attachEvidence(command(incident, { evidence: input })), "IDEMPOTENCY_CONFLICT");
    code(() => attach(store, incident, "forensic_reference", { tenantId: "tenant-two" }), "EVIDENCE_SCOPE_MISMATCH");
    assert.equal(store.listAudit(command(incident)).length, 2);
});

test("required actions are finite metadata-only plans and complete only with attached evidence", () => {
    const { store } = fixture();
    const incident = create(store);
    attach(store, incident, "forensic_reference");
    for (const actionType of INCIDENT_ACTIONS) {
        const base = command(incident, { actionType });
        code(() => store.addRequiredAction({ ...base, status: "completed", evidenceId: "forensic_reference" }), "INVALID_ACTION_TRANSITION");
        const required = store.addRequiredAction(base);
        assert.equal(store.addRequiredAction(base), required);
        store.addRequiredAction({ ...base, status: "planned" });
        code(() => store.addRequiredAction({ ...base, status: "completed" }), "ACTION_EVIDENCE_REQUIRED");
        const completed = store.addRequiredAction({ ...base, status: "completed", evidenceId: "forensic_reference" });
        assert.equal(store.addRequiredAction({ ...base, status: "completed", evidenceId: "forensic_reference" }), completed);
        store.addRequiredAction(base);
        assert.equal(store.getIncident(command(incident)).requiredActions.find(action => action.actionType === actionType).status, "completed");
    }
    assert.equal(store.getIncident(command(incident)).requiredActions.length, 9);
    code(() => store.addRequiredAction(command(incident, { actionType: "firebase.disableUser" })), "INVALID_ACTION");
});

test("verification and closure fail closed while required action metadata remains incomplete", () => {
    const { store } = fixture();
    const incident = create(store);
    throughRecovery(store, incident);
    const action = command(incident, { actionType: "restore_review_required" });
    store.addRequiredAction(action);
    code(() => move(store, incident, "verified", "verification_attestation"), "REQUIRED_ACTIONS_INCOMPLETE");
    store.addRequiredAction({ ...action, status: "planned" });
    store.addRequiredAction({ ...action, status: "completed", evidenceId: "verification_attestation" });
    move(store, incident, "verified", "verification_attestation");
    store.addRequiredAction(command(incident, { actionType: "forensic_review_required" }));
    code(() => move(store, incident, "closed"), "REQUIRED_ACTIONS_INCOMPLETE");
    assert.equal(store.getIncident(command(incident)).status, "verified");
});

test("config limits fail closed without eviction; open capacity is scoped and closed records still count for storage", () => {
    const config = { ...DEFAULT_PLATFORM_INCIDENTS_CONFIG, maxOpenIncidents: 1 };
    const { store } = fixture({ config, maxRecords: 2 });
    const incident = create(store);
    code(() => create(store, { correlationId: OTHER_CORRELATION }), "OPEN_INCIDENT_CAPACITY");
    create(store, {}, "tenant-two");
    attach(store, incident, "forensic_reference");
    move(store, incident, "false_positive", "forensic_reference");
    code(() => create(store, { correlationId: THIRD_CORRELATION }), "INCIDENT_STORE_CAPACITY");
    assert.equal(store.listIncidents(scope()).length, 1);
    assert.equal(store.listIncidents(scope("tenant-two")).length, 1);
});

test("evidence budget covers explicit evidence and source-alert references atomically", async () => {
    const { store } = fixture({ config: { ...DEFAULT_PLATFORM_INCIDENTS_CONFIG, maxEvidencePerIncident: 1 } });
    const source = await alert();
    const incident = fromAlert(store, source);
    code(() => attach(store, incident, "forensic_reference"), "INCIDENT_EVIDENCE_CAPACITY");
    const takeover = await alert({ eventType: "admin_takeover_confirmed" });
    code(() => fromAlert(store, takeover), "INCIDENT_EVIDENCE_CAPACITY");
    assert.deepEqual(store.getIncident(command(incident)).sourceAlertIds, [source.alertId]);
    assert.equal(store.listAudit(command(incident)).length, 1);
});

test("store rejects unknown/getter/nested secret envelopes before mutation or audit", () => {
    const { store } = fixture();
    const incident = create(store);
    const calls = [
        ["createIncident", scope("tenant-one", { metadata: raw({ correlationId: OTHER_CORRELATION }) })],
        ["transitionIncident", command(incident, { transitionId: "triage", toStatus: "triaged" })],
        ["attachEvidence", command(incident, { evidence: evidence(incident) })],
        ["addRequiredAction", command(incident, { actionType: "contain_session" })]
    ];
    for (const [method, base] of calls) {
        for (const field of ["token", "password", "body", "email", "providerPayload"]) {
            assert.throws(() => store[method]({ ...base, [field]: { secret: "sentinel" } }), TypeError);
            let reads = 0;
            const input = { ...base };
            Object.defineProperty(input, field, { get() { reads++; throw new Error("sentinel"); } });
            assert.throws(() => store[method](input), TypeError);
            assert.equal(reads, 0);
        }
    }
    assert.throws(() => create(store, { sourceAlertIds: ["fake-alert"] }), TypeError);
    assert.throws(() => create(store, { status: "closed" }), TypeError);
    assert.equal(store.getIncident(command(incident)).status, "detected");
    assert.equal(store.listAudit(command(incident)).length, 1);
});

test("all stored audit events retain exact safe metadata and are not arbitrary writer payloads", () => {
    const { store } = fixture();
    const incident = create(store);
    throughRecovery(store, incident);
    const audits = store.listAudit(command(incident));
    for (const audit of audits) {
        const projection = buildIncidentAuditMetadata(audit);
        assert.deepEqual(Object.keys(projection).sort(), ["incidentId", "oldStatus", "newStatus", "actorId", "tenantId", "reasonCode", "actionType", "timestamp"].sort());
        assert.equal(projection.actorId, "responder-one");
        assert.ok(Object.isFrozen(projection));
        assert.ok(!JSON.stringify(projection).includes("opaque-proof"));
    }
    assert.ok(Object.isFrozen(audits));
});

test("invalid config, malicious clocks and backward clocks fail without committing provider details", () => {
    assert.throws(() => createInMemoryIncidentStore({ config: {} }), TypeError);
    for (const clock of [null, () => NaN, () => NOW.toString(), () => { throw new Error("provider-sentinel"); }]) {
        code(() => create(createInMemoryIncidentStore({ clock })), "INVALID_CLOCK");
    }
    const { store, setNow } = fixture();
    const incident = create(store);
    setNow(NOW - 1);
    code(() => move(store, incident, "triaged"), "INVALID_CLOCK");
    assert.equal(store.listAudit(command(incident)).length, 1);
    assert.equal(store.getIncident(command(incident)).status, "detected");
});
