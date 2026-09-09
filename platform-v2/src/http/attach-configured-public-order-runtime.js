const {
    createFirestorePublicRouteReader
} = require("../firestore/firestore-public-route-reader");
const {
    createPublicRouteAttestationVerifier
} = require("../routing/public-route-attestation");
const {
    createPublicTenantResolver
} = require("../routing/public-tenant-resolver");
const {
    attachPublicOrderEndpoint
} = require("./attach-public-order-endpoint");

const PUBLIC_ROUTE_HMAC_ENV_KEY = "PLATFORM_PUBLIC_ROUTE_HMAC_KEY";

function readConfiguredHmacKey(env) {
    if (!env || typeof env !== "object" || Array.isArray(env)) {
        throw new TypeError("Public order runtime env geçersiz.");
    }
    const value = env[PUBLIC_ROUTE_HMAC_ENV_KEY];
    if (value === undefined || value === null || value === "") {
        return null;
    }
    if (typeof value !== "string" || value.trim() !== value) {
        throw new TypeError("Public route HMAC key yapılandırması geçersiz.");
    }
    return value;
}

function createConfiguredPublicTenantResolver({
    db,
    tenantRegistry,
    env = process.env,
    clock = Date.now
} = {}) {
    const key = readConfiguredHmacKey(env);
    if (key === null) {
        return null;
    }

    const attestationVerifier = createPublicRouteAttestationVerifier({
        key,
        clock
    });
    const routeReader = createFirestorePublicRouteReader({ db });
    return createPublicTenantResolver({
        routeReader,
        tenantRegistry,
        attestationVerifier
    });
}

function attachConfiguredPublicOrderRuntime({
    app,
    db,
    tenantRegistry,
    orderService,
    env = process.env,
    clock = Date.now,
    rateLimiter = null
} = {}) {
    const publicTenantResolver = createConfiguredPublicTenantResolver({
        db,
        tenantRegistry,
        env,
        clock
    });

    if (publicTenantResolver === null) {
        return Object.freeze({ enabled: false });
    }

    attachPublicOrderEndpoint({
        app,
        orderService,
        publicTenantResolver,
        rateLimiter
    });
    return Object.freeze({ enabled: true });
}

module.exports = {
    PUBLIC_ROUTE_HMAC_ENV_KEY,
    attachConfiguredPublicOrderRuntime,
    createConfiguredPublicTenantResolver,
    readConfiguredHmacKey
};
