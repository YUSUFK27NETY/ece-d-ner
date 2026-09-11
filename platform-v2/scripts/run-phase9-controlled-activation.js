const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { normalizeFirebaseWebConfig } = require("../src/config/platform-web-config");
const { requireTenantId } = require("../src/tenant/tenant-id");

const ACTIVATION_TENANT_ENV = "PLATFORM_PHASE9_ACTIVATE_TENANT_ID";
const ACTIVATION_ADMIN_EMAIL_ENV = "PLATFORM_PHASE9_ACTIVATION_ADMIN_EMAIL";

let stage = "config";

function controlledError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sanitizeCode(value) {
    return String(value ?? "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 80);
}

function requireAdminEmail(value) {
    const email = String(value ?? "").trim();
    if (!email || email.length > 320 || !email.includes("@")) {
        throw controlledError("ACTIVATION_ADMIN_EMAIL_INVALID");
    }
    return email;
}

function localBaseUrl(env = process.env) {
    const port = Number(env.PLATFORM_PORT || env.PORT || 3100);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw controlledError("ACTIVATION_PORT_INVALID");
    }
    return `http://127.0.0.1:${port}`;
}

async function parseJsonResponse(response, code) {
    let value;
    try {
        value = await response.json();
    } catch {
        throw controlledError(code);
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw controlledError(code);
    }
    return value;
}

async function exchangeCustomToken({ customToken, apiKey, fetchImpl = globalThis.fetch }) {
    const response = await fetchImpl(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
        {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: customToken, returnSecureToken: true })
        }
    );
    if (!response.ok) {
        throw controlledError(`ACTIVATION_AUTH_HTTP_${response.status}`);
    }
    const payload = await parseJsonResponse(response, "ACTIVATION_AUTH_RESPONSE_INVALID");
    const idToken = String(payload.idToken ?? "").trim();
    if (!idToken) {
        throw controlledError("ACTIVATION_ID_TOKEN_MISSING");
    }
    return idToken;
}

async function platformRequest({ url, idToken, method = "GET", fetchImpl = globalThis.fetch }) {
    const response = await fetchImpl(url, {
        method,
        headers: { authorization: `Bearer ${idToken}` }
    });
    const payload = await parseJsonResponse(response, "ACTIVATION_API_RESPONSE_INVALID");
    return { response, payload };
}

async function main(env = process.env) {
    stage = "config";
    const tenantId = requireTenantId(env[ACTIVATION_TENANT_ENV]);
    const adminEmail = requireAdminEmail(env[ACTIVATION_ADMIN_EMAIL_ENV]);
    const webConfig = normalizeFirebaseWebConfig(env.PLATFORM_FIREBASE_WEB_CONFIG_JSON);
    if (!webConfig?.apiKey) {
        throw controlledError("ACTIVATION_FIREBASE_WEB_CONFIG_MISSING");
    }
    const baseUrl = localBaseUrl(env);

    stage = "admin-identity";
    const { auth } = createPlatformFirebase();
    const user = await auth.getUserByEmail(adminEmail);
    if (!user || user.disabled === true || user.customClaims?.platformAdmin !== true) {
        throw controlledError("ACTIVATION_PLATFORM_ADMIN_INVALID");
    }

    stage = "auth-exchange";
    const customToken = await auth.createCustomToken(user.uid);
    const idToken = await exchangeCustomToken({
        customToken,
        apiKey: webConfig.apiKey
    });

    stage = "readiness";
    const readinessCall = await platformRequest({
        url: `${baseUrl}/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`,
        idToken
    });
    if (!readinessCall.response.ok || readinessCall.payload.success !== true) {
        throw controlledError(`ACTIVATION_READINESS_HTTP_${readinessCall.response.status}`);
    }
    const readiness = readinessCall.payload.readiness;
    if (!readiness || typeof readiness !== "object" ||
        readiness.tenantId !== tenantId ||
        readiness.lifecycleStatus !== "provisioning" ||
        readiness.activationReadiness !== "ready" ||
        readiness.canActivate !== true ||
        readiness.checks?.backup?.status !== "ready") {
        throw controlledError("ACTIVATION_READINESS_NOT_READY");
    }
    console.log(
        `PHASE9_ACTIVATION_READINESS tenant=${tenantId} readiness=ready canActivate=true backup=ready`
    );

    stage = "activate";
    const activationCall = await platformRequest({
        url: `${baseUrl}/api/platform/tenants/${encodeURIComponent(tenantId)}/lifecycle/activate`,
        idToken,
        method: "POST"
    });
    if (!activationCall.response.ok || activationCall.payload.success !== true ||
        activationCall.payload.tenant?.tenantId !== tenantId ||
        activationCall.payload.tenant?.status !== "active") {
        throw controlledError(`ACTIVATION_HTTP_${activationCall.response.status}`);
    }

    stage = "verify";
    const tenantCall = await platformRequest({
        url: `${baseUrl}/api/platform/tenants/${encodeURIComponent(tenantId)}`,
        idToken
    });
    if (!tenantCall.response.ok || tenantCall.payload.success !== true ||
        tenantCall.payload.tenant?.tenantId !== tenantId ||
        tenantCall.payload.tenant?.status !== "active") {
        throw controlledError("ACTIVATION_POST_VERIFY_FAILED");
    }

    stage = "complete";
    console.log(`PHASE9_ACTIVATION_OK tenant=${tenantId} status=active`);
}

main().catch(error => {
    console.error(`PHASE9_ACTIVATION_FAILED stage=${stage} code=${sanitizeCode(error?.code)}`);
});

module.exports = {
    ACTIVATION_TENANT_ENV,
    ACTIVATION_ADMIN_EMAIL_ENV,
    controlledError,
    requireAdminEmail,
    localBaseUrl,
    exchangeCustomToken,
    platformRequest,
    main
};
