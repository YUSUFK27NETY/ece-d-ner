"use strict";

const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { createFeatureFlags } = require("../tenant/feature-catalog");
const { createTenantProfile } = require("../tenant/tenant-profile");
const { requireTenantId } = require("../tenant/tenant-id");
const { createQrSvg } = require("./qr-code");

const CHANNEL_PERMISSION = "settings.manage";

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function canonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Public channel tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Public channel tenantId geçersiz.");
    return tenantId;
}

function normalizePublicOrigin(value) {
    let url;
    try {
        url = new URL(String(value ?? ""));
    } catch {
        throw new TypeError("Public channel origin geçersiz.");
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if ((!local && url.protocol !== "https:") || (local && !["http:", "https:"].includes(url.protocol)) ||
        url.username || url.password || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
        throw new TypeError("Public channel origin geçersiz.");
    }
    return url.origin;
}

function whatsappUrl(phone) {
    if (!phone) return null;
    let digits = String(phone).replace(/\D/g, "").replace(/^00/, "");
    if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
    return /^[1-9][0-9]{7,14}$/.test(digits) ? `https://wa.me/${digits}` : null;
}

function whatsappEntitled(tenant, entitlementService) {
    const flags = createFeatureFlags(tenant.features || {});
    if (flags.whatsapp !== true) return false;
    const result = entitlementService.evaluate({ tenant, feature: "whatsapp" });
    return result?.featureEnabled === true && result?.usedDefaultPlanPolicy !== true;
}

function createPublicChannelService({ tenantRegistry, entitlementService, publicOrigin, qrRenderer = createQrSvg }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Public channel tenant registry geçersiz.");
    }
    if (!entitlementService || typeof entitlementService.evaluate !== "function") {
        throw new TypeError("Public channel entitlement service geçersiz.");
    }
    if (typeof qrRenderer !== "function") throw new TypeError("Public channel QR renderer geçersiz.");
    const origin = normalizePublicOrigin(publicOrigin);

    async function authorize(context, rawTenantId) {
        const tenantId = canonicalTenantId(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: CHANNEL_PERMISSION });
        const tenant = await tenantRegistry.getById(tenantId);
        if (!tenant || tenant.tenantId !== tenantId || requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        }
        return tenant;
    }

    function project(tenant) {
        const profile = createTenantProfile(tenant.profile || {});
        const canonicalPublicUrl = new URL(`/m/${tenant.tenantId}`, origin).toString();
        const publicAvailable = tenant.status === "active";
        const canUseWhatsapp = whatsappEntitled(tenant, entitlementService);
        return Object.freeze({
            tenantId: tenant.tenantId,
            status: tenant.status,
            publicAvailable,
            qrAvailable: publicAvailable,
            canonicalPublicUrl,
            channels: Object.freeze({
                direct: canonicalPublicUrl,
                whatsapp: canUseWhatsapp ? whatsappUrl(profile.whatsapp) : null,
                instagram: profile.instagramUrl,
                google: profile.googleUrl
            }),
            entitlements: Object.freeze({ whatsapp: canUseWhatsapp })
        });
    }

    return Object.freeze({
        async get({ context, tenantId: rawTenantId } = {}) {
            return project(await authorize(context, rawTenantId));
        },

        async qr({ context, tenantId: rawTenantId } = {}) {
            const tenant = await authorize(context, rawTenantId);
            const channels = project(tenant);
            if (!channels.publicAvailable) {
                throw safeError("PUBLIC_CHANNELS_NOT_AVAILABLE", "Public channel henüz kullanılamıyor.");
            }
            const payload = channels.canonicalPublicUrl;
            return Object.freeze({ payload, svg: qrRenderer(payload), filename: `${tenant.tenantId}-qr.svg` });
        }
    });
}

module.exports = {
    CHANNEL_PERMISSION,
    createPublicChannelService,
    normalizePublicOrigin,
    whatsappUrl
};
