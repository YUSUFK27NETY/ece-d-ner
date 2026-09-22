const { createAuditEvent } = require("../audit/audit-event");
const { requireTenantId } = require("./tenant-id");
const { TENANT_STATUSES } = require("./tenant-record");
const { assertFeatureActivationAvailable, createFeatureFlags } = require("./feature-catalog");
const { mergeTenantProfile } = require("./tenant-profile");
const { createTenantPresentation } = require("../presentation/presentation-tier");

const UPDATEABLE_FIELDS = new Set([
    "displayName",
    "status",
    "plan",
    "features",
    "profile",
    "presentation"
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

                if (status !== current.status) {
                    const error = new Error(
                        "Tenant durum değişikliği kontrollü lifecycle işlemi gerektirir."
                    );
                    error.code = "TENANT_LIFECYCLE_ACTION_REQUIRED";
                    throw error;
                }
            }

            if ("plan" in patch) {
                next.plan = normalizeSimpleId(patch.plan, "Paket");
            }

            if ("features" in patch) {
                if (!patch.features || typeof patch.features !== "object" || Array.isArray(patch.features)) {
                    throw new TypeError("Feature patch nesne olmalı.");
                }

                const requestedFeatures = createFeatureFlags({
                    ...(current.features || {}),
                    ...patch.features
                });
                next.features = assertFeatureActivationAvailable({
                    currentFeatures: current.features || {},
                    nextFeatures: requestedFeatures
                });
            }

            if ("profile" in patch) {
                next.profile = mergeTenantProfile(current.profile || {}, patch.profile);
            }

            if ("presentation" in patch) {
                const requested = patch.presentation;
                const currentFamily = current.presentation?.family;
                const shouldPreserveFamily = Boolean(currentFamily) &&
                    requested && typeof requested === "object" && !Array.isArray(requested) &&
                    !Object.hasOwn(requested, "family");
                next.presentation = createTenantPresentation(
                    shouldPreserveFamily
                        ? { ...requested, family: currentFamily }
                        : requested
                );
            }

            const auditInput = {
                tenantId: normalizedTenantId,
                action: "tenant.updated",
                actorId: actorId ? String(actorId) : null,
                requestId,
                metadata: {
                    fields: keys.sort()
                },
                now
            };

            if (typeof tenantRegistry.commitTenantUpdate === "function") {
                const auditEvent = createAuditEvent(auditInput);
                try {
                    return await tenantRegistry.commitTenantUpdate({
                        tenantId: normalizedTenantId,
                        expectedTenant: current,
                        nextTenant: next,
                        auditEvent
                    });
                } catch (error) {
                    if (error?.code === "TENANT_UPDATE_STATE_CHANGED") {
                        throw error;
                    }
                    const unavailable = new Error(
                        "Tenant güncellemesi şu anda güvenli şekilde tamamlanamıyor."
                    );
                    unavailable.code = "TENANT_UPDATE_UNAVAILABLE";
                    throw unavailable;
                }
            }

            const updated = await tenantRegistry.update(normalizedTenantId, next);

            if (auditWriter) {
                await auditWriter.write(auditInput);
            }

            return updated;
        }
    });
}

module.exports = {
    UPDATEABLE_FIELDS,
    createTenantManagementService
};
