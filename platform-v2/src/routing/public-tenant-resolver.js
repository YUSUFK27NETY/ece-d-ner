const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");
const {
    assertPublicRouteAttestation
} = require("./public-route-attestation");
const {
    issueTrustedTenantResolution
} = require("../orders/trusted-tenant-resolution");

function safeError(code) {
    const error = new Error("Public tenant route kullanılamıyor.");
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw safeError("PUBLIC_ROUTE_MISMATCH");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw safeError("PUBLIC_ROUTE_MISMATCH");
    return tenantId;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") throw safeError("PUBLIC_ROUTE_MISMATCH");
    let domain;
    try {
        domain = normalizeDomain(value);
    } catch {
        throw safeError("PUBLIC_ROUTE_MISMATCH");
    }
    if (!domain || domain !== value) throw safeError("PUBLIC_ROUTE_MISMATCH");
    return domain;
}

function validateRoute(route, domain) {
    if (!isPlainRecord(route) || route.schemaVersion !== 1 ||
        route.domain !== domain || route.state !== "active") {
        throw safeError("PUBLIC_ROUTE_MISMATCH");
    }
    const tenantId = requireCanonicalTenantId(route.tenantId);
    if (typeof route.observedAt !== "string" || Number.isNaN(Date.parse(route.observedAt)) ||
        new Date(Date.parse(route.observedAt)).toISOString() !== route.observedAt) {
        throw safeError("PUBLIC_ROUTE_MISMATCH");
    }
    return { tenantId, observedAt: route.observedAt };
}

function validateTenant(tenant, tenantId, domain) {
    if (!isPlainRecord(tenant) || tenant.tenantId !== tenantId ||
        requireTenantId(tenant.tenantId) !== tenantId || tenant.status !== "active") {
        throw safeError("PUBLIC_ROUTE_MISMATCH");
    }
    const profile = tenant.profile;
    if (!isPlainRecord(profile)) throw safeError("PUBLIC_ROUTE_MISMATCH");
    const customDomain = requireCanonicalDomain(profile.customDomain);
    if (customDomain !== domain) throw safeError("PUBLIC_ROUTE_MISMATCH");
    return tenant;
}

function createPublicTenantResolver({
    routeReader,
    tenantRegistry,
    attestationVerifier
} = {}) {
    if (!routeReader || typeof routeReader.getByDomain !== "function") {
        throw new TypeError("Public tenant resolver route reader gerekli.");
    }
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Public tenant resolver tenant registry gerekli.");
    }
    if (!attestationVerifier || typeof attestationVerifier.verify !== "function") {
        throw new TypeError("Public tenant resolver attestation verifier gerekli.");
    }

    return Object.freeze({
        async resolve(input = {}) {
            let attestation;
            try {
                attestation = assertPublicRouteAttestation(
                    attestationVerifier.verify(input)
                );
            } catch {
                throw safeError("PUBLIC_ROUTE_ATTESTATION_REQUIRED");
            }

            let route;
            try {
                route = await routeReader.getByDomain(attestation.domain);
            } catch {
                throw safeError("PUBLIC_ROUTE_UNAVAILABLE");
            }
            if (!route) throw safeError("PUBLIC_ROUTE_NOT_FOUND");

            const safeRoute = validateRoute(route, attestation.domain);
            let tenant;
            try {
                tenant = await tenantRegistry.getById(safeRoute.tenantId);
            } catch {
                throw safeError("PUBLIC_ROUTE_UNAVAILABLE");
            }
            if (!tenant) throw safeError("PUBLIC_ROUTE_NOT_FOUND");
            validateTenant(tenant, safeRoute.tenantId, attestation.domain);

            return issueTrustedTenantResolution({
                tenantId: safeRoute.tenantId,
                source: "trusted_route",
                observedAt: new Date(attestation.observedAt)
            });
        }
    });
}

module.exports = {
    createPublicTenantResolver
};
