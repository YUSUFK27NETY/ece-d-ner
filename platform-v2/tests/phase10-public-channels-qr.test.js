const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { createTenantProfile } = require("../src/tenant/tenant-profile");
const { createQrSvg, MAX_BYTE_PAYLOAD } = require("../src/public/qr-code");
const {
    createPublicChannelService,
    normalizePublicOrigin
} = require("../src/public/public-channel-service");
const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    attachTenantMemberIdentityEndpoints
} = require("../src/http/attach-tenant-member-identity-endpoints");
const {
    attachPublicChannelOwnerEndpoints
} = require("../src/http/attach-public-channel-owner-endpoints");
const { deriveFirebaseSubjectRef } = require("../src/auth/tenant-member-subject");

function tenant(tenantId = "ela-doner", status = "active", whatsapp = true) {
    return {
        tenantId,
        displayName: "Ela Döner",
        sector: "restaurant",
        status,
        plan: "starter",
        features: { whatsapp },
        profile: {
            brandName: "ELA DÖNER",
            whatsapp: "+905551112233",
            instagramUrl: "https://instagram.com/eladoner",
            googleUrl: "https://www.google.com/maps/place/Ela+Doner",
            timezone: "Europe/Istanbul"
        }
    };
}

function entitlementService(enabled = true) {
    return {
        evaluate({ feature }) {
            return {
                feature,
                featureEnabled: enabled,
                usedDefaultPlanPolicy: false
            };
        }
    };
}

test("tenant profile public channel URL'lerini HTTPS ve host allowlist ile doğrular", () => {
    const profile = createTenantProfile({
        instagramUrl: "https://www.instagram.com/ela.doner/",
        googleUrl: "https://maps.app.goo.gl/abc123",
        timezone: "Europe/Istanbul"
    });
    assert.match(profile.instagramUrl, /^https:\/\/www\.instagram\.com\//);
    assert.match(profile.googleUrl, /^https:\/\/maps\.app\.goo\.gl\//);

    for (const instagramUrl of ["javascript:alert(1)", "data:text/html,x", "https://example.com/instagram"]) {
        assert.throws(() => createTenantProfile({ instagramUrl, timezone: "Europe/Istanbul" }), TypeError);
    }
    for (const googleUrl of ["javascript:alert(1)", "https://evil.example/maps", "https://user:pass@google.com/maps"]) {
        assert.throws(() => createTenantProfile({ googleUrl, timezone: "Europe/Istanbul" }), TypeError);
    }
});

test("public origin yalnız canonical güvenli origin kabul eder", () => {
    assert.equal(normalizePublicOrigin("https://platform.example"), "https://platform.example");
    assert.equal(normalizePublicOrigin("http://127.0.0.1:3100"), "http://127.0.0.1:3100");
    assert.throws(() => normalizePublicOrigin("http://platform.example"), TypeError);
    assert.throws(() => normalizePublicOrigin("https://platform.example/redirect?to=https://evil.example"), TypeError);
    assert.throws(() => normalizePublicOrigin("https://user:pass@platform.example"), TypeError);
});

test("channel projection exact tenant ve server-owned canonical URL kullanır", async () => {
    const tenants = new Map([["ela-doner", tenant()]]);
    const captured = [];
    const service = createPublicChannelService({
        tenantRegistry: { async getById(id) { return tenants.get(id) || null; } },
        entitlementService: entitlementService(true),
        publicOrigin: "https://business-platform-v2-production.onrender.com",
        qrRenderer(payload) {
            captured.push(payload);
            return "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>";
        }
    });
    const context = { role: "tenant_owner", actorId: "actor-1", tenantId: "ela-doner" };
    const channels = await service.get({ context, tenantId: "ela-doner" });
    assert.equal(channels.canonicalPublicUrl, "https://business-platform-v2-production.onrender.com/m/ela-doner");
    assert.equal(channels.channels.direct, channels.canonicalPublicUrl);
    assert.equal(channels.channels.whatsapp, "https://wa.me/905551112233");
    assert.match(channels.channels.instagram, /^https:\/\/instagram\.com\//);
    assert.match(channels.channels.google, /^https:\/\/www\.google\.com\//);
    assert.equal(channels.publicAvailable, true);

    const qr = await service.qr({ context, tenantId: "ela-doner" });
    assert.equal(qr.payload, channels.canonicalPublicUrl);
    assert.deepEqual(captured, [channels.canonicalPublicUrl]);

    await assert.rejects(
        service.get({ context, tenantId: "baska-isletme" }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    await assert.rejects(service.get({ context, tenantId: "Ela-Doner" }), TypeError);
});

test("suspended/archived tenant paylaşım projection'ı görülebilir ama QR üretemez", async () => {
    for (const status of ["suspended", "archived", "provisioning"]) {
        const record = tenant("ela-doner", status);
        const service = createPublicChannelService({
            tenantRegistry: { async getById() { return record; } },
            entitlementService: entitlementService(true),
            publicOrigin: "https://platform.example"
        });
        const context = { role: "tenant_owner", actorId: "actor-1", tenantId: "ela-doner" };
        const channels = await service.get({ context, tenantId: "ela-doner" });
        assert.equal(channels.publicAvailable, false);
        assert.equal(channels.qrAvailable, false);
        await assert.rejects(
            service.qr({ context, tenantId: "ela-doner" }),
            error => error?.code === "PUBLIC_CHANNELS_NOT_AVAILABLE"
        );
    }
});

test("WhatsApp channel plan/feature entitlement fail-closed davranır", async () => {
    for (const [featureFlag, entitled] of [[false, true], [true, false]]) {
        const record = tenant("ela-doner", "active", featureFlag);
        const service = createPublicChannelService({
            tenantRegistry: { async getById() { return record; } },
            entitlementService: entitlementService(entitled),
            publicOrigin: "https://platform.example"
        });
        const channels = await service.get({
            context: { role: "tenant_owner", actorId: "actor-1", tenantId: "ela-doner" },
            tenantId: "ela-doner"
        });
        assert.equal(channels.channels.whatsapp, null);
        assert.equal(channels.entitlements.whatsapp, false);
    }
});

test("QR renderer production canonical URL ve max tenant uzunluğunu dependency olmadan üretir", () => {
    const payload = `https://business-platform-v2-production.onrender.com/m/${"a".repeat(63)}`;
    assert.ok(Buffer.byteLength(payload) <= MAX_BYTE_PAYLOAD);
    const svg = createQrSvg(payload);
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<path d="M/);
    assert.doesNotMatch(svg, /business-platform-v2-production/);
});

test("owner channel endpoint exact Firebase tenant binding ve lifecycle uygular", async () => {
    const records = new Map([
        ["ela-doner", tenant("ela-doner", "active")],
        ["baska-isletme", tenant("baska-isletme", "active")]
    ]);
    const ownerSubject = deriveFirebaseSubjectRef("owner-1");
    const auth = {
        async verifyIdToken(token) {
            if (token !== "owner-token") throw new Error("invalid token");
            return { uid: "owner-1", platformAdmin: false };
        }
    };
    const tenantRegistry = {
        async getById(id) { return records.get(id) || null; },
        async list() { return [...records.values()]; },
        async create(value) { records.set(value.tenantId, value); return value; },
        async update(id, value) { records.set(id, value); return value; }
    };
    const app = createPlatformApp({ auth, tenantRegistry });
    attachTenantMemberIdentityEndpoints({
        app,
        auth,
        bindingReader: {
            async getBySubject({ tenantId, subjectRef }) {
                return tenantId === "ela-doner" && subjectRef === ownerSubject
                    ? { tenantId, subjectRef, role: "tenant_owner", state: "active" }
                    : null;
            }
        },
        initialOwnerBootstrapService: { async bindInitialOwner() { throw new Error("not used"); } },
        allowedOrigins: []
    });
    attachPublicChannelOwnerEndpoints({
        app,
        publicChannelService: createPublicChannelService({
            tenantRegistry,
            entitlementService: entitlementService(true),
            publicOrigin: "https://platform.example",
            qrRenderer: () => "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"
        })
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        assert.equal((await fetch(`${base}/api/tenant/tenants/ela-doner/owner/channels`)).status, 401);
        const ok = await fetch(`${base}/api/tenant/tenants/ela-doner/owner/channels`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.equal(body.channels.tenantId, "ela-doner");
        assert.equal(body.channels.canonicalPublicUrl, "https://platform.example/m/ela-doner");

        const cross = await fetch(`${base}/api/tenant/tenants/baska-isletme/owner/channels`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(cross.status, 403);

        const query = await fetch(`${base}/api/tenant/tenants/ela-doner/owner/channels/qr.svg?url=https://evil.example`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(query.status, 400);
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("owner paylaşım frontend safe DOM kullanır, credential localStorage'a yazmaz ve server wiring mevcuttur", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/owner/channels.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/channels.js"), "utf8");
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    assert.match(html, /Canonical URL/);
    assert.match(html, /QR SVG indir/);
    assert.match(script, /getIdToken\(\)/);
    assert.match(script, /textContent/);
    assert.match(script, /replaceChildren/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage/);
    assert.doesNotMatch(script, /setItem\([^\n]*(password|token)/i);
    assert.match(server, /createPublicChannelService/);
    assert.match(server, /attachPublicChannelOwnerEndpoints/);
    assert.match(server, /RENDER_EXTERNAL_URL/);
});
