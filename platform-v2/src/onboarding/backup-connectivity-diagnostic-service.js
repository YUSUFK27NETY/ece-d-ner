const { requireTenantId } = require("../tenant/tenant-id");
const { tenantBackupPrefix } = require("../backup/backup-key");

const SAFE_R2_ERROR_CODES = new Set([
    "R2_INVALID_LIST_RESPONSE",
    "R2_LIST_PAGE_LIMIT",
    "NOT_FOUND"
]);

function fail(label) {
    throw new TypeError(`Backup connectivity diagnostic ${label} geçersiz.`);
}

function projectStorageError(error) {
    const rawCode = typeof error?.code === "string" ? error.code : "";
    const status = Number.isInteger(error?.status) &&
        error.status >= 400 && error.status <= 599
        ? error.status
        : null;
    const code = /^R2_HTTP_[1-5][0-9]{2}$/.test(rawCode) ||
        SAFE_R2_ERROR_CODES.has(rawCode)
        ? rawCode
        : "R2_REQUEST_FAILED";

    return Object.freeze({ code, status });
}

function createBackupConnectivityDiagnosticService({ tenantRegistry, storageProvider }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        fail("tenant registry");
    }
    if (!storageProvider || typeof storageProvider.listObjects !== "function") {
        fail("storage provider");
    }

    return Object.freeze({
        async diagnose({ context, tenantId: rawTenantId }) {
            if (!context || context.role !== "platform_admin") {
                fail("actor");
            }

            const tenantId = requireTenantId(rawTenantId);
            if (tenantId !== rawTenantId) {
                fail("tenantId");
            }

            const tenant = await tenantRegistry.getById(tenantId);
            if (!tenant) {
                const error = new Error("Tenant bulunamadı.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }
            if (tenant.status !== "provisioning") {
                const error = new Error(
                    "Backup diagnostic yalnız provisioning tenant için kullanılabilir."
                );
                error.code = "BACKUP_DIAGNOSTIC_INVALID_STATE";
                throw error;
            }

            const prefix = tenantBackupPrefix(tenantId);
            try {
                await storageProvider.listObjects({ prefix });
                return Object.freeze({
                    ok: true,
                    tenantId,
                    operation: "listObjects",
                    error: null
                });
            } catch (error) {
                return Object.freeze({
                    ok: false,
                    tenantId,
                    operation: "listObjects",
                    error: projectStorageError(error)
                });
            }
        }
    });
}

module.exports = {
    SAFE_R2_ERROR_CODES,
    projectStorageError,
    createBackupConnectivityDiagnosticService
};
