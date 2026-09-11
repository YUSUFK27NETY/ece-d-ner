const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { normalizeFirebaseWebConfig } = require("../src/config/platform-web-config");
const { requireTenantId } = require("../src/tenant/tenant-id");
const { normalizeDomain } = require("../src/tenant/tenant-profile");
const {
    findUniquePlatformAdmin,
    exchangeCustomToken,
    localBaseUrl
} = require("./run-phase9-controlled-activation");

const ROUTE_FIXTURE_TENANT_ENV = "PLATFORM_PHASE9_ROUTE_FIXTURE_TENANT_ID";
const ROUTE_FIXTURE_MODE_ENV = "PLATFORM_PHASE9_ROUTE_FIXTURE_MODE";
const ROUTE_COLLECTION = "platformTenantPublicRoutes";

let stage = "config";

function fixtureError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sanitizeCode(value) {
    return String(value ?? "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 100);
}

function fixtureDomain(tenantId) {
    const domain = normalizeDomain(`${tenantId}.example.com`);
    if (!domain) throw fixtureError("ROUTE_FIXTURE_DOMAIN_INVALID");
    return domain;
}

async function parseJson(response) {
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw fixtureError("ROUTE_FIXTURE_API_RESPONSE_INVALID");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw fixtureError("ROUTE_FIXTURE_API_RESPONSE_INVALID");
    }
    return payload;
}

async function adminRequest({ baseUrl, path, idToken, method = "GET", body }) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${idToken}`,
            ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await parseJson(response);
    if (!response.ok || payload.success !== true) {
        throw fixtureError(`ROUTE_FIXTURE_API_HTTP_${response.status}`);
    }
    return payload;
}

async function loadTenant({ baseUrl, idToken, tenantId }) {
    const payload = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}`,
        idToken
    });
    if (!payload.tenant || payload.tenant.tenantId !== tenantId) {
        throw fixtureError("ROUTE_FIXTURE_TENANT_INVALID");
    }
    return payload.tenant;
}

async function patchDomain({ baseUrl, idToken, tenantId, customDomain }) {
    const payload = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}`,
        idToken,
        method: "PATCH",
        body: { profile: { customDomain } }
    });
    if (!payload.tenant || payload.tenant.tenantId !== tenantId ||
        (payload.tenant.profile?.customDomain ?? null) !== customDomain) {
        throw fixtureError("ROUTE_FIXTURE_PROFILE_PATCH_INVALID");
    }
}

async function setup({ db, baseUrl, idToken, tenantId }) {
    stage = "setup-precondition";
    const tenant = await loadTenant({ baseUrl, idToken, tenantId });
    if (tenant.status !== "active") {
        throw fixtureError("ROUTE_FIXTURE_TENANT_NOT_ACTIVE");
    }
    if (tenant.profile?.customDomain) {
        throw fixtureError("ROUTE_FIXTURE_EXISTING_DOMAIN");
    }

    const domain = fixtureDomain(tenantId);
    const ref = db.collection(ROUTE_COLLECTION).doc(domain);
    const existing = await ref.get();
    if (existing.exists) {
        throw fixtureError("ROUTE_FIXTURE_ROUTE_ALREADY_EXISTS");
    }

    stage = "setup-profile";
    await patchDomain({ baseUrl, idToken, tenantId, customDomain: domain });

    stage = "setup-route";
    try {
        await ref.create({
            schemaVersion: 1,
            domain,
            tenantId,
            state: "active",
            observedAt: new Date().toISOString()
        });
    } catch (error) {
        try {
            await patchDomain({ baseUrl, idToken, tenantId, customDomain: null });
        } catch {
            throw fixtureError("ROUTE_FIXTURE_SETUP_ROLLBACK_FAILED");
        }
        throw fixtureError(error?.code === 6
            ? "ROUTE_FIXTURE_ROUTE_ALREADY_EXISTS"
            : "ROUTE_FIXTURE_ROUTE_CREATE_FAILED");
    }

    console.log(`PHASE9_ROUTE_FIXTURE_OK tenant=${tenantId} mode=setup`);
}

async function cleanup({ db, baseUrl, idToken, tenantId }) {
    const domain = fixtureDomain(tenantId);
    const ref = db.collection(ROUTE_COLLECTION).doc(domain);

    stage = "cleanup-route-read";
    const snapshot = await ref.get();
    if (snapshot.exists) {
        const data = snapshot.data();
        if (!data || data.tenantId !== tenantId || data.domain !== domain ||
            data.schemaVersion !== 1) {
            throw fixtureError("ROUTE_FIXTURE_CLEANUP_SCOPE_MISMATCH");
        }
        stage = "cleanup-route-delete";
        await ref.delete();
    }

    stage = "cleanup-profile";
    const tenant = await loadTenant({ baseUrl, idToken, tenantId });
    const currentDomain = tenant.profile?.customDomain ?? null;
    if (currentDomain !== null && currentDomain !== domain) {
        throw fixtureError("ROUTE_FIXTURE_CLEANUP_PROFILE_MISMATCH");
    }
    if (currentDomain === domain) {
        await patchDomain({ baseUrl, idToken, tenantId, customDomain: null });
    }

    console.log(`PHASE9_ROUTE_FIXTURE_OK tenant=${tenantId} mode=cleanup`);
}

async function main(env = process.env) {
    stage = "config";
    const tenantId = requireTenantId(env[ROUTE_FIXTURE_TENANT_ENV]);
    const mode = String(env[ROUTE_FIXTURE_MODE_ENV] ?? "").trim();
    if (!["setup", "cleanup"].includes(mode)) {
        throw fixtureError("ROUTE_FIXTURE_MODE_INVALID");
    }
    const webConfig = normalizeFirebaseWebConfig(env.PLATFORM_FIREBASE_WEB_CONFIG_JSON);
    if (!webConfig?.apiKey) {
        throw fixtureError("ROUTE_FIXTURE_FIREBASE_WEB_CONFIG_MISSING");
    }
    const baseUrl = localBaseUrl(env);

    stage = "admin-identity";
    const { auth, db } = createPlatformFirebase();
    const admin = await findUniquePlatformAdmin(auth);
    const customToken = await auth.createCustomToken(admin.uid);
    const idToken = await exchangeCustomToken({ customToken, apiKey: webConfig.apiKey });

    if (mode === "setup") {
        await setup({ db, baseUrl, idToken, tenantId });
    } else {
        await cleanup({ db, baseUrl, idToken, tenantId });
    }
}

function reportFailure(error) {
    console.error(`PHASE9_ROUTE_FIXTURE_FAILED stage=${stage} code=${sanitizeCode(error?.code)}`);
}

async function runPhase9RouteFixture(env = process.env) {
    try {
        await main(env);
    } catch (error) {
        reportFailure(error);
    }
}

if (require.main === module) {
    void runPhase9RouteFixture();
}

module.exports = {
    ROUTE_FIXTURE_TENANT_ENV,
    ROUTE_FIXTURE_MODE_ENV,
    fixtureDomain,
    runPhase9RouteFixture,
    main
};
