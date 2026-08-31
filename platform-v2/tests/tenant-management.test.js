const test = require("node:test");
const assert = require("node:assert/strict");

const { createTenantRecord } = require("../src/tenant/tenant-record");
const { createTenantManagementService } = require("../src/tenant/tenant-management-service");
const { createTenantProfile, normalizeDomain } = require("../src/tenant/tenant-profile");
const {
    normalizeFirebaseWebConfig,
    normalizeAllowedOrigins
} = require("../src/config/platform-web-config");

test("tenant profil modeli domain, URL, renk ve saat dilimini normalize eder", () => {
    const profile = createTenantProfile({
        brandName: " Ece Döner ",
        email: "INFO@EXAMPLE.COM",
        website: "https://example.com",
        customDomain: "HTTPS://MENU.EXAMPLE.COM/",
        primaryColor: "#aabbcc",
        timezone: "Europe/Istanbul"
    });

    assert.equal(profile.brandName, "Ece Döner");
    assert.equal(profile.email, "info@example.com");
    assert.equal(profile.customDomain, "menu.example.com");
    assert.equal(profile.primaryColor, "#AABBCC");
    assert.equal(profile.timezone, "Europe/Istanbul");
    assert.throws(() => normalizeDomain("https://example.com/path"), TypeError);
    assert.throws(() => createTenantProfile({ website: "http://example.com" }), TypeError);
});

test("tenant management sadece izinli alanları günceller ve mevcut feature flagleri korur", async () => {
    const tenant = createTenantRecord({
        tenantId: "ece-doner",
        displayName: "Ece Döner",
        sector: "restaurant",
        features: {
            orders: true,
            whatsapp: true
        },
        profile: {
            brandName: "Ece Döner"
        }
    });
    let stored = tenant;
    const audit = [];

    const service = createTenantManagementService({
        tenantRegistry: {
            async getById() {
                return stored;
            },
            async update(id, next) {
                assert.equal(id, "ece-doner");
                stored = next;
                return next;
            }
        },
        auditWriter: {
            async write(event) {
                audit.push(event);
            }
        }
    });

    const updated = await service.update({
        tenantId: "ece-doner",
        actorId: "platform-admin",
        requestId: "request-1",
        now: new Date("2026-08-31T15:00:00.000Z"),
        patch: {
            status: "active",
            features: {
                reservations: true
            },
            profile: {
                phone: "+90 555 555 55 55"
            }
        }
    });

    assert.equal(updated.status, "active");
    assert.equal(updated.features.orders, true);
    assert.equal(updated.features.whatsapp, true);
    assert.equal(updated.features.reservations, true);
    assert.equal(updated.profile.brandName, "Ece Döner");
    assert.equal(updated.profile.phone, "+90 555 555 55 55");
    assert.equal(updated.updatedBy, "platform-admin");
    assert.equal(updated.updatedAt, "2026-08-31T15:00:00.000Z");
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "tenant.updated");
    assert.equal(audit[0].requestId, "request-1");

    await assert.rejects(
        () => service.update({
            tenantId: "ece-doner",
            patch: { sector: "barber" }
        }),
        TypeError
    );
});

test("tenant management bulunmayan tenant için fail-closed çalışır", async () => {
    const service = createTenantManagementService({
        tenantRegistry: {
            async getById() {
                return null;
            },
            async update() {
                throw new Error("çağrılmamalı");
            }
        }
    });

    await assert.rejects(
        () => service.update({
            tenantId: "missing-tenant",
            patch: { status: "active" }
        }),
        error => error?.code === "TENANT_NOT_FOUND"
    );
});

test("platform web config yalnız gerekli Firebase alanlarını yayınlar", () => {
    const config = normalizeFirebaseWebConfig(JSON.stringify({
        apiKey: "public-web-key",
        authDomain: "platform.firebaseapp.com",
        projectId: "platform-project",
        appId: "1:1:web:abc",
        privateKey: "asla-yayinlanmamali"
    }));

    assert.equal(config.projectId, "platform-project");
    assert.equal(config.privateKey, undefined);
    assert.throws(
        () => normalizeFirebaseWebConfig(JSON.stringify({ apiKey: "x" })),
        /eksik alan/
    );
});

test("platform CORS origin listesi HTTPS ve localhost ile sınırlıdır", () => {
    const origins = normalizeAllowedOrigins(
        "https://admin.example.com,http://localhost:3100"
    );

    assert.deepEqual(origins, [
        "https://admin.example.com",
        "http://localhost:3100"
    ]);

    assert.throws(
        () => normalizeAllowedOrigins("http://admin.example.com"),
        /HTTPS/
    );
});
