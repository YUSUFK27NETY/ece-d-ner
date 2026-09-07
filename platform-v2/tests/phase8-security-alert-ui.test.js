const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "../public/admin");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "admin.js"), "utf8");
const css = fs.readFileSync(path.join(root, "admin.css"), "utf8");

function section(source, startMarker, endMarker) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0, `missing marker: ${startMarker}`);
    assert.ok(end > start, `missing marker: ${endMarker}`);
    return source.slice(start, end);
}

test("admin form contains separate read-only tenant and platform alert regions", () => {
    for (const id of [
        "security-alerts-panel",
        "tenant-security-alerts",
        "tenant-security-alerts-message",
        "platform-security-alerts",
        "platform-security-alerts-message"
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, />Güvenlik Uyarıları</);
    assert.match(html, />Seçili Tenant</);
    assert.match(html, />Platform</);
    assert.ok(html.indexOf("operations-panel") < html.indexOf("security-alerts-panel"));

    const panel = section(html, '<fieldset id="security-alerts-panel"', "</fieldset>");
    assert.doesNotMatch(panel, /<button\b/i);
});

test("admin loads only the two Paket 6B-3A read endpoints", () => {
    assert.match(
        js,
        /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenantId\)\}\/security-alerts\?limit=20/
    );
    assert.match(js, /\/api\/platform\/security-alerts\?limit=20/);
    assert.equal((js.match(/security-alerts\?limit=20/g) || []).length, 2);

    const tenantLoader = section(
        js,
        "async function loadTenantSecurityAlerts",
        "async function loadPlatformSecurityAlerts"
    );
    const platformLoader = section(
        js,
        "async function loadPlatformSecurityAlerts",
        "function renderOverview"
    );
    for (const loader of [tenantLoader, platformLoader]) {
        assert.doesNotMatch(loader, /method\s*:|\bPOST\b|\bPATCH\b|\bDELETE\b/i);
        assert.doesNotMatch(loader, /acknowledge|resolve|revoke|disable|incident/i);
    }
});

test("security alerts use safe DOM construction without HTML interpolation", () => {
    assert.doesNotMatch(js, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    const renderer = section(
        js,
        "function appendAlertMeta",
        "async function loadTenantSecurityAlerts"
    );
    assert.match(renderer, /document\.createElement/);
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /\.replaceChildren\(\)/);
    assert.match(renderer, /\.append\(/);
    assert.doesNotMatch(renderer, /JSON\.stringify|`<|<article|<div/);
});

test("display projector reads only explicit alert display fields", () => {
    const projector = section(
        js,
        "function projectAlertForDisplay",
        "function appendAlertMeta"
    );
    for (const field of [
        "severity", "eventType", "reasonCode", "operation", "eventCount",
        "firstSeenAt", "lastSeenAt", "correlationId", "actorId", "source"
    ]) {
        assert.match(projector, new RegExp(`alert\\.${field}\\b`));
    }
    assert.doesNotMatch(
        projector,
        /alert\.(?:token|authorization|body|secret|credential|email|phone|ip|providerPayload|dedupeKey)\b/i
    );
    assert.match(projector, /return null/);
    assert.doesNotMatch(projector, /JSON\.stringify|Object\.entries|Object\.keys/);
});

test("severity classes come from an explicit allowlist with unknown fallback", () => {
    const mapping = section(js, "const ALERT_SEVERITY_PRESENTATION", "function setMessage");
    for (const [severity, className] of [
        ["info", "severity-info"],
        ["warning", "severity-warning"],
        ["high", "severity-high"],
        ["critical", "severity-critical"]
    ]) {
        assert.match(mapping, new RegExp(`${severity}:.*${className}`));
        assert.match(css, new RegExp(`\\.${className}\\b`));
    }
    assert.match(js, /label: "unknown", className: "severity-unknown"/);
    assert.match(css, /\.severity-unknown\b/);
    assert.doesNotMatch(js, /severity-\$\{|classList\.add\(alert\.severityLabel\)/);
});

test("tenant alert response is guarded against selection and refresh races", () => {
    const loader = section(
        js,
        "async function loadTenantSecurityAlerts",
        "async function loadPlatformSecurityAlerts"
    );
    assert.match(loader, /if \(state\.selectedTenantId !== tenantId\) return;/);
    assert.match(loader, /\+\+state\.tenantAlertRequestVersion/);
    assert.match(loader, /requestVersion !== state\.tenantAlertRequestVersion/);
    assert.doesNotMatch(loader, /error\.message/);

    const platformLoader = section(
        js,
        "async function loadPlatformSecurityAlerts",
        "function renderOverview"
    );
    assert.match(platformLoader, /\+\+state\.platformAlertRequestVersion/);
    assert.match(platformLoader, /requestVersion !== state\.platformAlertRequestVersion/);
    assert.doesNotMatch(platformLoader, /error\.message/);
    assert.match(platformLoader, /Güvenlik uyarıları yüklenemedi\./);
});

test("security panel visibility follows create, edit and empty modes", () => {
    const createMode = section(js, "function showCreateForm", "function showTenant");
    const editMode = section(js, "function showTenant", "function showEmpty");
    const emptyMode = section(js, "function showEmpty", "function renderTenantList");

    assert.match(createMode, /securityAlertsPanel\.classList\.add\("hidden"\)/);
    assert.match(emptyMode, /securityAlertsPanel\.classList\.add\("hidden"\)/);
    assert.match(editMode, /securityAlertsPanel\.classList\.remove\("hidden"\)/);
    assert.match(editMode, /loadTenantSecurityAlerts\(tenant\.tenantId\)/);
    assert.match(editMode, /loadPlatformSecurityAlerts\(\)/);
    assert.equal((js.match(/loadTenantSecurityAlerts\(/g) || []).length, 2);
    assert.equal((js.match(/loadPlatformSecurityAlerts\(/g) || []).length, 2);
});

test("security alert layout retains two desktop scopes and one mobile column", () => {
    assert.match(css, /\.security-alert-sections\s*\{[^}]*grid-template-columns:\s*repeat\(2,/s);
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.security-alert-sections[^}]*grid-template-columns:\s*1fr/);
    for (const className of [
        "security-alert-list", "security-alert-card", "security-alert-header",
        "security-alert-meta", "security-alert-badge"
    ]) {
        assert.match(css, new RegExp(`\\.${className}\\b`));
    }
});
