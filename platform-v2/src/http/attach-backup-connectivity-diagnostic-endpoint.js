const { sendPlatformError } = require("./create-platform-app");
const { loadR2BackupConfig } = require("../config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../storage/r2-object-storage-provider");
const {
    createBackupConnectivityDiagnosticService
} = require("../onboarding/backup-connectivity-diagnostic-service");

const BACKUP_CONNECTIVITY_DIAGNOSTIC_PATH =
    "/api/platform/tenants/:tenantId/backup-diagnostic";
const R2_BACKUP_CONFIG_KEYS = Object.freeze([
    "PLATFORM_BACKUP_R2_ENDPOINT",
    "PLATFORM_BACKUP_R2_BUCKET",
    "PLATFORM_BACKUP_R2_ACCESS_KEY_ID",
    "PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY"
]);

function hasRequestInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        (contentLength !== undefined && contentLength !== "0") ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function sendBackupDiagnosticError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({
            success: false,
            message: "İşletme bulunamadı."
        });
    }
    if (error?.code === "BACKUP_DIAGNOSTIC_INVALID_STATE") {
        return res.status(409).json({
            success: false,
            message: "Backup diagnostic yalnız provisioning tenant için kullanılabilir."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "Backup diagnostic isteği geçersiz."
        });
    }
    return sendPlatformError(res, error);
}

function attachBackupConnectivityDiagnosticEndpoint({ app, diagnosticService }) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Backup connectivity diagnostic endpoint app geçersiz.");
    }
    if (!diagnosticService || typeof diagnosticService.diagnose !== "function") {
        throw new TypeError("Backup connectivity diagnostic service geçersiz.");
    }

    app.get(BACKUP_CONNECTIVITY_DIAGNOSTIC_PATH, async (req, res) => {
        try {
            if (hasRequestInput(req)) {
                throw new TypeError("Backup diagnostic body/query kabul etmez.");
            }
            const diagnostic = await diagnosticService.diagnose({
                context: {
                    role: req.platformActor.role,
                    actorId: req.platformActor.uid
                },
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, diagnostic });
        } catch (error) {
            return sendBackupDiagnosticError(res, error);
        }
    });

    return app;
}

function attachConfiguredBackupConnectivityDiagnosticEndpoint({
    app,
    tenantRegistry,
    env = process.env
}) {
    const configured = R2_BACKUP_CONFIG_KEYS.filter(key =>
        String(env[key] ?? "").trim().length > 0
    );
    if (configured.length === 0) {
        return app;
    }

    const storageProvider = createR2ObjectStorageProvider(loadR2BackupConfig(env));
    const diagnosticService = createBackupConnectivityDiagnosticService({
        tenantRegistry,
        storageProvider
    });
    return attachBackupConnectivityDiagnosticEndpoint({ app, diagnosticService });
}

module.exports = {
    BACKUP_CONNECTIVITY_DIAGNOSTIC_PATH,
    R2_BACKUP_CONFIG_KEYS,
    hasRequestInput,
    sendBackupDiagnosticError,
    attachBackupConnectivityDiagnosticEndpoint,
    attachConfiguredBackupConnectivityDiagnosticEndpoint
};
