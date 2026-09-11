const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { normalizeFirebaseWebConfig } = require("../src/config/platform-web-config");
const { requireTenantId } = require("../src/tenant/tenant-id");

const ACTIVATION_TENANT_ENV = "PLATFORM_PHASE9_ACTIVATE_TENANT_ID";

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

async function findUniquePlatformAdmin(auth) {
    if (!auth || typeof auth.listUsers !== "function") {
        throw controlledError("ACTIVATION_AUTH_LIST_UNAVAILABLE");
    }

    let pageToken;
    let selected = null;
    do {
        const page = await auth.listUsers(1000, pageToken);
        if (!page || !Array.isArray(page.users)) {
            throw controlledError("ACTIVATION_AUTH_LIST_INVALID");
        }

        for (const user of page.users) {
            if (user?.disabled !== true && user?.customClaims?.platformAdmin === true) {
                if (selected) {
                    throw controlledError("ACTIVATION_PLATFORM_ADMIN_AMBIGUOUS");
                }
                selected = user;
            }
        }
        pageToken = page.pageToken;
    } while (pageToken);

    if (!selected || !selected.uid) {
        throw controlledError("ACTIVATION_PLATFORM_ADMIN_NOT_FOUND");
    }
    return selected;
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
    const webConfig = normalizeFirebaseWebConfig(env.PLATFORM_FIREBASE_WEB_CONFIG_JSON);
    if (!webConfig?.apiKey) {
        throw controlledError("ACTIVATION_FIREBASE_WEB_CONFIG_MISSING");
    }
    const baseUrl = localBaseUrl(env);

    stage = "admin-identity";
    const { auth } = createPlatformFirebase();
    const user = await findUniquePlatformAdmin(auth);

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

    stage = "verify-tenant";
    const tenantCall = await platformRequest({
        url: `${baseUrl}/api/platform/tenants/${encodeURIComponent(tenantId)}`,
        idToken
    });
    if (!tenantCall.response.ok || tenantCall.payload.success !== true ||
        tenantCall.payload.tenant?.tenantId !== tenantId ||
        tenantCall.payload.tenant?.status !== "active") {
        throw controlledError("ACTIVATION_POST_VERIFY_FAILED");
    }

    stage = "verify-audit";
    const auditCall = await platformRequest({
        url: `${baseUrl}/api/platform/tenants/${encodeURIComponent(tenantId)}/last-audit`,
        idToken
    });
    const lastAudit = auditCall.payload.lastAudit;
    if (!auditCall.response.ok || auditCall.payload.success !== true ||
        !lastAudit || lastAudit.tenantId !== tenantId ||
        lastAudit.status !== "available" ||
        lastAudit.action !== "tenant.lifecycle.activated") {
        throw controlledError("ACTIVATION_AUDIT_VERIFY_FAILED");
    }

    stage = "complete";
    console.log(
        `PHASE9_ACTIVATION_OK tenant=${tenantId} status=active audit=tenant.lifecycle.activated`
    );
}

function reportFailure(error) {
    console.error(`PHASE9_ACTIVATION_FAILED stage=${stage} code=${sanitizeCode(error?.code)}`);
}

async function runPhase9ControlledActivation(env = process.env) {
    try {
        await main(env);
    } catch (error) {
        reportFailure(error);
    }
}

if (require.main === module) {
    void runPhase9ControlledActivation();
}

module.exports = {
    ACTIVATION_TENANT_ENV,
    controlledError,
    localBaseUrl,
    findUniquePlatformAdmin,
    exchangeCustomToken,
    platformRequest,
    main,
    reportFailure,
    runPhase9ControlledActivation
};
