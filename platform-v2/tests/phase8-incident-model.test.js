const test = require("node:test");
const assert = require("node:assert/strict");
const {
    INCIDENT_CATEGORIES, normalizeIncidentMetadata, normalizeIncidentEvidence,
    createIncidentAudit, buildIncidentAuditMetadata, changeIncidentMetadata
} = require("../src/incidents/incident-model");
const { incidentIds } = require("../src/incidents/incident-contract");
const { DEFAULT_PLATFORM_INCIDENTS_CONFIG, normalizePlatformIncidentsConfig } = require("../src/config/platform-incidents-config");
const { DEFAULT_PLATFORM_GUARDRAILS_CONFIG, loadPlatformGuardrailsConfig, normalizePlatformGuardrailsConfig } = require("../src/config/platform-guardrails-config");

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const AT = new Date(NOW).toISOString();
const CORRELATION = "12345678-1234-4234-8234-123456789012";
const FORBIDDEN = ["body", "rawRequest", "token", "cookie", "authorization", "password", "privateKey", "secret",
    "credentialJson", "providerPayload", "email", "phone", "message", "error", "metadata", "__proto__", "constructor", "prototype"];

function metadata(extra = {}) {
    return { incidentId: "incident-one", severity: "high", category: "tenant_boundary_violation", status: "detected",
        detectedAt: AT, updatedAt: AT, tenantId: "tenant-one", actorId: "subject-one", correlationId: CORRELATION,
        sourceAlertIds: ["alert-one"], owner: "team-security", summaryCode: "TENANT_BOUNDARY_VIOLATION", ...extra };
}
function record(extra = {}) { return normalizeIncidentMetadata(metadata(extra), NOW); }
function evidence(extra = {}) {
    return { evidenceId: "proof-one", evidenceType: "forensic_reference", occurredAt: AT, tenantId: "tenant-one",
        correlationId: CORRELATION, reasonCode: "TENANT_BOUNDARY_VIOLATION", referenceId: "opaque-pointer", ...extra };
}
function denied(call, code) {
    assert.throws(call, error => {
        assert.ok(error instanceof TypeError);
        if (code) assert.equal(error.code, code);
        assert.ok(!String(error).includes("sentinel"));
        return true;
    });
}

test("incident model has an immutable exact metadata projection with derived status fields", () => {
    const input = metadata();
    const incident = normalizeIncidentMetadata(input, NOW);
    assert.deepEqual(Object.keys(incident).sort(), [...Object.keys(input), "containmentStatus", "recoveryStatus"].sort());
    input.sourceAlertIds.push("injected");
    assert.deepEqual(incident.sourceAlertIds, ["alert-one"]);
    assert.ok(Object.isFrozen(incident));
    assert.ok(Object.isFrozen(incident.sourceAlertIds));
    assert.equal(incident.containmentStatus, "required");
    assert.equal(incident.recoveryStatus, "pending");
    for (const [status, containment, recovery] of [
        ["contained", "contained", "pending"], ["recovery_in_progress", "contained", "in_progress"],
        ["recovered", "contained", "recovered"], ["verified", "contained", "verified"],
        ["closed", "contained", "verified"], ["false_positive", "not_required", "not_required"]
    ]) {
        const value = record({ status });
        assert.equal(value.containmentStatus, containment);
        assert.equal(value.recoveryStatus, recovery);
    }
});

test("server category, severity and summary allowlists reject free text and unsafe downgrades", () => {
    for (const [category, summaryCode] of Object.entries(INCIDENT_CATEGORIES)) {
        assert.equal(record({ category, summaryCode, severity: "critical" }).category, category);
    }
    for (const extra of [{ category: "other" }, { category: "__proto__" }, { status: "reopened" }, { status: "constructor" },
        { summaryCode: "sentinel" }, { severity: "info" }, { severity: "warning" },
        { category: "admin_takeover", summaryCode: "ADMIN_TAKEOVER_CONFIRMED", severity: "high" }]) denied(() => record(extra));
});

test("incident identifiers reject PII, object coercion, paths and missing tenant scope", () => {
    for (const field of ["incidentId", "owner", "actorId", "tenantId", "correlationId"]) {
        for (const value of ["user@example.test", "5551234567", "+905551234567", "sentinel text", "https://example.test/path", {}]) {
            denied(() => record({ [field]: value }));
        }
    }
    denied(() => record({ tenantId: undefined }));
    denied(() => record({ tenantId: "Tenant-One" }));
    assert.equal(record({ tenantId: null, actorId: null }).tenantId, null);
});

test("incident timestamps and identity changes fail closed", () => {
    for (const detectedAt of ["2026-02-30T00:00:00.000Z", NOW, "2026-09-05", new Date(NOW + 1).toISOString()]) {
        denied(() => record({ detectedAt }));
    }
    denied(() => record({ updatedAt: new Date(NOW - 1).toISOString() }));
    denied(() => normalizeIncidentMetadata(metadata(), NaN), "INVALID_CLOCK");
    denied(() => changeIncidentMetadata(record(), { tenantId: "tenant-two" }, NOW));
    denied(() => changeIncidentMetadata({ ...record() }, {}, NOW));
});

test("metadata rejects secret fields, allowed-field getters, symbols and nested payloads without reading them", () => {
    for (const field of [...FORBIDDEN, ...Object.keys(metadata())]) {
        let reads = 0;
        const input = metadata();
        Object.defineProperty(input, field, { enumerable: true, get() { reads++; throw new Error("sentinel"); } });
        denied(() => normalizeIncidentMetadata(input, NOW));
        assert.equal(reads, 0, field);
    }
    for (const field of Object.keys(metadata())) {
        let reads = 0;
        const nested = { secret: "sentinel", toString() { reads++; return "sentinel"; } };
        denied(() => record({ [field]: nested }));
        assert.equal(reads, 0, field);
    }
    for (const input of [null, [], Object.assign(Object.create(null), metadata()),
        Object.assign(Object.create({ secret: "sentinel" }), metadata()), { ...metadata(), [Symbol("secret")]: "sentinel" }]) {
        denied(() => normalizeIncidentMetadata(input, NOW));
    }
});

test("source alert arrays reject accessors, sparse/extra/symbol properties, duplicates and nested values", () => {
    const extra = ["alert-one"];
    extra.secret = "sentinel";
    const symbol = ["alert-one"];
    symbol[Symbol("extra")] = "sentinel";
    let reads = 0;
    const getter = [];
    Object.defineProperty(getter, "0", { get() { reads++; return "sentinel"; } });
    for (const sourceAlertIds of [extra, symbol, getter, new Array(1), ["one", "one"], [{}], "one"]) denied(() => record({ sourceAlertIds }));
    denied(() => incidentIds(["one", "two"], 1));
    assert.equal(reads, 0);
});

test("evidence accepts only immutable safe reference metadata and canonical optional IDs", () => {
    const output = normalizeIncidentEvidence(evidence({ requestId: CORRELATION, actorId: "actor-one", operation: "tenant.read",
        auditEventId: "audit-one", sha256: "a".repeat(64) }), record(), NOW);
    assert.ok(Object.isFrozen(output));
    assert.deepEqual(Object.keys(output).sort(), ["evidenceId", "evidenceType", "occurredAt", "requestId", "correlationId",
        "alertId", "auditEventId", "tenantId", "actorId", "operation", "reasonCode", "referenceId", "sha256"].sort());
    assert.equal(output.sha256, "a".repeat(64));
    assert.equal(normalizeIncidentEvidence(evidence({ evidenceType: "alert_reference", alertId: "alert-one", referenceId: null }), record(), NOW).alertId, "alert-one");
    assert.equal(normalizeIncidentEvidence(evidence({ evidenceType: "audit_reference", auditEventId: "audit-one", referenceId: null }), record(), NOW).auditEventId, "audit-one");
});

test("evidence rejects secret/body/token/PII fields instead of storing them", () => {
    for (const field of FORBIDDEN) {
        denied(() => normalizeIncidentEvidence(evidence({ [field]: "sentinel" }), record(), NOW));
    }
    for (const field of ["actorId", "referenceId", "auditEventId", "evidenceId", "requestId", "correlationId"]) {
        for (const value of ["user@example.test", "5551234567", "Bearer sentinel", "https://example.test/raw", { token: "sentinel" }]) {
            denied(() => normalizeIncidentEvidence(evidence({ [field]: value }), record(), NOW));
        }
    }
    for (const extra of [{ reasonCode: "sentinel" }, { operation: "sentinel" }, { evidenceType: "raw_request" },
        { sha256: "sentinel" }, { referenceId: null }, { evidenceType: "alert_reference" }, { evidenceType: "audit_reference" }]) {
        denied(() => normalizeIncidentEvidence(evidence(extra), record(), NOW));
    }
});

test("evidence is bound to exact incident tenant/correlation and registered alert IDs", () => {
    for (const extra of [{ tenantId: "tenant-two" }, { tenantId: null }, { tenantId: undefined },
        { correlationId: "abcdefab-abcd-4abc-8abc-abcdefabcdef" }, { alertId: "unlinked-alert" },
        { occurredAt: new Date(NOW + 1).toISOString() }]) denied(() => normalizeIncidentEvidence(evidence(extra), record(), NOW));
});

test("all evidence property getters and arbitrary nested allowed fields reject without coercion", () => {
    for (const field of [...Object.keys(evidence()), "operation", "sha256", "actorId", "requestId", "alertId", "auditEventId", ...FORBIDDEN]) {
        let reads = 0;
        const input = evidence();
        Object.defineProperty(input, field, { get() { reads++; throw new Error("sentinel"); } });
        denied(() => normalizeIncidentEvidence(input, record(), NOW));
        const nested = { get toString() { reads++; return () => "sentinel"; } };
        denied(() => normalizeIncidentEvidence(evidence({ [field]: nested }), record(), NOW));
        assert.equal(reads, 0, field);
    }
});

test("audit is a model-issued exact allowlist with fixed action/reason and writer actor", () => {
    const before = record();
    const after = changeIncidentMetadata(before, { status: "triaged" }, NOW);
    const audit = createIncidentAudit({ before, after, actorId: "responder-one", actionType: "incident.transition" });
    assert.deepEqual(buildIncidentAuditMetadata(audit), {
        incidentId: "incident-one", oldStatus: "detected", newStatus: "triaged", actorId: "responder-one",
        tenantId: "tenant-one", reasonCode: "INCIDENT_TRIAGED", actionType: "incident.transition", timestamp: AT
    });
    assert.ok(Object.isFrozen(audit));
    assert.ok(!JSON.stringify(audit).includes("subject-one"));
    denied(() => buildIncidentAuditMetadata({ ...audit }));
    denied(() => createIncidentAudit({ before, after: record({ tenantId: null }), actorId: "responder-one", actionType: "incident.created" }));
    denied(() => createIncidentAudit({ after: { ...after }, actorId: "responder-one", actionType: "incident.created" }));
    let reads = 0;
    const actionType = { get toString() { reads++; return () => "incident.created"; } };
    denied(() => createIncidentAudit({ after, actorId: "responder-one", actionType }));
    for (const field of [...FORBIDDEN, "before", "after", "actorId", "actionType"]) {
        const input = { after, actorId: "responder-one", actionType: "incident.created" };
        Object.defineProperty(input, field, { get() { reads++; throw new Error("sentinel"); } });
        denied(() => createIncidentAudit(input));
    }
    assert.equal(reads, 0);
});

test("incident config defaults integrate centrally without changing Paket 1/2/3 policy", () => {
    const expected = { maxOpenIncidents: 1000, maxEvidencePerIncident: 100, incidentRetentionDays: 90 };
    assert.deepEqual(normalizePlatformIncidentsConfig(), expected);
    assert.ok(Object.isFrozen(DEFAULT_PLATFORM_INCIDENTS_CONFIG));
    assert.ok(Object.isFrozen(normalizePlatformIncidentsConfig()));
    assert.deepEqual(loadPlatformGuardrailsConfig("").security.incidents, expected);
    const legacy = structuredClone(DEFAULT_PLATFORM_GUARDRAILS_CONFIG);
    delete legacy.security.incidents;
    const normalized = normalizePlatformGuardrailsConfig(legacy);
    assert.deepEqual(normalized.security.incidents, expected);
    for (const field of ["stepUp", "alerts", "secretLifecycle"]) assert.deepEqual(normalized.security[field], legacy.security[field]);
    assert.equal(loadPlatformGuardrailsConfig(JSON.stringify({ security: { incidents: { maxOpenIncidents: 2 } } })).security.incidents.maxOpenIncidents, 2);
});

test("incident config rejects malformed, coerced, out-of-range and secret-bearing values", () => {
    for (const field of Object.keys(DEFAULT_PLATFORM_INCIDENTS_CONFIG)) {
        for (const value of [0, -1, 0.5, "10", null, NaN, Infinity, true, 100_001, {}]) {
            denied(() => normalizePlatformIncidentsConfig({ ...DEFAULT_PLATFORM_INCIDENTS_CONFIG, [field]: value }));
        }
        let reads = 0;
        const config = { ...DEFAULT_PLATFORM_INCIDENTS_CONFIG };
        Object.defineProperty(config, field, { get() { reads++; return 1; } });
        denied(() => normalizePlatformIncidentsConfig(config));
        assert.equal(reads, 0);
    }
    for (const config of [{}, null, { ...DEFAULT_PLATFORM_INCIDENTS_CONFIG, token: "sentinel" }]) denied(() => normalizePlatformIncidentsConfig(config));
    denied(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { incidents: { maxOpenIncidents: 0 } } })));
    denied(() => loadPlatformGuardrailsConfig(JSON.stringify({ security: { incidents: { token: "sentinel" } } })));
});
