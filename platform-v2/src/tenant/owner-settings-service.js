"use strict";

const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("./tenant-id");
const { createTenantProfile } = require("./tenant-profile");

const OWNER_SETTINGS_PERMISSION = "settings.manage";
const OWNER_SETTINGS_PROFILE_FIELDS = Object.freeze([
    "brandName",
    "phone",
    "whatsapp",
    "email",
    "website",
    "instagramUrl",
    "googleUrl",
    "address",
    "businessHours",
    "timezone"
]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function canonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Owner ayarları tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Owner ayarları tenantId canonical olmalı.");
    }
    return tenantId;
}

function requirePlainObject(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.getPrototypeOf(value) !== Object.prototype) {
        throw new TypeError(`${label} nesne olmalı.`);
    }
    return value;
}

function normalizeDisplayName(value) {
    const displayName = String(value ?? "").trim();
    if (displayName.length < 2 || displayName.length > 120) {
        throw new TypeError("İşletme adı 2-120 karakter olmalı.");
    }
    return displayName;
}

function normalizeOwnerSettingsPatch(value) {
    const patch = requirePlainObject(value, "Owner ayarları patch");
    const keys = Reflect.ownKeys(patch);
    if (keys.length === 0 ||
        keys.some(key => typeof key !== "string" || !["displayName", "profile"].includes(key))) {
        throw new TypeError("Owner ayarları patch geçersiz.");
    }

    const normalized = {};
    if (Object.hasOwn(patch, "displayName")) {
        normalized.displayName = normalizeDisplayName(patch.displayName);
    }

    if (Object.hasOwn(patch, "profile")) {
        const profile = requirePlainObject(patch.profile, "Owner profil patch");
        const profileKeys = Reflect.ownKeys(profile);
        if (profileKeys.length === 0 ||
            profileKeys.some(key =>
                typeof key !== "string" || !OWNER_SETTINGS_PROFILE_FIELDS.includes(key)
            )) {
            throw new TypeError("Owner profil patch geçersiz.");
        }
        normalized.profile = {};
        for (const key of profileKeys) {
            normalized.profile[key] = profile[key];
        }
    }

    return Object.freeze(normalized);
}

function projectOwnerSettings(tenant) {
    if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
        throw new TypeError("Owner ayarları tenant kaydı geçersiz.");
    }
    const tenantId = canonicalTenantId(tenant.tenantId);
    const profile = createTenantProfile(tenant.profile || {});
    const ownerProfile = {};
    for (const field of OWNER_SETTINGS_PROFILE_FIELDS) {
        ownerProfile[field] = profile[field];
    }

    return Object.freeze({
        tenantId,
        displayName: normalizeDisplayName(tenant.displayName),
        status: String(tenant.status || ""),
        profile: Object.freeze(ownerProfile)
    });
}

function createOwnerSettingsService({ tenantRegistry, tenantManagementService } = {}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Owner ayarları tenant registry gerekli.");
    }
    if (!tenantManagementService || typeof tenantManagementService.update !== "function") {
        throw new TypeError("Owner ayarları tenant management service gerekli.");
    }

    async function authorize(context, rawTenantId) {
        const tenantId = canonicalTenantId(rawTenantId);
        authorizeTenantAction({
            context,
            tenantId,
            permission: OWNER_SETTINGS_PERMISSION
        });
        const tenant = await tenantRegistry.getById(tenantId);
        if (!tenant || tenant.tenantId !== tenantId ||
            requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
        }
        return tenant;
    }

    return Object.freeze({
        async get({ context, tenantId } = {}) {
            return projectOwnerSettings(await authorize(context, tenantId));
        },

        async update({ context, tenantId, patch, requestId = null } = {}) {
            const tenant = await authorize(context, tenantId);
            if (tenant.status === "archived") {
                throw safeError("TENANT_ARCHIVED", "Arşivlenmiş işletme güncellenemez.");
            }
            const safePatch = normalizeOwnerSettingsPatch(patch);
            const updated = await tenantManagementService.update({
                tenantId: tenant.tenantId,
                patch: safePatch,
                actorId: context.actorId,
                requestId
            });
            if (!updated || updated.tenantId !== tenant.tenantId) {
                throw safeError("TENANT_UPDATE_FAILED", "İşletme ayarları güncellemesi doğrulanamadı.");
            }
            return projectOwnerSettings(updated);
        }
    });
}

module.exports = {
    OWNER_SETTINGS_PERMISSION,
    OWNER_SETTINGS_PROFILE_FIELDS,
    createOwnerSettingsService,
    normalizeOwnerSettingsPatch,
    projectOwnerSettings
};
