"use strict";

const { createAuditEvent } = require("../audit/audit-event");
const { requireTenantId } = require("../tenant/tenant-id");
const { createTenantProfile, normalizeDomain } = require("../tenant/tenant-profile");
const { assertPublicRouteAttestation } = require("./public-route-attestation");

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Public route tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Public route tenantId geçersiz.");
    }
    return tenantId;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") {
        throw new TypeError("Public route domain geçersiz.");
    }
    const domain = normalizeDomain(value);
    if (!domain || domain !== value) {
        throw new TypeError("Public route domain geçersiz.");
    }
    return domain;
}

function createPublicRouteProvisioningService({
    tenantRegistry,
    routeWriter,
    attestationVerifier
} = {}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Public route tenant registry gerekli.");
    }
    if (!routeWriter || typeof routeWriter.commitVerifiedRoute !== "function") {
        throw new TypeError("Public route writer gerekli.");
    }
    if (!attestationVerifier || typeof attestationVerifier.verify !== "function") {
        throw new TypeError("Public route attestation verifier gerekli.");
    }

    return Object.freeze({
        async verifyAndActivate({
            tenantId: rawTenantId,
            domain: rawDomain,
            timestamp,
            signature,
            actorId,
            requestId = null
        } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const domain = requireCanonicalDomain(rawDomain);
            const tenant = await tenantRegistry.getById(tenantId);

            if (!tenant || tenant.tenantId !== tenantId) {
                throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
            }
            if (!new Set(["provisioning", "active"]).has(tenant.status)) {
                throw safeError(
                    "PUBLIC_ROUTE_TENANT_STATE_INVALID",
                    "Custom domain yalnız provisioning veya active tenant için doğrulanabilir."
                );
            }

            const profile = createTenantProfile(tenant.profile || {});
            if (profile.customDomain !== domain) {
                throw safeError(
                    "PUBLIC_ROUTE_PROFILE_MISMATCH",
                    "Custom domain tenant profiliyle eşleşmiyor."
                );
            }

            const attestation = attestationVerifier.verify({
                method: "GET",
                path: "/api/public/deployment",
                domain,
                timestamp,
                signature
            });
            const verified = assertPublicRouteAttestation(attestation);
            if (verified.domain !== domain ||
                verified.method !== "GET" ||
                verified.path !== "/api/public/deployment") {
                throw safeError(
                    "PUBLIC_ROUTE_ATTESTATION_INVALID",
                    "Custom domain doğrulaması geçersiz."
                );
            }

            const observedAt = verified.observedAt;
            const auditEvent = createAuditEvent({
                tenantId,
                action: "tenant.public_route.verified",
                actorId: actorId ? String(actorId) : null,
                requestId,
                metadata: {
                    domain,
                    verification: "deployment_probe"
                },
                now: new Date(observedAt)
            });

            return routeWriter.commitVerifiedRoute({
                tenantId,
                domain,
                observedAt,
                auditEvent
            });
        }
    });
}

module.exports = {
    createPublicRouteProvisioningService
};
