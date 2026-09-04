const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { assertPlacementTenant } = require("../routing/tenant-placement");

const MIGRATION_STAGES = Object.freeze([
    "planned", "dry_run", "preflight_passed", "copied", "verified", "cutover", "complete",
    "rolled_back", "forward_fix_required"
]);

function requirePlatformAdmin(context) {
    if (context?.role !== "platform_admin") {
        const error = new Error("Tenant placement migration Platform Admin gerektirir.");
        error.code = "PERMISSION_DENIED";
        throw error;
    }
}

function requireMigrationId(value) {
    const id = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{7,127}$/.test(id)) throw new TypeError("Migration id geçersiz.");
    return id;
}

function createTenantPlacementMigrationService({
    store,
    adapter,
    backupGate,
    readinessGate,
    auditWriter = null,
    now = () => new Date()
}) {
    if (!store || typeof store.get !== "function" || typeof store.save !== "function" ||
        typeof store.listByTenant !== "function") {
        throw new TypeError("Tenant migration store get/save/listByTenant gerekli.");
    }
    for (const method of ["copy", "verify", "cutover"]) {
        if (!adapter || typeof adapter[method] !== "function") {
            throw new TypeError(`Tenant migration adapter ${method} gerekli.`);
        }
    }
    if (typeof backupGate !== "function" || typeof readinessGate !== "function") {
        throw new TypeError("Tenant migration backup/readiness gate gerekli.");
    }
    if (auditWriter && typeof auditWriter.write !== "function") {
        throw new TypeError("Tenant migration audit writer geçersiz.");
    }

    function timestamp() {
        const value = now();
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new TypeError("Tenant migration clock geçersiz.");
        }
        return value.toISOString();
    }

    function assertBindings(record, expectedTenantId = record.tenantId) {
        const tenantId = requireTenantId(expectedTenantId);
        if (requireTenantId(record.tenantId) !== tenantId ||
            requireTenantId(record.sourceTenantId) !== tenantId ||
            requireTenantId(record.destinationTenantId) !== tenantId) {
            const error = new Error("Migration tenant binding uyuşmuyor.");
            error.code = "TENANT_BOUNDARY_VIOLATION";
            throw error;
        }
        assertPlacementTenant(record.sourcePlacement, tenantId);
        assertPlacementTenant(record.destinationPlacement, tenantId);
        return tenantId;
    }

    async function audit(record, action, context, requestId) {
        if (!auditWriter) return;
        await auditWriter.write({
            tenantId: record.tenantId,
            action,
            actorId: context.actorId || null,
            requestId,
            metadata: {
                migrationId: record.migrationId,
                state: record.state,
                sourcePlacementType: record.sourcePlacement.placementType,
                destinationPlacementType: record.destinationPlacement.placementType
            }
        });
    }

    async function load(migrationId, tenantId = null) {
        const record = await store.get(requireMigrationId(migrationId));
        if (!record) {
            const error = new Error("Tenant migration bulunamadı.");
            error.code = "MIGRATION_NOT_FOUND";
            throw error;
        }
        assertBindings(record, tenantId || record.tenantId);
        return record;
    }

    async function saveStage(record, state, context, requestId) {
        const next = Object.freeze({
            ...record,
            state,
            completedStages: Object.freeze([...new Set([...record.completedStages, state])]),
            updatedAt: timestamp()
        });
        await store.save(next);
        await audit(next, `tenant.migration.${state}`, context, requestId);
        return next;
    }

    function requireApply({ apply, confirmationTenantId }, tenantId) {
        let confirmedTenantId = null;
        try {
            confirmedTenantId = requireTenantId(confirmationTenantId);
        } catch {
            confirmedTenantId = null;
        }
        if (apply !== true || confirmedTenantId !== tenantId) {
            const error = new Error("Migration apply için exact tenant onayı gerekli.");
            error.code = "MIGRATION_CONFIRMATION_FAILED";
            throw error;
        }
    }

    async function plan({
        context, migrationId, tenantId: rawTenantId, sourceTenantId = rawTenantId,
        destinationTenantId = rawTenantId, sourcePlacement, destinationPlacement,
        forwardFixCode = "manual-forward-fix", requestId = null
    }) {
        requirePlatformAdmin(context);
        const tenantId = requireTenantId(rawTenantId);
        if (requireTenantId(sourceTenantId) !== tenantId || requireTenantId(destinationTenantId) !== tenantId) {
            const error = new Error("Migration source/destination tenant binding uyuşmuyor.");
            error.code = "TENANT_BOUNDARY_VIOLATION";
            throw error;
        }
        const id = requireMigrationId(migrationId);
        const existing = await store.get(id);
        if (existing) {
            assertBindings(existing, tenantId);
            return existing;
        }
        const safeForwardFix = String(forwardFixCode ?? "").trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(safeForwardFix)) {
            throw new TypeError("Migration forwardFixCode geçersiz.");
        }
        const createdAt = timestamp();
        const record = Object.freeze({
            migrationId: id,
            tenantId,
            sourceTenantId: tenantId,
            destinationTenantId: tenantId,
            sourcePlacement: assertPlacementTenant(sourcePlacement, tenantId),
            destinationPlacement: assertPlacementTenant(destinationPlacement, tenantId),
            state: "planned",
            completedStages: Object.freeze(["planned"]),
            forwardFixCode: safeForwardFix,
            createdAt,
            updatedAt: createdAt
        });
        await store.save(record);
        await audit(record, "tenant.migration.planned", context, requestId);
        return record;
    }

    async function dryRun({ context, migrationId, tenantId, requestId = null }) {
        requirePlatformAdmin(context);
        const record = await load(migrationId, tenantId);
        if (record.completedStages.includes("dry_run")) return record;
        if (record.state !== "planned") throw new Error("Migration dry-run sırası geçersiz.");
        return saveStage(record, "dry_run", context, requestId);
    }

    async function preflight({ context, migrationId, tenantId, requestId = null }) {
        requirePlatformAdmin(context);
        const record = await load(migrationId, tenantId);
        if (record.completedStages.includes("preflight_passed")) return record;
        if (record.state !== "dry_run") throw new Error("Migration preflight sırası geçersiz.");
        const [backup, readiness] = await Promise.all([
            backupGate({ tenantId: record.tenantId }),
            readinessGate({ tenantId: record.tenantId })
        ]);
        if (!(backup === true || backup?.verified === true)) {
            const error = new Error("Migration backup gate başarısız.");
            error.code = "MIGRATION_BACKUP_GATE_FAILED";
            throw error;
        }
        if (!(readiness === true || readiness?.ready === true)) {
            const error = new Error("Migration readiness gate başarısız.");
            error.code = "MIGRATION_READINESS_GATE_FAILED";
            throw error;
        }
        return saveStage(record, "preflight_passed", context, requestId);
    }

    async function advance({
        context, migrationId, tenantId, stage, apply = false,
        confirmationTenantId = null, requestId = null
    }) {
        requirePlatformAdmin(context);
        const record = await load(migrationId, tenantId);
        const target = String(stage ?? "").trim().toLowerCase();
        const transitions = {
            copy: ["preflight_passed", "copied"],
            verify: ["copied", "verified"],
            cutover: ["verified", "cutover"],
            complete: ["cutover", "complete"]
        };
        if (!transitions[target]) throw new TypeError("Migration stage geçersiz.");
        const [, completedState] = transitions[target];
        if (record.completedStages.includes(completedState)) return record;
        requireApply({ apply, confirmationTenantId }, record.tenantId);
        if (record.state !== transitions[target][0]) throw new Error("Migration stage sırası geçersiz.");

        if (target === "copy") await adapter.copy({ ...record });
        if (target === "verify") {
            const verified = await adapter.verify({ ...record });
            if (verified !== true) {
                const error = new Error("Migration copy verify başarısız.");
                error.code = "MIGRATION_VERIFY_FAILED";
                throw error;
            }
        }
        if (target === "cutover") await adapter.cutover({ ...record });
        return saveStage(record, completedState, context, requestId);
    }

    async function rollback({
        context, migrationId, tenantId, apply = false,
        confirmationTenantId = null, requestId = null
    }) {
        requirePlatformAdmin(context);
        const record = await load(migrationId, tenantId);
        if (record.state === "rolled_back" || record.state === "forward_fix_required") return record;
        requireApply({ apply, confirmationTenantId }, record.tenantId);
        if (typeof adapter.rollback !== "function") {
            return saveStage(record, "forward_fix_required", context, requestId);
        }
        await adapter.rollback({ ...record });
        return saveStage(record, "rolled_back", context, requestId);
    }

    async function getTenantStatus({ context, tenantId: rawTenantId }) {
        const tenantId = requireTenantId(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: "tenant.migration.read" });
        const records = await store.listByTenant(tenantId);
        if (records.length === 0) {
            return Object.freeze({ state: "idle", migrationId: null, updatedAt: null });
        }
        const record = records[0];
        assertBindings(record, tenantId);
        return Object.freeze({
            state: record.state,
            migrationId: record.migrationId,
            sourcePlacementType: record.sourcePlacement.placementType,
            destinationPlacementType: record.destinationPlacement.placementType,
            updatedAt: record.updatedAt
        });
    }

    return Object.freeze({ plan, dryRun, preflight, advance, rollback, getTenantStatus });
}

module.exports = {
    MIGRATION_STAGES,
    requireMigrationId,
    createTenantPlacementMigrationService
};
