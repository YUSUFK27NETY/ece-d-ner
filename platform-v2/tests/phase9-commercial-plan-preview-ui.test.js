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

test("selected tenant için additive salt-okunur Plan Önizleme paneli bulunur", () => {
    for (const id of [
        "plan-preview-panel",
        "plan-preview-message",
        "plan-preview-target",
        "plan-preview-current",
        "plan-preview-current-policy",
        "plan-preview-requested",
        "plan-preview-automatic-apply",
        "plan-preview-feature-summary",
        "plan-preview-features",
        "plan-preview-limits"
    ]) {
        assert.match(html, new RegExp(`id=["']${id}["']`), id);
    }
    const panel = section(
        html,
        '<fieldset id="plan-preview-panel"',
        "</fieldset>"
    );
    assert.match(panel, />Plan Önizleme</);
    assert.doesNotMatch(panel, /<button\b/i);
    assert.doesNotMatch(panel, /value=["'](?:starter|growth|pro)["']/i);
});

test("preview feature ve change sunum allowlistleri sabittir", () => {
    const mappings = section(
        js,
        "const PLAN_PREVIEW_FEATURES",
        "function setMessage"
    );
    for (const feature of [
        "catalog", "orders", "appointments", "reservations", "whatsapp",
        "inventory", "quotes", "fleet", "gallery"
    ]) {
        assert.match(mappings, new RegExp(`${feature}:`), feature);
    }
    for (const [change, label] of [
        ["gained", "Kazanım"],
        ["lost", "Kayıp"],
        ["unchanged", "Değişmedi"]
    ]) {
        assert.match(
            mappings,
            new RegExp(`${change}:.*label: ["']${label}["']`)
        );
    }
});

test("UI projector yalnız fixed preview alanlarını okur ve tutarsız diff'i reddeder", () => {
    const projector = section(
        js,
        "function isPlainPlanPreviewRecord",
        "function resetCommercialPlanPreview"
    );
    for (const field of [
        "schemaVersion", "planIds", "tenantId", "currentPlan", "targetPlan",
        "currentPlanConfigured", "currentUsesDefaultPolicyFallback",
        "automaticApply", "features", "limits", "feature", "tenantEnabled",
        "currentPlanAllowed", "targetPlanAllowed", "currentEffective",
        "targetEffective", "change", "current", "target"
    ]) {
        assert.match(projector, new RegExp(`["']${field}["']`), field);
    }
    assert.match(projector, /currentEffective !== \(tenantEnabled && currentPlanAllowed\)/);
    assert.match(projector, /targetEffective !== \(tenantEnabled && targetPlanAllowed\)/);
    assert.match(projector, /automaticApply !== false/);
    assert.match(projector, /currentPlanConfigured !== configuredPlanIds\.includes\(currentPlan\)/);
    assert.match(projector, /return null/);
    assert.doesNotMatch(
        projector,
        /["'](?:token|password|credential|secret|body|email|phone|pii|providerPayload|monthlyRevenueReference|price)["']/i
    );
    assert.doesNotMatch(projector, /JSON\.stringify|\.\.\.|innerHTML/);
});

test("catalog ve preview renderer yalnız createElement/textContent güvenli DOM kullanır", () => {
    assert.doesNotMatch(js, /innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=/);
    const renderer = section(
        js,
        "function resetCommercialPlanPreview",
        "async function loadCommercialPlanPreview"
    );
    assert.match(renderer, /document\.createElement/);
    assert.match(renderer, /\.textContent\s*=/);
    assert.match(renderer, /\.replaceChildren\(\)/);
    assert.match(renderer, /\.append\(/);
    assert.match(renderer, /classList\.add/);
    assert.doesNotMatch(renderer, /`<|<article|<option|JSON\.stringify/);
});

test("catalog seçenekleri yalnız GET response planIds alanından üretilir", () => {
    const loader = section(
        js,
        "async function loadCommercialPlanCatalog",
        "function renderOverview"
    );

    assert.match(loader, /apiRequest\(["']\/api\/platform\/plans["']\)/);
    assert.match(loader, /projectPlanCatalogForDisplay\(response\?\.catalog\)/);
    assert.match(loader, /populatePlanPreviewTarget\(\s*catalog\.planIds/s);
    assert.doesNotMatch(loader, /["'](?:starter|growth|pro)["']/i);
    assert.doesNotMatch(loader, /method\s*:|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b/i);
    assert.equal((js.match(/\/api\/platform\/plans/g) || []).length, 1);
});

test("preview loader exact tenant/target GET kullanır ve iki stale eksenini doğrular", () => {
    const loader = section(
        js,
        "async function loadCommercialPlanPreview",
        "async function loadCommercialPlanCatalog"
    );

    assert.match(loader, /\+\+state\.planPreviewRequestVersion/);
    assert.match(loader, /state\.selectedTenantId !== tenantId/);
    assert.match(loader, /elements\.planPreviewTarget\.value !== targetPlan/);
    assert.match(loader, /requestVersion !== state\.planPreviewRequestVersion/);
    assert.match(
        loader,
        /encodeURIComponent\(tenantId\).*plan-preview\?targetPlan=.*encodeURIComponent\(targetPlan\)/s
    );
    assert.doesNotMatch(loader, /method\s*:|\bPOST\b|\bPATCH\b|\bPUT\b|\bDELETE\b/i);
    assert.doesNotMatch(loader, /error\.message|response\.message/);
    assert.equal((js.match(/\/plan-preview/g) || []).length, 1);
});

test("preview panel yalnız edit modunda görünür ve selection değişiminde istekler geçersizleşir", () => {
    const createMode = section(js, "function showCreateForm", "function showTenant");
    const editMode = section(js, "function showTenant", "function showEmpty");
    const emptyMode = section(js, "function showEmpty", "function renderTenantList");

    assert.match(createMode, /planPreviewPanel\.classList\.add\("hidden"\)/);
    assert.match(emptyMode, /planPreviewPanel\.classList\.add\("hidden"\)/);
    assert.match(editMode, /planPreviewPanel\.classList\.remove\("hidden"\)/);
    assert.match(editMode, /loadCommercialPlanCatalog\(tenant\.tenantId, tenant\.plan\)/);
    for (const mode of [createMode, emptyMode]) {
        assert.match(mode, /planCatalogRequestVersion \+= 1/);
        assert.match(mode, /planPreviewRequestVersion \+= 1/);
        assert.match(mode, /configuredPlanIds = \[\]/);
    }
});

test("selector change yalnız read-only preview yükler; mevcut Save akışı ayrı kalır", () => {
    const listeners = section(
        js,
        'elements.planPreviewTarget.addEventListener("change"',
        "elements.tenantForm.addEventListener"
    );
    const save = section(js, "async function saveTenant", "if (!firebaseConfig)");

    assert.match(listeners, /loadCommercialPlanPreview\(tenantId, targetPlan\)/);
    assert.doesNotMatch(listeners, /saveTenant|submit|PATCH|POST|apply/i);
    assert.match(save, /elements\.plan\.value/);
    assert.match(save, /method: "PATCH"/);
    assert.doesNotMatch(save, /planPreviewTarget|plan-preview/);
});

test("preview layout desktop ve mobile görünümde okunabilir kalır", () => {
    for (const className of [
        "plan-preview-controls",
        "plan-preview-summary",
        "plan-preview-grid",
        "plan-preview-card",
        "plan-change-gained",
        "plan-change-lost",
        "plan-change-unchanged"
    ]) {
        assert.match(css, new RegExp(`\\.${className}\\b`), className);
    }
    assert.match(css, /\.plan-preview-grid\s*\{[^}]*repeat\(3,/s);
    assert.match(
        css,
        /@media \(max-width: 640px\)[\s\S]*\.plan-preview-grid[^}]*grid-template-columns:\s*1fr/
    );
});
