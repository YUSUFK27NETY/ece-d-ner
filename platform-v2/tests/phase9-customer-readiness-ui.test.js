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

test("admin form selected tenant için ayrı read-only Müşteri Hazırlığı paneli içerir", () => {
    for (const id of [
        "customer-readiness-panel",
        "customer-readiness-message",
        "customer-readiness-overall",
        "customer-readiness-can-activate",
        "customer-readiness-lifecycle",
        "customer-readiness-evaluated-at",
        "customer-readiness-cards"
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`), id);
    }
    assert.match(html, />Müşteri Hazırlığı</);
    const panel = section(html, '<fieldset id="customer-readiness-panel"', "</fieldset>");
    assert.doesNotMatch(panel, /<button\b/i);
    assert.doesNotMatch(panel, /dns|invite|provider|delete|sil|davet/i);
});

test("readiness source allowlist yedi güvenli kart başlığını sabitler", () => {
    const mappings = section(
        js,
        "const CUSTOMER_READINESS_STATUS_PRESENTATION",
        "function setMessage"
    );
    for (const title of [
        "Profile", "Health", "Plan", "Tenant Admin Bootstrap",
        "Backup/DR", "Security", "Domain"
    ]) {
        assert.match(mappings, new RegExp(`title: ["']${title.replace("/", "\\/")}["']`));
    }
    for (const [status, label] of [
        ["ready", "Hazır"],
        ["pending", "Bekliyor"],
        ["blocked", "Engelli"],
        ["unavailable", "Kullanılamıyor"]
    ]) {
        assert.match(mappings, new RegExp(`${status}:.*label: ["']${label}["']`));
    }
});

test("UI fixed projector hostile alanları okumaz ve tutarsız ready sonucunu reddeder", () => {
    const projector = section(
        js,
        "function isPlainReadinessRecord",
        "function resetCustomerReadiness"
    );
    for (const field of [
        "tenantId", "lifecycleStatus", "activationReadiness", "canActivate",
        "checks", "evaluatedAt", "status", "code", "observedAt"
    ]) {
        assert.match(projector, new RegExp(`["']${field}["']`), field);
    }
    assert.match(projector, /aggregateReadinessChecks\(checks\)/);
    assert.match(projector, /canActivate !== expectedCanActivate/);
    assert.match(projector, /return null/);
    assert.doesNotMatch(
        projector,
        /["'](?:token|password|credential|secret|body|email|phone|pii|providerPayload)["']/i
    );
    assert.doesNotMatch(projector, /JSON\.stringify|\.\.\.|innerHTML/);
});

test("readiness renderer yalnız güvenli DOM ve class allowlist kullanır", () => {
    assert.doesNotMatch(js, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    const renderer = section(
        js,
        "function resetCustomerReadiness",
        "async function loadCustomerReadiness"
    );
    assert.match(renderer, /document\.createElement/);
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /\.replaceChildren\(\)/);
    assert.match(renderer, /\.append\(/);
    assert.match(renderer, /classList\.add\(check\.presentation\.className\)/);
    assert.doesNotMatch(renderer, /`<|<article|<div|JSON\.stringify/);
});

test("readiness loader yalnız exact selected tenant GET endpointini çağırır ve stale-safe kalır", () => {
    const loader = section(js, "async function loadCustomerReadiness", "function renderOverview");

    assert.match(loader, /\+\+state\.customerReadinessRequestVersion/);
    assert.match(loader, /state\.selectedTenantId !== tenantId/);
    assert.match(loader, /requestVersion !== state\.customerReadinessRequestVersion/);
    assert.match(loader, /encodeURIComponent\(tenantId\).*\/readiness/s);
    assert.doesNotMatch(loader, /method\s*:|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b/i);
    assert.doesNotMatch(loader, /error\.message|response\.message/);
    assert.equal((js.match(/\/readiness/g) || []).length, 1);
});

test("malformed readiness güvenli hata durumuna düşer ve raw response render edilmez", () => {
    const loader = section(js, "async function loadCustomerReadiness", "function renderOverview");

    assert.match(loader, /Müşteri hazırlığı kullanılamıyor\./);
    assert.match(loader, /Müşteri hazırlığı yüklenemedi\./);
    assert.match(loader, /resetCustomerReadiness\(\)/);
    assert.doesNotMatch(loader, /response\?\.readiness\?\.|Object\.assign|textContent\s*=\s*response/);
});

test("panel yalnız edit modunda görünür ve tenant değişimlerinde istek geçersizleşir", () => {
    const createMode = section(js, "function showCreateForm", "function showTenant");
    const editMode = section(js, "function showTenant", "function showEmpty");
    const emptyMode = section(js, "function showEmpty", "function renderTenantList");

    assert.match(createMode, /customerReadinessPanel\.classList\.add\("hidden"\)/);
    assert.match(emptyMode, /customerReadinessPanel\.classList\.add\("hidden"\)/);
    assert.match(editMode, /customerReadinessPanel\.classList\.remove\("hidden"\)/);
    assert.match(editMode, /loadCustomerReadiness\(tenant\.tenantId\)/);
    assert.match(createMode, /customerReadinessRequestVersion \+= 1/);
    assert.match(emptyMode, /customerReadinessRequestVersion \+= 1/);
});

test("readiness durumları desktop ve mobile görünümde görsel olarak ayrıdır", () => {
    for (const className of [
        "customer-readiness-summary",
        "customer-readiness-grid",
        "customer-readiness-card",
        "readiness-state-ready",
        "readiness-state-pending",
        "readiness-state-blocked",
        "readiness-state-unavailable"
    ]) {
        assert.match(css, new RegExp(`\\.${className}\\b`), className);
    }
    assert.match(css, /\.customer-readiness-grid\s*\{[^}]*repeat\(3,/s);
    assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.customer-readiness-grid[^}]*grid-template-columns:\s*1fr/);
});
