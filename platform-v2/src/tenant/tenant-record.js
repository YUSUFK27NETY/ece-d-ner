const { requireTenantId } = require("./tenant-id");
const { createFeatureFlags } = require("./feature-catalog");

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

    return Object.freeze({
        schemaVersion: 1,
        tenantId: requireTenantId(tenantId),
        displayName: requireDisplayName(displayName),
        sector: requireSimpleId(sector, "Sektör"),
        plan: requireSimpleId(plan, "Paket"),
        status: normalizedStatus,
        features: createFeatureFlags(features),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        createdBy: createdBy ? String(createdBy) : null
    });
}

module.exports = {
    TENANT_STATUSES,
    createTenantRecord
};
