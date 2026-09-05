const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const RELEASE_STAGES = Object.freeze(["canary", "staged", "stable"]);

function safeReleaseValue(value, label) {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(normalized)) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return normalized;
}

function requirePlatformAdmin(context) {
    if (context?.role !== "platform_admin") {
        const error = new Error("Release rollout mutation Platform Admin gerektirir.");
        error.code = "PERMISSION_DENIED";
        throw error;
    }
}

function createTenantReleaseRolloutService({ store, auditWriter = null, now = () => new Date() }) {
    if (!store || typeof store.get !== "function" || typeof store.save !== "function") {
        throw new TypeError("Release rollout store get/save gerekli.");
    }
    if (auditWriter && typeof auditWriter.write !== "function") {
        throw new TypeError("Release rollout audit writer geçersiz.");
    }

    function timestamp() {
        const value = now();
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new TypeError("Release rollout clock geçersiz.");
        }
        return value.toISOString();
    }

    async function audit(record, action, context, requestId) {
        if (!auditWriter) return;
        await auditWriter.write({
            tenantId: record.tenantId,
            action,
            actorId: context.actorId || null,
            requestId,
            metadata: {
                cohort: record.cohort,
                stage: record.stage,
                currentVersion: record.currentVersion,
                targetVersion: record.targetVersion
            }
        });
    }

    async function start({ context, tenantId: rawTenantId, cohort, currentVersion, targetVersion, requestId = null }) {
        requirePlatformAdmin(context);
        const tenantId = requireTenantId(rawTenantId);
        const existing = await store.get(tenantId);
        const normalized = {
            cohort: safeReleaseValue(cohort, "Release cohort"),
            currentVersion: safeReleaseValue(currentVersion, "Release currentVersion"),
            targetVersion: safeReleaseValue(targetVersion, "Release targetVersion")
        };
        if (existing && existing.targetVersion === normalized.targetVersion) return existing;
        const at = timestamp();
        const record = Object.freeze({
            tenantId,
            ...normalized,
            stage: "canary",
            health: "unknown",
            rollbackSignal: false,
            automaticApply: false,
            startedAt: at,
            updatedAt: at
        });
        await store.save(record);
        await audit(record, "tenant.release.started", context, requestId);
        return record;
    }

    async function promote({ context, tenantId: rawTenantId, stage, requestId = null }) {
        requirePlatformAdmin(context);
        const tenantId = requireTenantId(rawTenantId);
        const record = await store.get(tenantId);
        if (!record) {
            const error = new Error("Tenant release rollout bulunamadı.");
            error.code = "ROLLOUT_NOT_FOUND";
            throw error;
        }
        const target = String(stage ?? "").trim().toLowerCase();
        if (!RELEASE_STAGES.includes(target)) throw new TypeError("Release rollout stage geçersiz.");
        if (target === record.stage) return record;
        const expected = RELEASE_STAGES[RELEASE_STAGES.indexOf(record.stage) + 1];
        if (target !== expected || record.rollbackSignal) {
            const error = new Error("Release rollout geçişi güvenli değil.");
            error.code = "ROLLOUT_TRANSITION_INVALID";
            throw error;
        }
        const next = Object.freeze({
            ...record,
            stage: target,
            currentVersion: target === "stable" ? record.targetVersion : record.currentVersion,
            updatedAt: timestamp()
        });
        await store.save(next);
        await audit(next, `tenant.release.promoted.${target}`, context, requestId);
        return next;
    }

    async function recordHealth({ context, tenantId: rawTenantId, healthy, reasonCode = "release-health", requestId = null }) {
        requirePlatformAdmin(context);
        const tenantId = requireTenantId(rawTenantId);
        if (typeof healthy !== "boolean") throw new TypeError("Release health boolean olmalı.");
        const record = await store.get(tenantId);
        if (!record) {
            const error = new Error("Tenant release rollout bulunamadı.");
            error.code = "ROLLOUT_NOT_FOUND";
            throw error;
        }
        const health = healthy === true ? "healthy" : "unhealthy";
        const next = Object.freeze({
            ...record,
            health,
            rollbackSignal: healthy !== true,
            rollbackReasonCode: healthy === true ? null : safeReleaseValue(reasonCode, "Release reasonCode"),
            automaticApply: false,
            updatedAt: timestamp()
        });
        await store.save(next);
        await audit(next, healthy === true ? "tenant.release.healthy" : "tenant.release.rollback_signaled", context, requestId);
        return next;
    }

    async function getStatus({ context, tenantId: rawTenantId }) {
        const tenantId = requireTenantId(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: "tenant.release.read" });
        const record = await store.get(tenantId);
        if (!record) {
            return Object.freeze({
                tenantId, cohort: null, stage: "stable", health: "unknown",
                currentVersion: null, targetVersion: null, rollbackSignal: false,
                automaticApply: false, updatedAt: null
            });
        }
        if (requireTenantId(record.tenantId) !== tenantId) {
            const error = new Error("Release rollout tenant binding uyuşmuyor.");
            error.code = "TENANT_BOUNDARY_VIOLATION";
            throw error;
        }
        return Object.freeze({ ...record });
    }

    return Object.freeze({ start, promote, recordHealth, getStatus });
}

module.exports = {
    RELEASE_STAGES,
    createTenantReleaseRolloutService
};
