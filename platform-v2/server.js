const { createPlatformFirebase } = require("./src/firebase/create-platform-firebase");
const { createFirestoreTenantRegistry } = require("./src/firestore/firestore-tenant-registry");
const { createFirestoreAuditWriter } = require("./src/firestore/firestore-audit-writer");
const { createPlatformApp } = require("./src/http/create-platform-app");
const {
    normalizeFirebaseWebConfig,
    normalizeAllowedOrigins
} = require("./src/config/platform-web-config");
const { createReadinessChecker } = require("./src/observability/readiness-check");
const { createFirestoreReadinessCheck } = require("./src/observability/firestore-readiness");
const { attachReadinessEndpoint } = require("./src/observability/attach-readiness-endpoint");
const { loadPlatformGuardrailsConfig } = require("./src/config/platform-guardrails-config");
const { loadPlatformScalabilityConfig } = require("./src/config/platform-scalability-config");
const { createFirestoreUsageStore } = require("./src/firestore/firestore-usage-store");
const { createUsageTelemetryService } = require("./src/usage/usage-telemetry");
const {
    createFirestoreSecuritySignalStore
} = require("./src/firestore/firestore-security-signal-store");
const { createSecuritySignalService } = require("./src/security/security-signal");
const { createAbuseMonitor } = require("./src/security/abuse-monitor");
const { createTenantRateLimiter } = require("./src/security/tenant-rate-limiter");
const { createEntitlementService } = require("./src/entitlements/entitlement-service");
const { createConfigCostProvider } = require("./src/finops/cost-provider");
const { createFinOpsService } = require("./src/finops/finops-service");
const { createTenantOperationsService } = require("./src/operations/tenant-operations-service");
const { loadR2BackupConfig } = require("./src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("./src/storage/r2-object-storage-provider");
const {
    createBackupOperationsEvidenceProvider
} = require("./src/backup/backup-operations-evidence");
const { createCapacitySloService } = require("./src/capacity/capacity-slo-service");
const { createFirestorePlacementRegistry } = require("./src/firestore/firestore-placement-registry");
const { createTenantRoutingService } = require("./src/routing/tenant-routing-service");
const { createTenantJobQueue } = require("./src/queue/tenant-job-queue");
const { createTenantCache } = require("./src/cache/tenant-cache");
const { createInMemoryRolloutStore } = require("./src/rollout/in-memory-rollout-store");
const { createTenantReleaseRolloutService } = require("./src/rollout/tenant-release-rollout");
const { createDependencyResilienceService } = require("./src/resilience/dependency-resilience");

const R2_BACKUP_CONFIG_KEYS = Object.freeze([
    "PLATFORM_BACKUP_R2_ENDPOINT",
    "PLATFORM_BACKUP_R2_BUCKET",
    "PLATFORM_BACKUP_R2_ACCESS_KEY_ID",
    "PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY"
]);

function createConfiguredBackupEvidenceProvider({ db, env = process.env }) {
    const configured = R2_BACKUP_CONFIG_KEYS.filter(key =>
        String(env[key] ?? "").trim().length > 0
    );

    if (configured.length === 0) {
        return null;
    }

    const storageProvider = createR2ObjectStorageProvider(loadR2BackupConfig(env));
    return createBackupOperationsEvidenceProvider({ storageProvider, db });
}

function startPlatformServer() {
    const guardrailsConfig = loadPlatformGuardrailsConfig();
    const scalabilityConfig = loadPlatformScalabilityConfig();
    const { auth, db } = createPlatformFirebase();
    const tenantRegistry = createFirestoreTenantRegistry({ db });
    const auditWriter = createFirestoreAuditWriter({ db });
    const webConfig = normalizeFirebaseWebConfig(
        process.env.PLATFORM_FIREBASE_WEB_CONFIG_JSON
    );
    const allowedOrigins = normalizeAllowedOrigins(
        process.env.PLATFORM_ALLOWED_ORIGINS
    );
    const readinessTimeoutMs = process.env.PLATFORM_READINESS_TIMEOUT_MS === undefined
        ? 3000
        : Number(process.env.PLATFORM_READINESS_TIMEOUT_MS);
    const resilienceService = createDependencyResilienceService({ config: scalabilityConfig });
    const firestoreReadiness = createFirestoreReadinessCheck({ db });
    const checkReadiness = createReadinessChecker({
        timeoutMs: readinessTimeoutMs,
        checks: {
            firestore: () => resilienceService.execute({
                dependency: "firestore",
                operation: firestoreReadiness
            })
        }
    });
    const usageTelemetry = createUsageTelemetryService({
        store: createFirestoreUsageStore({ db })
    });
    const securitySignals = createSecuritySignalService({
        store: createFirestoreSecuritySignalStore({ db })
    });
    const abuseMonitor = createAbuseMonitor({
        securitySignals,
        windowMs: guardrailsConfig.security.authFailureWindowMs,
        threshold: guardrailsConfig.security.authFailureThreshold
    });
    const entitlementService = createEntitlementService({
        config: guardrailsConfig,
        securitySignals
    });
    const finOpsService = createFinOpsService({
        config: guardrailsConfig,
        costProvider: createConfigCostProvider({
            finopsConfig: guardrailsConfig.finops
        }),
        usageTelemetry,
        tenantRegistry,
        securitySignals
    });
    const backupEvidenceProvider = createConfiguredBackupEvidenceProvider({ db });
    const capacityService = createCapacitySloService({ config: scalabilityConfig });
    const routingService = createTenantRoutingService({
        registry: createFirestorePlacementRegistry({ db }),
        auditWriter,
        cacheTtlMs: scalabilityConfig.routing.cacheTtlMs
    });
    const jobQueue = createTenantJobQueue({ config: scalabilityConfig });
    const tenantCache = createTenantCache({ config: scalabilityConfig });
    const rolloutService = createTenantReleaseRolloutService({
        store: createInMemoryRolloutStore(),
        auditWriter
    });
    const tenantOperations = createTenantOperationsService({
        tenantRegistry,
        usageTelemetry,
        entitlementService,
        finOpsService,
        securitySignals,
        backupEvidenceProvider,
        checkReadiness,
        capacityService,
        routingService,
        jobQueue,
        tenantCache,
        rolloutService,
        resilienceService,
        signalListLimit: guardrailsConfig.security.signalListLimit
    });
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        auditWriter,
        webConfig,
        allowedOrigins,
        usageTelemetry,
        tenantRateLimiter: createTenantRateLimiter(),
        tenantRateLimitPolicy: guardrailsConfig.rateLimits.adminTenant,
        securitySignals,
        abuseMonitor,
        tenantOperations,
        finOpsService
    });
    attachReadinessEndpoint({ app, checkReadiness });

    const port = Number(process.env.PLATFORM_PORT || process.env.PORT || 3100);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("Geçersiz PLATFORM_PORT/PORT değeri.");
    }

    return app.listen(port, () => {
        console.log(`Platform V2 Admin API ${port} portunda hazır.`);
    });
}

if (require.main === module) {
    startPlatformServer();
}

module.exports = {
    R2_BACKUP_CONFIG_KEYS,
    createConfiguredBackupEvidenceProvider,
    startPlatformServer
};
