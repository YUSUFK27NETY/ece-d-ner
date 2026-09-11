const { isDeepStrictEqual } = require("node:util");
const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { normalizeFirebaseWebConfig } = require("../src/config/platform-web-config");
const {
    findUniquePlatformAdmin,
    exchangeCustomToken,
    localBaseUrl
} = require("./run-phase9-controlled-activation");
const {
    PUBLIC_ORDER_PATH,
    PUBLIC_ROUTE_HEADERS
} = require("../src/http/attach-public-order-endpoint");
const {
    readConfiguredHmacKey
} = require("../src/http/attach-configured-public-order-runtime");
const {
    createPublicRouteSignature
} = require("../src/routing/public-route-attestation");
const { requireTenantId } = require("../src/tenant/tenant-id");

const ACCEPTANCE_TENANT_ENV = "PLATFORM_PHASE9_ACCEPTANCE_TENANT_ID";
const ACCEPTANCE_BASELINE_TENANT_ENV = "PLATFORM_PHASE9_ACCEPTANCE_BASELINE_TENANT_ID";

let stage = "config";

function acceptanceError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sanitizeCode(value) {
    return String(value ?? "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "_")
        .slice(0, 100);
}

async function parseJson(response, code) {
    let payload;
    try {
        payload = await response.json();
    } catch {
        throw acceptanceError(code);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw acceptanceError(code);
    }
    return payload;
}

async function adminRequest({ baseUrl, path, idToken, method = "GET", body = undefined }) {
    const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${idToken}`,
            ...(body === undefined ? {} : { "content-type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    const payload = await parseJson(response, "ACCEPTANCE_ADMIN_RESPONSE_INVALID");
    return { response, payload };
}

function requireSuccess(call, code) {
    if (!call.response.ok || call.payload.success !== true) {
        throw acceptanceError(`${code}_HTTP_${call.response.status}`);
    }
    return call.payload;
}

async function tenantDetail({ baseUrl, idToken, tenantId }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}`,
        idToken
    });
    const payload = requireSuccess(call, "ACCEPTANCE_TENANT_READ");
    if (!payload.tenant || payload.tenant.tenantId !== tenantId) {
        throw acceptanceError("ACCEPTANCE_TENANT_SCOPE_INVALID");
    }
    return payload.tenant;
}

async function baselineSnapshot({ baseUrl, idToken, tenantId }) {
    const [tenant, catalogCall, ordersCall] = await Promise.all([
        tenantDetail({ baseUrl, idToken, tenantId }),
        adminRequest({
            baseUrl,
            path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/catalog/products?limit=200&includeArchived=true`,
            idToken
        }),
        adminRequest({
            baseUrl,
            path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/orders?limit=200`,
            idToken
        })
    ]);
    const catalog = requireSuccess(catalogCall, "ACCEPTANCE_BASELINE_CATALOG").products;
    const orders = requireSuccess(ordersCall, "ACCEPTANCE_BASELINE_ORDERS").orders;
    if (!Array.isArray(catalog) || !Array.isArray(orders)) {
        throw acceptanceError("ACCEPTANCE_BASELINE_PROJECTION_INVALID");
    }
    return structuredClone({ tenant, catalog, orders });
}

async function createSyntheticProduct({ baseUrl, idToken, tenantId }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/catalog/products`,
        idToken,
        method: "POST",
        body: {
            name: "Phase9 Acceptance Item",
            category: "Synthetic",
            price: 123
        }
    });
    const payload = requireSuccess(call, "ACCEPTANCE_CATALOG_CREATE");
    if (!payload.product || payload.product.tenantId !== tenantId ||
        typeof payload.product.productId !== "string") {
        throw acceptanceError("ACCEPTANCE_CATALOG_CREATE_SCOPE_INVALID");
    }
    return payload.product;
}

async function updateSyntheticProduct({ baseUrl, idToken, tenantId, productId }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/catalog/products/${encodeURIComponent(productId)}`,
        idToken,
        method: "PATCH",
        body: { price: 124 }
    });
    const payload = requireSuccess(call, "ACCEPTANCE_CATALOG_UPDATE");
    if (!payload.product || payload.product.tenantId !== tenantId ||
        payload.product.productId !== productId || payload.product.price !== 124) {
        throw acceptanceError("ACCEPTANCE_CATALOG_UPDATE_INVALID");
    }
    return payload.product;
}

async function archiveSyntheticProduct({ baseUrl, idToken, tenantId, productId }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/catalog/products/${encodeURIComponent(productId)}/archive`,
        idToken,
        method: "POST"
    });
    const payload = requireSuccess(call, "ACCEPTANCE_CATALOG_ARCHIVE");
    if (!payload.product || payload.product.tenantId !== tenantId ||
        payload.product.productId !== productId || payload.product.archived !== true) {
        throw acceptanceError("ACCEPTANCE_CATALOG_ARCHIVE_INVALID");
    }
}

async function createPublicSyntheticOrder({
    baseUrl,
    hmacKey,
    domain,
    tenantId,
    productId
}) {
    const timestamp = new Date().toISOString();
    const signature = createPublicRouteSignature({
        key: hmacKey,
        method: "POST",
        path: PUBLIC_ORDER_PATH,
        domain,
        timestamp
    });
    const idempotencyKey = `phase9-live-acceptance-${Date.now()}`;
    const response = await fetch(`${baseUrl}${PUBLIC_ORDER_PATH}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            [PUBLIC_ROUTE_HEADERS.domain]: domain,
            [PUBLIC_ROUTE_HEADERS.timestamp]: timestamp,
            [PUBLIC_ROUTE_HEADERS.signature]: signature
        },
        body: JSON.stringify({
            customerName: "Synthetic Acceptance",
            phone: "05550000000",
            orderType: "dine_in",
            tableNumber: "P9",
            items: [{
                productId,
                quantity: 2,
                clientPrice: 124
            }]
        })
    });
    const payload = await parseJson(response, "ACCEPTANCE_PUBLIC_ORDER_RESPONSE_INVALID");
    if (!response.ok || payload.success !== true) {
        throw acceptanceError(`ACCEPTANCE_PUBLIC_ORDER_HTTP_${response.status}`);
    }
    if (!payload.order || payload.order.tenantId !== tenantId ||
        typeof payload.order.orderId !== "string" || payload.order.total !== 248) {
        throw acceptanceError("ACCEPTANCE_PUBLIC_ORDER_SCOPE_INVALID");
    }
    const projection = JSON.stringify(payload);
    for (const forbidden of ["Synthetic Acceptance", "05550000000", "tableNumber", "requestHash"]) {
        if (projection.includes(forbidden)) {
            throw acceptanceError("ACCEPTANCE_PUBLIC_ORDER_PII_LEAK");
        }
    }
    return payload.order;
}

async function verifyAdminOrder({ baseUrl, idToken, tenantId, orderId }) {
    const listCall = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/orders?limit=200`,
        idToken
    });
    const orders = requireSuccess(listCall, "ACCEPTANCE_ORDER_LIST").orders;
    if (!Array.isArray(orders) || !orders.some(order =>
        order?.tenantId === tenantId && order?.orderId === orderId)) {
        throw acceptanceError("ACCEPTANCE_ORDER_LIST_MISSING");
    }

    const readCall = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/orders/${encodeURIComponent(orderId)}`,
        idToken
    });
    const order = requireSuccess(readCall, "ACCEPTANCE_ORDER_READ").order;
    if (!order || order.tenantId !== tenantId || order.orderId !== orderId) {
        throw acceptanceError("ACCEPTANCE_ORDER_READ_SCOPE_INVALID");
    }

    const statusCall = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/orders/${encodeURIComponent(orderId)}/status`,
        idToken,
        method: "PATCH",
        body: { status: "preparing" }
    });
    const updated = requireSuccess(statusCall, "ACCEPTANCE_ORDER_STATUS").order;
    if (!updated || updated.tenantId !== tenantId || updated.orderId !== orderId ||
        updated.status !== "preparing") {
        throw acceptanceError("ACCEPTANCE_ORDER_STATUS_INVALID");
    }
}

async function lifecycle({ baseUrl, idToken, tenantId, action, expectedStatus }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/lifecycle/${action}`,
        idToken,
        method: "POST"
    });
    const tenant = requireSuccess(call, `ACCEPTANCE_LIFECYCLE_${action.toUpperCase()}`).tenant;
    if (!tenant || tenant.tenantId !== tenantId || tenant.status !== expectedStatus) {
        throw acceptanceError(`ACCEPTANCE_LIFECYCLE_${action.toUpperCase()}_INVALID`);
    }
    return tenant;
}

async function readiness({ baseUrl, idToken, tenantId }) {
    const call = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`,
        idToken
    });
    const value = requireSuccess(call, "ACCEPTANCE_READINESS").readiness;
    if (!value || value.tenantId !== tenantId) {
        throw acceptanceError("ACCEPTANCE_READINESS_SCOPE_INVALID");
    }
    return value;
}

async function main(env = process.env) {
    stage = "config";
    const tenantId = requireTenantId(env[ACCEPTANCE_TENANT_ENV]);
    const baselineTenantId = requireTenantId(env[ACCEPTANCE_BASELINE_TENANT_ENV]);
    if (tenantId === baselineTenantId) {
        throw acceptanceError("ACCEPTANCE_TENANTS_MUST_DIFFER");
    }
    const webConfig = normalizeFirebaseWebConfig(env.PLATFORM_FIREBASE_WEB_CONFIG_JSON);
    if (!webConfig?.apiKey) {
        throw acceptanceError("ACCEPTANCE_FIREBASE_WEB_CONFIG_MISSING");
    }
    const hmacKey = readConfiguredHmacKey(env);
    if (!hmacKey) {
        throw acceptanceError("ACCEPTANCE_PUBLIC_ROUTE_HMAC_MISSING");
    }
    const baseUrl = localBaseUrl(env);

    stage = "admin-identity";
    const { auth } = createPlatformFirebase();
    const platformAdmin = await findUniquePlatformAdmin(auth);
    const customToken = await auth.createCustomToken(platformAdmin.uid);
    const idToken = await exchangeCustomToken({
        customToken,
        apiKey: webConfig.apiKey
    });

    stage = "baseline-before";
    const baselineBefore = await baselineSnapshot({
        baseUrl,
        idToken,
        tenantId: baselineTenantId
    });

    stage = "target-precondition";
    const target = await tenantDetail({ baseUrl, idToken, tenantId });
    if (target.status !== "active") {
        throw acceptanceError("ACCEPTANCE_TARGET_NOT_ACTIVE");
    }
    const domain = String(target.profile?.customDomain ?? "").trim();
    if (!domain) {
        throw acceptanceError("ACCEPTANCE_TARGET_DOMAIN_MISSING");
    }

    let productId = null;
    let productArchived = false;
    try {
        stage = "catalog-create";
        const product = await createSyntheticProduct({ baseUrl, idToken, tenantId });
        productId = product.productId;

        stage = "catalog-update";
        await updateSyntheticProduct({ baseUrl, idToken, tenantId, productId });

        stage = "public-order";
        const order = await createPublicSyntheticOrder({
            baseUrl,
            hmacKey,
            domain,
            tenantId,
            productId
        });

        stage = "admin-order";
        await verifyAdminOrder({
            baseUrl,
            idToken,
            tenantId,
            orderId: order.orderId
        });

        stage = "catalog-archive";
        await archiveSyntheticProduct({ baseUrl, idToken, tenantId, productId });
        productArchived = true;

        stage = "baseline-business-isolation";
        const baselineAfterBusiness = await baselineSnapshot({
            baseUrl,
            idToken,
            tenantId: baselineTenantId
        });
        if (!isDeepStrictEqual(baselineAfterBusiness, baselineBefore)) {
            throw acceptanceError("ACCEPTANCE_BASELINE_CHANGED_BY_BUSINESS_FLOW");
        }
    } finally {
        if (productId && !productArchived) {
            try {
                await archiveSyntheticProduct({ baseUrl, idToken, tenantId, productId });
            } catch {
                // Best-effort cleanup only; original safe failure remains authoritative.
            }
        }
    }

    stage = "lifecycle-suspend";
    await lifecycle({ baseUrl, idToken, tenantId, action: "suspend", expectedStatus: "suspended" });

    stage = "suspended-readiness";
    const suspendedReadiness = await readiness({ baseUrl, idToken, tenantId });
    if (suspendedReadiness.lifecycleStatus !== "suspended" ||
        suspendedReadiness.activationReadiness !== "ready" ||
        suspendedReadiness.canActivate !== false) {
        throw acceptanceError("ACCEPTANCE_SUSPENDED_READINESS_INVALID");
    }

    stage = "lifecycle-resume";
    await lifecycle({ baseUrl, idToken, tenantId, action: "resume", expectedStatus: "active" });

    stage = "lifecycle-resuspend";
    await lifecycle({ baseUrl, idToken, tenantId, action: "suspend", expectedStatus: "suspended" });

    stage = "lifecycle-archive";
    await lifecycle({ baseUrl, idToken, tenantId, action: "archive", expectedStatus: "archived" });

    stage = "archived-readiness";
    const archivedReadiness = await readiness({ baseUrl, idToken, tenantId });
    if (archivedReadiness.lifecycleStatus !== "archived" || archivedReadiness.canActivate !== false) {
        throw acceptanceError("ACCEPTANCE_ARCHIVED_READINESS_INVALID");
    }

    stage = "archive-audit";
    const auditCall = await adminRequest({
        baseUrl,
        path: `/api/platform/tenants/${encodeURIComponent(tenantId)}/last-audit`,
        idToken
    });
    const lastAudit = requireSuccess(auditCall, "ACCEPTANCE_LAST_AUDIT").lastAudit;
    if (!lastAudit || lastAudit.tenantId !== tenantId ||
        lastAudit.status !== "available" ||
        lastAudit.action !== "tenant.lifecycle.archived") {
        throw acceptanceError("ACCEPTANCE_ARCHIVE_AUDIT_INVALID");
    }

    stage = "baseline-final-isolation";
    const baselineFinal = await baselineSnapshot({
        baseUrl,
        idToken,
        tenantId: baselineTenantId
    });
    if (!isDeepStrictEqual(baselineFinal, baselineBefore)) {
        throw acceptanceError("ACCEPTANCE_BASELINE_CHANGED_BY_LIFECYCLE");
    }

    stage = "complete";
    console.log(
        `PHASE9_LIVE_ACCEPTANCE_OK tenant=${tenantId} baseline=${baselineTenantId} businessFlow=pass lifecycle=archived isolation=pass`
    );
}

function reportFailure(error) {
    console.error(`PHASE9_LIVE_ACCEPTANCE_FAILED stage=${stage} code=${sanitizeCode(error?.code)}`);
}

async function runPhase9LiveAcceptance(env = process.env) {
    try {
        await main(env);
    } catch (error) {
        reportFailure(error);
    }
}

if (require.main === module) {
    void runPhase9LiveAcceptance();
}

module.exports = {
    ACCEPTANCE_TENANT_ENV,
    ACCEPTANCE_BASELINE_TENANT_ENV,
    acceptanceError,
    adminRequest,
    baselineSnapshot,
    createPublicSyntheticOrder,
    runPhase9LiveAcceptance,
    main
};
