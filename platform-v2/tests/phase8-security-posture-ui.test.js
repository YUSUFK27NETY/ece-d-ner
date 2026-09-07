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

test("admin form contains a separate read-only security posture panel", () => {
    for (const id of [
        "security-posture-panel",
        "security-posture-message",
        "security-posture-cards"
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`));
    }
    assert.match(html, />Güvenlik Duruşu</);
    assert.ok(html.indexOf("security-alerts-panel") < html.indexOf("security-posture-panel"));
    const panel = section(html, '<fieldset id="security-posture-panel"', "</fieldset>");
    assert.doesNotMatch(panel, /<button\b/i);

    const renderer = section(js, "function renderSecurityPosture", "async function loadSecurityPosture");
    for (const title of [
        "Overall", "Identity / Step-up", "Secret Lifecycle", "Security Alerts",
        "Incidents", "Break-glass", "Supply-chain"
    ]) {
        assert.match(renderer, new RegExp(`appendSecurityPostureCard\\(["']${title.replace("/", "\\/")}`));
    }
    assert.equal((renderer.match(/appendSecurityPostureCard\(/g) || []).length, 7);
});

test("posture loader uses only the existing read endpoint", () => {
    const loader = section(js, "async function loadSecurityPosture", "async function loadOverview");

    assert.match(loader, /apiRequest\(["']\/api\/platform\/security-posture["']\)/);
    assert.equal((js.match(/\/api\/platform\/security-posture/g) || []).length, 1);
    assert.doesNotMatch(loader, /method\s*:|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b/i);
    assert.doesNotMatch(loader, /rotate|revoke|activate|approve|resolve|acknowledge|trigger|deploy/i);
});

test("security posture rendering uses safe DOM primitives without HTML interpolation", () => {
    assert.doesNotMatch(js, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    const renderer = section(
        js,
        "function appendSecurityPostureCard",
        "async function loadSecurityPosture"
    );
    assert.match(renderer, /document\.createElement/);
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /\.replaceChildren\(\)/);
    assert.match(renderer, /\.append\(/);
    assert.doesNotMatch(renderer, /JSON\.stringify|`<|<article|<div/);
});

test("source-state and overall mappings are explicit and never become raw CSS classes", () => {
    const mappings = section(
        js,
        "const SECURITY_POSTURE_SOURCE_PRESENTATION",
        "function setMessage"
    );
    for (const [state, label] of [
        ["active", "Aktif"],
        ["durable_runtime", "Aktif / kalıcı runtime"],
        ["contract_only", "Contract hazır"],
        ["not_wired", "Runtime'a bağlı değil"],
        ["external_verification_required", "Harici doğrulama gerekli"],
        ["unavailable", "Kullanılamıyor"]
    ]) {
        assert.match(mappings, new RegExp(`${state}:.*label: ["']${label.replace("/", "\\/")}["']`));
    }
    assert.match(mappings, /partial_visibility:.*label: "Kısmi görünürlük"/);
    assert.match(mappings, /degraded:.*label: "Azalmış görünürlük"/);
    assert.match(mappings, /healthy:.*label: "Sağlıklı"/);
    assert.match(mappings, /unknown:.*label: "Bilinmiyor"/);
    assert.doesNotMatch(js, /classList\.add\([^)]*(?:sourceState|overallStatus)/);
    assert.doesNotMatch(js, /posture-(?:state|status)-\$\{/);
});

test("display projector reads only explicit posture metadata and ignores unknown fields", () => {
    const projector = section(
        js,
        "function projectSecurityPostureForDisplay",
        "function appendSecurityPostureCard"
    );
    for (const field of [
        "schemaVersion", "generatedAt", "overallStatus", "identity", "secrets",
        "alerts", "incidents", "breakGlass", "supplyChain",
        "contractStatus", "runtimeEnforcement", "elevatedSessionStatus",
        "mfaReadiness", "enrollmentStatus", "elevatedSessionTtlMs",
        "requiredFactorTypeCount", "count", "overdue", "recentVisibleCount",
        "highestSeverity", "lastSeenAt", "openCount", "criticalCount",
        "activeSessions", "recentUsageCount", "sbomBaseline", "codeqlBaseline",
        "liveWorkflowStatus"
    ]) {
        assert.match(projector, new RegExp(`["']${field}["']`), field);
    }
    assert.match(projector, /projectSourceState\((?:identity|secrets|alerts|incidents|breakGlass|supplyChain)\)/);
    assert.doesNotMatch(
        projector,
        /["'](?:token|authorization|body|secretValue|credential|email|phone|ip|providerPayload|claims|environment)["']/i
    );
    assert.doesNotMatch(projector, /JSON\.stringify|Object\.entries|Object\.keys|\.\.\./);
    assert.match(projector, /return null/);
});

test("null counters remain unavailable and are never coerced to fake zero", () => {
    const countProjector = section(
        js,
        "function projectPostureCount",
        "function projectPostureTimestamp"
    );
    const projector = section(
        js,
        "function projectSecurityPostureForDisplay",
        "function appendSecurityPostureCard"
    );

    assert.match(countProjector, /source\.isActive/);
    assert.match(countProjector, /Number\.isSafeInteger/);
    assert.match(countProjector, /: null/);
    assert.doesNotMatch(countProjector, /Number\(|\|\|\s*0|\?\?\s*0/);
    assert.match(projector, /Ölçüm kaynağı bağlı değil/);
    assert.match(projector, /Canlı incident kaynağı bağlı değil/);
    assert.match(projector, /Canlı break-glass kaynağı bağlı değil/);
    assert.doesNotMatch(projector, /0 secret|0 overdue|0 incident|0 aktif oturum/i);
});

test("alerts summary is recent-visible, not a total alert claim", () => {
    const projector = section(
        js,
        "function projectSecurityPostureForDisplay",
        "function appendSecurityPostureCard"
    );

    assert.match(projector, /Son görünür uyarılar:/);
    assert.match(projector, /highestSeverity/);
    assert.match(projector, /lastSeenAt/);
    assert.doesNotMatch(projector, /Toplam (?:uyarı|alert)|total alerts?/i);
});

test("identity and supply-chain keep contract, enrollment and live status separate", () => {
    const projector = section(
        js,
        "function projectSecurityPostureForDisplay",
        "function appendSecurityPostureCard"
    );

    for (const label of [
        "Step-up contract", "Runtime enforcement", "Elevated session",
        "MFA readiness", "Enrollment", "SBOM", "CodeQL", "Canlı workflow"
    ]) {
        assert.match(projector, new RegExp(label));
    }
    assert.doesNotMatch(projector, /MFA enabled|Passkey enabled|CodeQL green|live-green/i);
});

test("posture loading is stale-safe and errors never render raw messages", () => {
    const loader = section(js, "async function loadSecurityPosture", "async function loadOverview");

    assert.match(loader, /\+\+state\.securityPostureRequestVersion/);
    assert.match(loader, /requestVersion !== state\.securityPostureRequestVersion/);
    assert.match(loader, /Güvenlik duruşu yükleniyor\.\.\./);
    assert.match(loader, /Güvenlik duruşu kullanılamıyor\./);
    assert.match(loader, /Güvenlik duruşu yüklenemedi\./);
    assert.doesNotMatch(loader, /error\.message|response\.message/);
});

test("panel visibility and global refresh preserve one posture reload path", () => {
    const createMode = section(js, "function showCreateForm", "function showTenant");
    const editMode = section(js, "function showTenant", "function showEmpty");
    const emptyMode = section(js, "function showEmpty", "function renderTenantList");

    assert.match(createMode, /securityPosturePanel\.classList\.add\("hidden"\)/);
    assert.match(emptyMode, /securityPosturePanel\.classList\.add\("hidden"\)/);
    assert.match(editMode, /securityPosturePanel\.classList\.remove\("hidden"\)/);
    assert.match(editMode, /loadSecurityPosture\(\)/);
    assert.equal((js.match(/loadSecurityPosture\(/g) || []).length, 2);
    assert.match(js, /refreshButton\.addEventListener\("click", loadTenants\)/);
    const loadTenants = section(js, "async function loadTenants", "async function saveTenant");
    assert.match(loadTenants, /showTenant\(selected\)/);
    assert.doesNotMatch(loadTenants, /loadSecurityPosture\(/);
});

test("posture layout keeps three desktop columns and one mobile column", () => {
    assert.match(css, /\.security-posture-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.security-posture-grid[^}]*grid-template-columns:\s*1fr/);
    for (const className of [
        "security-posture-card", "posture-state", "posture-state-active",
        "posture-state-contract", "posture-state-not-wired",
        "posture-state-external", "posture-state-unavailable",
        "posture-status-partial", "posture-status-degraded"
    ]) {
        assert.match(css, new RegExp(`\\.${className}\\b`));
    }
});
