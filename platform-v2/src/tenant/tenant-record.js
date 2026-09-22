const { requireTenantId } = require("./tenant-id");
const { assertFeatureActivationAvailable } = require("./feature-catalog");
const { createTenantProfile } = require("./tenant-profile");
const { createTenantPresentation } = require("../presentation/presentation-tier");

const TENANT_STATUSES = new Set([
    "provisioning",
    "active",
    "suspended",
    "archived"
]);

function requireSimpleId(value, label) {
    const normalized = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return normalized;
}

function requireDisplayName(value) {
    const displayName = String(value ?? "").trim();

    if (displayName.length < 2 || displayName.length > 120) {
        throw new TypeError("İşletme adı 2-120 karakter olmalı.");
    }

    return displayName;
}

function createTenantRecord({
    tenantId,
    displayName,
    sector,
    plan = "starter",
    status = "provisioning",
    features = {},
    profile = {},
    presentation = null,
    createdBy = null,
    now = new Date()
}) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Geçerli createdAt tarihi gerekli.");
    }

    const normalizedStatus = String(status ?? "").trim().toLowerCase();

    if (!TENANT_STATUSES.has(normalizedStatus)) {
        throw new TypeError("Geçersiz tenant durumu.");
    }

    const record = {
        schemaVersion: 1,
        tenantId: requireTenantId(tenantId),
        displayName: requireDisplayName(displayName),
        sector: requireSimpleId(sector, "Sektör"),
        plan: requireSimpleId(plan, "Paket"),
        status: normalizedStatus,
        features: assertFeatureActivationAvailable({ nextFeatures: features }),
        profile: createTenantProfile(profile),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: createdBy ? String(createdBy) : null,
        updatedBy: createdBy ? String(createdBy) : null
    };

    if (presentation !== undefined && presentation !== null) {
        record.presentation = createTenantPresentation(presentation);
    }

    return Object.freeze(record);
}

module.exports = {
    TENANT_STATUSES,
    createTenantRecord
};
