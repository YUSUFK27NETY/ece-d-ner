"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createTenantManagementService } = require("../src/tenant/tenant-management-service");
const {
    createOwnerSettingsService,
    normalizeOwnerSettingsPatch
} = require("../src/tenant/owner-settings-service");

function tenantRecord(overrides = {}) {
    return {
        tenantId: "ela-doner",
        displayName: "ELA DÖNER",
        sector: "restaurant",
        status: "active",
        plan: "starter",
        features: {},
        profile: {
            brandName: "ELA DÖNER",
            phone: "+90 342 000 00 00",
            whatsapp: "+90 5 000 000 00 00",
            email: "info@example.com",
            website: "https://example.com/",
            instagramUrl: "https://instagram.com/example",
            googleUrl: "https://g.page/example",
            customDomain: "example.com",
            logoUrl: "https://example.com/logo.png",
            primaryColor: "#112233",
            address: "Gaziantep",
            businessHours: "Her gün 09:00–21:00",
            timezone: "Europe/Istanbul"
        },
        presentation: { tier: "starter", version: 1 },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        updatedBy: null,
        ...overrides
    };
}

function ownerContext(tenantId = "ela-doner", role = "tenant_owner") {
    return {
        role,
        actorId: "owner-1",
        tenantId
    };
}

function createHarness(record = tenantRecord()) {
    let current = structuredClone(record);
    const audits = [];
    const tenantRegistry = {
        async getById(tenantId) {
            return current?.tenantId === tenantId ? structuredClone(current) : null;
        },
        async update(tenantId, next) {
            assert.equal(tenantId, current.tenantId);
            current = structuredClone(next);
            return structuredClone(current);
        }
    };
    const tenantManagementService = createTenantManagementService({
        tenantRegistry,
        auditWriter: {
            async write(event) {
                audits.push(structuredClone(event));
            }
        }
    });
    const service = createOwnerSettingsService({
        tenantRegistry,
        tenantManagementService
    });
    return {
        service,
        audits,
        current: () => structuredClone(current)
    };
}

test("owner self-service patch yalnız displayName ve güvenli profil alanlarını kabul eder", () => {
    assert.deepEqual(
        normalizeOwnerSettingsPatch({
            displayName: "ELA DÖNER",
            profile: {
                phone: "+90 342 000 00 00",
                businessHours: "Her gün 09:00–21:00"
            }
        }),
        {
            displayName: "ELA DÖNER",
            profile: {
                phone: "+90 342 000 00 00",
                businessHours: "Her gün 09:00–21:00"
            }
        }
    );

    assert.throws(
        () => normalizeOwnerSettingsPatch({ plan: "business_pro" }),
        TypeError
    );
    assert.throws(
        () => normalizeOwnerSettingsPatch({ status: "suspended" }),
        TypeError
    );
    assert.throws(
        () => normalizeOwnerSettingsPatch({
            profile: { customDomain: "attacker.example" }
        }),
        TypeError
    );
    assert.throws(
        () => normalizeOwnerSettingsPatch({
            profile: { primaryColor: "#FFFFFF" }
        }),
        TypeError
    );
});

test("owner kendi tenant işletme bilgilerini günceller; admin alanları korunur ve audit içerik taşımaz", async () => {
    const harness = createHarness();
    const settings = await harness.service.update({
        context: ownerContext(),
        tenantId: "ela-doner",
        patch: {
            displayName: "ELA DÖNER MERKEZ",
            profile: {
                phone: "+90 342 111 22 33",
                whatsapp: "+90 555 111 22 33",
                email: "magaza@example.com",
                address: "Şahinbey / Gaziantep",
                businessHours: "Her gün 09:00–22:00"
            }
        },
        requestId: "req-1"
    });

    assert.equal(settings.tenantId, "ela-doner");
    assert.equal(settings.displayName, "ELA DÖNER MERKEZ");
    assert.equal(settings.profile.businessHours, "Her gün 09:00–22:00");
    assert.equal(settings.profile.phone, "+90 342 111 22 33");
    assert.equal(settings.profile.customDomain, undefined);
    assert.equal(settings.profile.logoUrl, undefined);
    assert.equal(settings.profile.primaryColor, undefined);

    const persisted = harness.current();
    assert.equal(persisted.profile.customDomain, "example.com");
    assert.equal(persisted.profile.logoUrl, "https://example.com/logo.png");
    assert.equal(persisted.profile.primaryColor, "#112233");
    assert.equal(persisted.plan, "starter");
    assert.equal(persisted.status, "active");

    assert.equal(harness.audits.length, 1);
    assert.equal(harness.audits[0].action, "tenant.updated");
    assert.deepEqual(harness.audits[0].metadata.fields, ["displayName", "profile"]);
    assert.equal(JSON.stringify(harness.audits[0]).includes("342 111"), false);
    assert.equal(JSON.stringify(harness.audits[0]).includes("magaza@example.com"), false);
});

test("owner ayarları exact tenant ve role sınırında fail-closed çalışır", async () => {
    const harness = createHarness();

    await assert.rejects(
        harness.service.get({
            context: ownerContext("other-tenant"),
            tenantId: "ela-doner"
        }),
        error => error.code === "TENANT_SCOPE_MISMATCH"
    );

    for (const role of ["staff", "viewer"]) {
        await assert.rejects(
            harness.service.get({
                context: ownerContext("ela-doner", role),
                tenantId: "ela-doner"
            }),
            error => error.code === "PERMISSION_DENIED"
        );
    }

    const adminView = await harness.service.get({
        context: ownerContext("ela-doner", "tenant_admin"),
        tenantId: "ela-doner"
    });
    assert.equal(adminView.tenantId, "ela-doner");
});

test("arşivlenmiş işletme self-service ile değiştirilemez", async () => {
    const harness = createHarness(tenantRecord({ status: "archived" }));
    await assert.rejects(
        harness.service.update({
            context: ownerContext(),
            tenantId: "ela-doner",
            patch: { displayName: "Yeni ad" }
        }),
        error => error.code === "TENANT_ARCHIVED"
    );
});

test("owner settings UI server-resolved session kullanır; localStorage ve innerHTML kullanmaz", () => {
    const ownerRoot = path.join(__dirname, "../public/owner");
    const html = fs.readFileSync(path.join(ownerRoot, "settings.html"), "utf8");
    const js = fs.readFileSync(path.join(ownerRoot, "settings.js"), "utf8");
    const panel = fs.readFileSync(path.join(ownerRoot, "panel.html"), "utf8");

    assert.match(html, /session-resolver\.js/);
    assert.match(js, /OWNER_SESSION_RESOLVER\.resolve/);
    assert.match(js, /\/owner\/settings/);
    assert.match(panel, /\/owner\/settings\.html/);
    assert.doesNotMatch(js, /localStorage/);
    assert.doesNotMatch(js, /innerHTML\s*=/);
    assert.match(js, /captured\.tenantId !== state\.tenantId/);
    assert.match(js, /updated\.tenantId !== captured\.tenantId/);
});

test("server ve production smoke owner self-service settings assetlerini bağlar", () => {
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const smoke = fs.readFileSync(
        path.join(__dirname, "../scripts/check-production-smoke.js"),
        "utf8"
    );

    assert.match(server, /createOwnerSettingsService/);
    assert.match(server, /attachOwnerSettingsEndpoints/);
    assert.match(smoke, /\/owner\/settings\.html/);
    assert.match(smoke, /\/owner\/settings\.js/);
});
