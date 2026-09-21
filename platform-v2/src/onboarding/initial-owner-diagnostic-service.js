const { requireTenantId } = require("../tenant/tenant-id");

function fail(label) {
    throw new TypeError(`Initial owner diagnostic ${label} geçersiz.`);
}

function codedError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function classify(state) {
    if (state.ownerBinding.exists) {
        if (!state.ownerBinding.valid) return "OWNER_BINDING_INVALID";
        if (state.member.checked !== true || state.member.exists !== true ||
            state.member.valid !== true || state.member.state !== "active") {
            return "OWNER_BINDING_PARTIAL";
        }
        if (state.evidence.exists !== true || state.evidence.valid !== true ||
            state.evidence.state !== "verified") {
            return "OWNER_BINDING_PARTIAL";
        }
        if (state.invite.exists) return "OWNER_BOUND_WITH_STALE_INVITE";
        return "OWNER_BOUND_CONSISTENT";
    }

    if (state.evidence.exists) {
        return state.evidence.valid ? "EVIDENCE_WITHOUT_OWNER_BINDING" : "EVIDENCE_INVALID";
    }
    if (state.invite.exists) {
        if (!state.invite.valid) return "INVITE_INVALID";
        if (state.invite.expired === true) return "INVITE_EXPIRED";
        return "INVITE_PENDING";
    }
    return "READY_FOR_INVITE";
}

function createInitialOwnerDiagnosticService({ tenantRegistry, stateReader }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        fail("tenant registry");
    }
    if (!stateReader || typeof stateReader.read !== "function") {
        fail("state reader");
    }

    return Object.freeze({
        async diagnose({ context, tenantId: rawTenantId } = {}) {
            if (!context || context.role !== "platform_admin" ||
                typeof context.actorId !== "string" || !context.actorId.trim()) {
                fail("actor");
            }
            if (typeof rawTenantId !== "string") fail("tenantId");
            const tenantId = requireTenantId(rawTenantId);
            if (tenantId !== rawTenantId) fail("tenantId");

            const tenant = await tenantRegistry.getById(tenantId);
            if (!tenant) {
                throw codedError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
            }
            if (tenant.tenantId !== tenantId || tenant.id !== tenantId) {
                throw codedError("TENANT_DIAGNOSTIC_UNAVAILABLE", "İşletme durumu doğrulanamadı.");
            }

            const state = await stateReader.read({ tenantId });
            if (!state || state.tenantId !== tenantId) {
                throw codedError("TENANT_DIAGNOSTIC_UNAVAILABLE", "Owner durumu doğrulanamadı.");
            }

            const lifecycleEligible = tenant.status === "provisioning";
            const blockedByOwnerBinding = state.ownerBinding.exists === true;
            return Object.freeze({
                tenantId,
                tenantStatus: tenant.status,
                code: classify(state),
                inviteCreate: Object.freeze({
                    lifecycleEligible,
                    blockedByOwnerBinding,
                    wouldPassRepositoryPreconditions: lifecycleEligible && !blockedByOwnerBinding
                }),
                artifacts: Object.freeze({
                    ownerBinding: state.ownerBinding,
                    invite: state.invite,
                    evidence: state.evidence,
                    member: state.member
                })
            });
        }
    });
}

module.exports = {
    classify,
    createInitialOwnerDiagnosticService
};
