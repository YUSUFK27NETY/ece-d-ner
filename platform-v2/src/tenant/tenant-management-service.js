const { requireTenantId } = require("./tenant-id");
const { TENANT_STATUSES } = require("./tenant-record");
const { createFeatureFlags } = require("./feature-catalog");
const { mergeTenantProfile } = require("./tenant-profile");

const UPDATEABLE_FIELDS = new Set([
    "displayName",
    "status",
    "plan",
    "features",
    "profile"
]);

function normalizeDisplayName(value) {
    const displayName = String(value ?? "").trim();

    if (displayName.length < 2 || displayName.length > 120) {
        throw new TypeError("İşletme adı 2-120 karakter olmalı.");
    }

    return displayName;
}

function normalizeSimpleId(value, label) {
    const normalized = String(value ?? "").trim().toLowerCase();

    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return normalized;
}

function createTenantManagementService({ tenantRegistry, auditWriter = null }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function" ||
        typeof tenantRegistry.update !== "function") {
        throw new TypeError("Tenant registry getById/update metodlarını uygulamalı.");
    }

    if (auditWriter && typeof auditWriter.write !== "function") {
        throw new TypeError("Audit writer write metodunu uygulamalı.");
    }

    return Object.freeze({
        async update({ tenantId, patch, actorId, requestId = null, now = new Date() }) {
            const normalizedTenantId = requireTenantId(tenantId);

            if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
                throw new TypeError("Tenant update patch nesne olmalı.");
            }

            const keys = Object.keys(patch);

            if (keys.length === 0) {
                throw new TypeError("Güncellenecek alan gerekli.");
            }

            for (const key of keys) {
                if (!UPDATEABLE_FIELDS.has(key)) {
                    throw new TypeError(`Güncellenemeyen tenant alanı: ${key}`);
                }
            }

            if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
                throw new TypeError("Geçerli updatedAt tarihi gerekli.");
            }

            const current = await tenantRegistry.getById(normalizedTenantId);

            if (!current) {
                const error = new Error("İşletme bulunamadı.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }

            const next = {
                ...current,
                updatedAt: now.toISOString(),
                updatedBy: actorId ? String(actorId) : null
            };

            if ("displayName" in patch) {
                next.displayName = normalizeDisplayName(patch.displayName);
            }

            if ("status" in patch) {
                const status = String(patch.status ?? "").trim().toLowerCase();

                if (!TENANT_STATUSES.has(status)) {
                    throw new TypeError("Geçersiz tenant durumu.");
                }

                next.status = status;
            }

            if ("plan" in patch) {
                next.plan = normalizeSimpleId(patch.plan, "Paket");
            }

            if ("features" in patch) {
                if (!patch.features || typeof patch.features !== "object" || Array.isArray(patch.features)) {
                    throw new TypeError("Feature patch nesne olmalı.");
                }

                next.features = createFeatureFlags({
                    ...(current.features || {}),
                    ...patch.features
                });
            }

            if ("profile" in patch) {
                next.profile = mergeTenantProfile(current.profile || {}, patch.profile);
            }

            const updated = await tenantRegistry.update(normalizedTenantId, next);

            if (auditWriter) {
                await auditWriter.write({
                    tenantId: normalizedTenantId,
                    action: "tenant.updated",
                    actorId: actorId ? String(actorId) : null,
                    requestId,
                    metadata: {
                        fields: keys.sort()
                    }
                });
            }

            return updated;
        }
    });
}

module.exports = {
    UPDATEABLE_FIELDS,
    createTenantManagementService
};
