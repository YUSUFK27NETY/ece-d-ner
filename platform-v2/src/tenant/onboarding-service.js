const { createTenantRecord } = require("./tenant-record");
const { createAuditEvent } = require("../audit/audit-event");

function assertTenantRegistry(registry) {
    for (const method of ["getById", "create"]) {
        if (!registry || typeof registry[method] !== "function") {
            throw new TypeError(`Tenant registry ${method} metodunu uygulamalı.`);
        }
    }

    return registry;
}

function createTenantOnboardingService({ tenantRegistry, auditWriter = null }) {
    const registry = assertTenantRegistry(tenantRegistry);

    if (auditWriter && typeof auditWriter.write !== "function") {
        throw new TypeError("Audit writer write metodunu uygulamalı.");
    }

    return Object.freeze({
        async onboard(input) {
            const tenant = createTenantRecord(input);
            const existing = await registry.getById(tenant.tenantId);

            if (existing) {
                const error = new Error("Tenant zaten mevcut.");
                error.code = "TENANT_ALREADY_EXISTS";
                throw error;
            }

            await registry.create(tenant);

            if (auditWriter) {
                await auditWriter.write(
                    createAuditEvent({
                        tenantId: tenant.tenantId,
                        action: "tenant.created",
                        actorId: tenant.createdBy,
                        metadata: {
                            sector: tenant.sector,
                            plan: tenant.plan
                        }
                    })
                );
            }

            return tenant;
        }
    });
}

module.exports = {
    assertTenantRegistry,
    createTenantOnboardingService
};
