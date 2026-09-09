const { isDeepStrictEqual } = require("node:util");
const { createAuditEvent } = require("../audit/audit-event");
const {
    assertCustomerReadiness
} = require("../onboarding/customer-readiness-service");
const { requireTenantId } = require("./tenant-id");
const { TENANT_STATUSES } = require("./tenant-record");

const LIFECYCLE_ACTIONS = Object.freeze({
    activate: Object.freeze({
        from: "provisioning",
        to: "active",
        auditAction: "tenant.lifecycle.activated",
        readinessMode: "activate"
    }),
    suspend: Object.freeze({
        from: "active",
        to: "suspended",
        auditAction: "tenant.lifecycle.suspended",
        readinessMode: null
    }),
    resume: Object.freeze({
        from: "suspended",
        to: "active",
        auditAction: "tenant.lifecycle.resumed",
        readinessMode: "resume"
    }),
    archive: Object.freeze({
        from: "suspended",
        to: "archived",
        auditAction: "tenant.lifecycle.archived",
        readinessMode: null
    })
});

function lifecycleError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    const tenantId = requireTenantId(value);

    if (tenantId !== value) {
        throw new TypeError("Lifecycle tenant kimliği canonical olmalı.");
    }

    return tenantId;
}

function requireActorId(value) {
    const actorId = String(value ?? "").trim();

    if (actorId.length < 1 || actorId.length > 200) {
        throw new TypeError("Lifecycle actor kimliği gerekli.");
    }

    return actorId;
}

function requireClockDate(clock) {
    const now = clock();

    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw lifecycleError(
            "TENANT_LIFECYCLE_UNAVAILABLE",
            "Tenant lifecycle işlemi şu anda kullanılamıyor."
        );
    }

    return now;
}

function createTenantLifecycleService({
    tenantRegistry,
    customerReadinessService = null,
    clock = () => new Date()
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function" ||
        typeof tenantRegistry.update !== "function") {
        throw new TypeError("Tenant lifecycle registry getById/update metodlarını uygulamalı.");
    }
    if (customerReadinessService &&
        typeof customerReadinessService.evaluate !== "function") {
        throw new TypeError("Tenant lifecycle readiness service geçersiz.");
    }
    if (typeof clock !== "function") {
        throw new TypeError("Tenant lifecycle clock gerekli.");
    }

    function unavailable() {
        throw lifecycleError(
            "TENANT_LIFECYCLE_UNAVAILABLE",
            "Tenant lifecycle işlemi şu anda kullanılamıyor."
        );
    }

    function snapshotTenant(tenant) {
        try {
            return structuredClone(tenant);
        } catch {
            unavailable();
        }
    }

    async function loadTenant(tenantId) {
        let tenant;
        try {
            tenant = await tenantRegistry.getById(tenantId);
        } catch {
            unavailable();
        }

        if (!tenant) {
            throw lifecycleError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
        }

        try {
            if (!tenant || typeof tenant !== "object" || Array.isArray(tenant) ||
                requireCanonicalTenantId(tenant.tenantId) !== tenantId ||
                !TENANT_STATUSES.has(tenant.status)) {
                unavailable();
            }
        } catch (error) {
            if (error?.code === "TENANT_LIFECYCLE_UNAVAILABLE") {
                throw error;
            }
            unavailable();
        }

        return tenant;
    }

    async function evaluateReadiness(tenantId, tenant, mode) {
        if (!customerReadinessService) {
            unavailable();
        }

        let readiness;
        try {
            readiness = assertCustomerReadiness(
                await customerReadinessService.evaluate({ tenantId, tenant })
            );
        } catch {
            unavailable();
        }

        if (readiness.tenantId !== tenantId ||
            readiness.lifecycleStatus !== tenant.status) {
            unavailable();
        }

        if (mode === "activate") {
            if (readiness.activationReadiness !== "ready" ||
                readiness.canActivate !== true) {
                throw lifecycleError(
                    "TENANT_ACTIVATION_NOT_READY",
                    "Tenant aktivasyon için hazır değil."
                );
            }
            return;
        }

        if (readiness.activationReadiness !== "ready" ||
            readiness.canActivate !== false) {
            throw lifecycleError(
                "TENANT_RESUME_NOT_READY",
                "Tenant resume için hazır değil."
            );
        }
    }

    async function transition(action, input) {
        const policy = LIFECYCLE_ACTIONS[action];
        const tenantId = requireCanonicalTenantId(input?.tenantId);
        const actorId = requireActorId(input?.actorId);

        if (typeof tenantRegistry.commitLifecycleTransition !== "function") {
            unavailable();
        }

        const current = await loadTenant(tenantId);
        const expected = snapshotTenant(current);
        if (expected.status !== policy.from) {
            throw lifecycleError(
                "TENANT_LIFECYCLE_INVALID_TRANSITION",
                "Tenant lifecycle geçişine izin verilmiyor."
            );
        }

        if (policy.readinessMode) {
            await evaluateReadiness(tenantId, current, policy.readinessMode);
            const fresh = await loadTenant(tenantId);
            if (!isDeepStrictEqual(fresh, expected)) {
                throw lifecycleError(
                    "TENANT_LIFECYCLE_STATE_CHANGED",
                    "Tenant lifecycle durumu değişti; işlem yeniden değerlendirilmeli."
                );
            }
        }

        const now = requireClockDate(clock);
        const next = Object.freeze({
            ...expected,
            status: policy.to,
            updatedAt: now.toISOString(),
            updatedBy: actorId
        });
        const auditEvent = createAuditEvent({
            tenantId,
            action: policy.auditAction,
            actorId,
            requestId: input?.requestId || null,
            metadata: {
                fromStatus: policy.from,
                toStatus: policy.to
            },
            now
        });

        let updated;
        try {
            updated = await tenantRegistry.commitLifecycleTransition({
                tenantId,
                expectedTenant: expected,
                nextTenant: next,
                auditEvent
            });
        } catch (error) {
            if (error?.code === "TENANT_LIFECYCLE_STATE_CHANGED") {
                throw lifecycleError(
                    "TENANT_LIFECYCLE_STATE_CHANGED",
                    "Tenant lifecycle durumu değişti; işlem yeniden değerlendirilmeli."
                );
            }
            unavailable();
        }

        if (!updated || typeof updated !== "object" ||
            !isDeepStrictEqual(updated, next)) {
            unavailable();
        }

        return updated;
    }

    return Object.freeze({
        activate(input) {
            return transition("activate", input);
        },
        suspend(input) {
            return transition("suspend", input);
        },
        resume(input) {
            return transition("resume", input);
        },
        archive(input) {
            return transition("archive", input);
        }
    });
}

module.exports = {
    LIFECYCLE_ACTIONS,
    createTenantLifecycleService
};
