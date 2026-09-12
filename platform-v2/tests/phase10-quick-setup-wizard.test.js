const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { createTenantProfile } = require("../src/tenant/tenant-profile");
const { createPublicChannelService } = require("../src/public/public-channel-service");
const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    PLATFORM_DELIVERY_BASE,
    attachPublicChannelOwnerEndpoints
} = require("../src/http/attach-public-channel-owner-endpoints");

function tenant(status = "provisioning") {
    return {
        tenantId: "ela-doner",
        displayName: "Ela Döner",
        sector: "restaurant",
        status,
        plan: "starter",
        features: {
            catalog: true,
            orders: true,
            appointments: false,
            reservations: false,
            whatsapp: true,
            inventory: false,
            quotes: false,
            crm: false,
            fleet: false,
            gallery: true
        },
        profile: {
            brandName: "ELA DÖNER",
            phone: "+905551112233",
            whatsapp: "+905551112233",
            email: "info@example.com",
            instagramUrl: "https://instagram.com/eladoner",
            googleUrl: "https://maps.app.goo.gl/abc123",
            businessHours: "Pzt-Cmt 09:00-22:00",
            timezone: "Europe/Istanbul"
        }
    };
}

function entitlementService() {
    return {
        evaluate({ feature }) {
            return { feature, featureEnabled: true, usedDefaultPlanPolicy: false };
        }
    };
}

test("tenant profile çalışma saatlerini normalize eder ve limit uygular", () => {
    const profile = createTenantProfile({
        businessHours: "  Pzt-Cmt 09:00-22:00  ",
        timezone: "Europe/Istanbul"
    });
    assert.equal(profile.businessHours, "Pzt-Cmt 09:00-22:00");
    assert.equal(createTenantProfile({ timezone: "Europe/Istanbul" }).businessHours, null);
    assert.throws(
        () => createTenantProfile({ businessHours: "x".repeat(501), timezone: "Europe/Istanbul" }),
        TypeError
    );
});

test("Platform Admin delivery endpoint P10-10 canonical projection kullanır ve QR lifecycle fail-closed kalır", async () => {
    let record = tenant("provisioning");
    const tenantRegistry = {
        async getById(id) { return id === "ela-doner" ? record : null; },
        async list() { return [record]; },
        async create(value) { record = value; return value; },
        async update(id, value) { record = value; return value; }
    };
    const auth = {
        async verifyIdToken(token) {
            if (token !== "platform-token") throw new Error("invalid");
            return { uid: "platform-admin-1", platformAdmin: true };
        }
    };
    const capturedPayloads = [];
    const publicChannelService = createPublicChannelService({
        tenantRegistry,
        entitlementService: entitlementService(),
        tenantManagementService: { async update() { throw new Error("not used"); } },
        publicOrigin: "https://business-platform-v2-production.onrender.com",
        qrRenderer(payload) {
            capturedPayloads.push(payload);
            return "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        }
    });
    const app = createPlatformApp({ auth, tenantRegistry });
    attachPublicChannelOwnerEndpoints({ app, publicChannelService });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const noAuth = await fetch(`${base}/api/platform/tenants/ela-doner/delivery`);
        assert.equal(noAuth.status, 401);

        const headers = { Authorization: "Bearer platform-token" };
        const projection = await fetch(`${base}/api/platform/tenants/ela-doner/delivery`, { headers });
        assert.equal(projection.status, 200);
        const body = await projection.json();
        assert.equal(body.delivery.tenantId, "ela-doner");
        assert.equal(
            body.delivery.canonicalPublicUrl,
            "https://business-platform-v2-production.onrender.com/m/ela-doner"
        );
        assert.equal(body.delivery.publicAvailable, false);
        assert.equal(body.delivery.qrAvailable, false);

        const queryRedirect = await fetch(
            `${base}/api/platform/tenants/ela-doner/delivery?url=https://evil.example`,
            { headers }
        );
        assert.equal(queryRedirect.status, 400);

        const provisioningQr = await fetch(`${base}/api/platform/tenants/ela-doner/delivery/qr.svg`, { headers });
        assert.equal(provisioningQr.status, 409);
        assert.deepEqual(capturedPayloads, []);

        record = { ...record, status: "active" };
        const activeQr = await fetch(`${base}/api/platform/tenants/ela-doner/delivery/qr.svg`, { headers });
        assert.equal(activeQr.status, 200);
        assert.match(activeQr.headers.get("content-type") || "", /^image\/svg\+xml/);
        assert.deepEqual(capturedPayloads, [
            "https://business-platform-v2-production.onrender.com/m/ela-doner"
        ]);

        const invalidCase = await fetch(`${base}/api/platform/tenants/Ela-Doner/delivery`, { headers });
        assert.equal(invalidCase.status, 400);
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("quick setup frontend restartable akış, server readiness ve güvenli DOM kurallarını taşır", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/admin/quick-setup.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/admin/quick-setup.js"), "utf8");
    const css = fs.readFileSync(path.join(__dirname, "../public/admin/quick-setup.css"), "utf8");

    assert.match(html, /Hızlı Kurulum Sihirbazı/);
    assert.match(html, /İşletme ve sektör şablonu/);
    assert.match(html, /Minimum içerik ve ilk owner/);
    assert.match(html, /Server-owned hazırlık/);
    assert.match(html, /Yetkili önizleme ve aktivasyon/);
    assert.match(html, /Teslimat ve paylaşım kanalları/);
    assert.ok(css.length > 500);

    assert.match(script, /\/api\/platform\/sector-templates/);
    assert.match(script, /error\.status !== 409/);
    assert.match(script, /duplicate oluşturulmadı/);
    assert.match(script, /Mevcut tenant: şablon otomatik yeniden uygulanmaz/);
    assert.match(script, /admin-bootstrap\/initial-owner/);
    assert.match(script, /\/readiness/);
    assert.match(script, /readiness\?\.canActivate === true/);
    assert.match(script, /minimumReady\(\)/);
    assert.match(script, /lifecycle\/activate/);
    assert.match(script, /\/delivery/);
    assert.match(script, /delivery\/qr\.svg/);
    assert.match(script, /businessHours/);
    assert.match(script, /catalog\/products/);
    assert.match(script, /textContent/);
    assert.match(script, /replaceChildren/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage/);
    assert.doesNotMatch(script, /sessionStorage/);
    assert.doesNotMatch(script, /password/i);
});

test("ana admin sektör şablonları CRM dahil feature setini hardcode etmeden üretir", () => {
    const script = fs.readFileSync(path.join(__dirname, "../public/admin/sector-templates.js"), "utf8");
    assert.match(script, /crm: "CRM"/);
    assert.match(script, /Object\.keys\(/);
    assert.match(script, /state\.featureKeys/);
    assert.match(script, /renderFeatureGrid/);
    assert.match(script, /replaceChildren/);
    assert.doesNotMatch(script, /const FEATURE_KEYS/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
});

test("Platform delivery route yalnız mevcut authenticated admin API alanına eklenir", () => {
    const endpoint = fs.readFileSync(
        path.join(__dirname, "../src/http/attach-public-channel-owner-endpoints.js"),
        "utf8"
    );
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    assert.equal(PLATFORM_DELIVERY_BASE, "/api/platform/tenants/:tenantId/delivery");
    assert.match(endpoint, /platformActor\.role !== "platform_admin"/);
    assert.match(endpoint, /publicChannelService\.get/);
    assert.match(endpoint, /publicChannelService\.qr/);
    assert.match(endpoint, /hasCallerInput\(req\)/);
    assert.match(server, /attachPublicChannelOwnerEndpoints/);
    assert.match(server, /createPublicChannelService/);
});
