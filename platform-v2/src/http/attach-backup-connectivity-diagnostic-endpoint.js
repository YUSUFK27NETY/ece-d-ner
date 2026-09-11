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
const BACKUP_DRILL_TENANT_ENV = "PLATFORM_BACKUP_DRILL_TENANT_ID";
const PHASE9_ACTIVATION_TENANT_ENV = "PLATFORM_PHASE9_ACTIVATE_TENANT_ID";
const PHASE9_ACCEPTANCE_TENANT_ENV = "PLATFORM_PHASE9_ACCEPTANCE_TENANT_ID";
const PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV =
    "PLATFORM_PHASE9_ACCEPTANCE_BASELINE_TENANT_ID";
const PHASE9_ROUTE_FIXTURE_TENANT_ENV = "PLATFORM_PHASE9_ROUTE_FIXTURE_TENANT_ID";
const PHASE9_ROUTE_FIXTURE_MODE_ENV = "PLATFORM_PHASE9_ROUTE_FIXTURE_MODE";

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

function scheduleConfiguredBackupDrill({
    env = process.env,
    schedule = setImmediate,
    loadDrill = () => require("../../scripts/run-backup-drill")
} = {}) {
    const tenantId = String(env[BACKUP_DRILL_TENANT_ENV] ?? "").trim();
    if (!tenantId) {
        return false;
    }

    schedule(() => {
        loadDrill();
    });
    return true;
}

function scheduleConfiguredPhase9Activation({
    env = process.env,
    schedule = fn => setTimeout(fn, 1500),
    loadActivation = () => require("../../scripts/run-phase9-controlled-activation")
} = {}) {
    const tenantId = String(env[PHASE9_ACTIVATION_TENANT_ENV] ?? "").trim();
    if (!tenantId) {
        return false;
    }

    schedule(() => {
        const activation = loadActivation();
        if (!activation || typeof activation.runPhase9ControlledActivation !== "function") {
            console.error("PHASE9_ACTIVATION_FAILED stage=scheduler code=ACTIVATION_RUNNER_INVALID");
            return;
        }
        void activation.runPhase9ControlledActivation(env);
    });
    return true;
}

function scheduleConfiguredPhase9Acceptance({
    env = process.env,
    schedule = fn => setTimeout(fn, 1500),
    loadAcceptance = () => require("../../scripts/run-phase9-live-acceptance")
} = {}) {
    const tenantId = String(env[PHASE9_ACCEPTANCE_TENANT_ENV] ?? "").trim();
    const baselineTenantId = String(
        env[PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV] ?? ""
    ).trim();
    if (!tenantId || !baselineTenantId) {
        return false;
    }

    schedule(() => {
        const acceptance = loadAcceptance();
        if (!acceptance || typeof acceptance.runPhase9LiveAcceptance !== "function") {
            console.error("PHASE9_LIVE_ACCEPTANCE_FAILED stage=scheduler code=ACCEPTANCE_RUNNER_INVALID");
            return;
        }
        void acceptance.runPhase9LiveAcceptance(env);
    });
    return true;
}

function scheduleConfiguredPhase9RouteFixture({
    env = process.env,
    schedule = fn => setTimeout(fn, 1500),
    loadFixture = () => require("../../scripts/run-phase9-route-fixture")
} = {}) {
    const tenantId = String(env[PHASE9_ROUTE_FIXTURE_TENANT_ENV] ?? "").trim();
    const mode = String(env[PHASE9_ROUTE_FIXTURE_MODE_ENV] ?? "").trim();
    if (!tenantId || !["setup", "cleanup"].includes(mode)) {
        return false;
    }

    schedule(() => {
        const fixture = loadFixture();
        if (!fixture || typeof fixture.runPhase9RouteFixture !== "function") {
            console.error("PHASE9_ROUTE_FIXTURE_FAILED stage=scheduler code=ROUTE_FIXTURE_RUNNER_INVALID");
            return;
        }
        void fixture.runPhase9RouteFixture(env);
    });
    return true;
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
    const attached = attachBackupConnectivityDiagnosticEndpoint({ app, diagnosticService });
    scheduleConfiguredBackupDrill({ env });
    scheduleConfiguredPhase9Activation({ env });
    scheduleConfiguredPhase9Acceptance({ env });
    scheduleConfiguredPhase9RouteFixture({ env });
    return attached;
}

module.exports = {
    BACKUP_CONNECTIVITY_DIAGNOSTIC_PATH,
    R2_BACKUP_CONFIG_KEYS,
    BACKUP_DRILL_TENANT_ENV,
    PHASE9_ACTIVATION_TENANT_ENV,
    PHASE9_ACCEPTANCE_TENANT_ENV,
    PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV,
    PHASE9_ROUTE_FIXTURE_TENANT_ENV,
    PHASE9_ROUTE_FIXTURE_MODE_ENV,
    hasRequestInput,
    sendBackupDiagnosticError,
    scheduleConfiguredBackupDrill,
    scheduleConfiguredPhase9Activation,
    scheduleConfiguredPhase9Acceptance,
    scheduleConfiguredPhase9RouteFixture,
    attachBackupConnectivityDiagnosticEndpoint,
    attachConfiguredBackupConnectivityDiagnosticEndpoint
};
