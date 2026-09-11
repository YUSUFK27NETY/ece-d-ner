const { createPlatformFirebase } = require("./src/firebase/create-platform-firebase");
const { createFirestoreTenantRegistry } = require("./src/firestore/firestore-tenant-registry");
const { createFirestoreAuditWriter } = require("./src/firestore/firestore-audit-writer");
const { createFirestoreAuditReader } = require("./src/firestore/firestore-audit-reader");
const { createFirestoreProductRepository } = require("./src/firestore/firestore-product-repository");
const { createFirestoreOrderRepository } = require("./src/firestore/firestore-order-repository");
const {
    createFirestoreTenantMemberBindingRepository
} = require("./src/firestore/firestore-tenant-member-binding-repository");
const {
    createFirestoreAdminBootstrapEvidenceProvider
} = require("./src/firestore/firestore-admin-bootstrap-evidence-provider");
const {
    createFirestoreSecurityReviewEvidenceProvider
} = require("./src/firestore/firestore-security-review-evidence-provider");
const {
    createFirestoreSecurityReviewEvidenceWriter
} = require("./src/firestore/firestore-security-review-evidence-writer");
const {
    createFirestorePublicRouteReader
} = require("./src/firestore/firestore-public-route-reader");
const { createPlatformApp } = require("./src/http/create-platform-app");
const { attachCatalogAdminEndpoints } = require("./src/http/attach-catalog-admin-endpoints");
const { attachOrderAdminEndpoints } = require("./src/http/attach-order-admin-endpoints");
const {
    attachSectorTemplateEndpoints
} = require("./src/http/attach-sector-template-endpoints");
const {
    attachTenantMemberIdentityEndpoints
} = require("./src/http/attach-tenant-member-identity-endpoints");
const {
    attachTenantOwnerRuntime
} = require("./src/http/attach-tenant-owner-runtime");
const {
    attachSecurityLaunchReviewEndpoint
} = require("./src/http/attach-security-launch-review-endpoint");
const {
    attachConfiguredBackupConnectivityDiagnosticEndpoint
} = require("./src/http/attach-backup-connectivity-diagnostic-endpoint");
const {
    attachConfiguredPublicOrderRuntime
} = require("./src/http/attach-configured-public-order-runtime");
const {
    attachLastAuditEndpoint
} = require("./src/http/attach-last-audit-endpoint");
const {
    createLastAuditReadModel
} = require("./src/audit/last-audit-read-model");
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
const {
    createFirestoreSecurityAlertSink
} = require("./src/firestore/firestore-security-alert-sink");
const { createSecurityAlertService } = require("./src/security/security-alert-service");
const { createSecurityPostureService } = require("./src/security/security-posture-service");
const {
    createSecurityOperationsBridge
} = require("./src/security/security-operations-bridge");
const { createTenantRateLimiter } = require("./src/security/tenant-rate-limiter");
const { createEntitlementService } = require("./src/entitlements/entitlement-service");
const { createCatalogService } = require("./src/catalog/catalog-service");
const { createOrderService } = require("./src/orders/order-service");
const {
    createCommercialPlanPreviewService
} = require("./src/entitlements/commercial-plan-preview-service");
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
const {
    createCustomerReadinessService
} = require("./src/onboarding/customer-readiness-service");
const {
    createCustomerReadinessSourceAdapters
} = require("./src/onboarding/customer-readiness-adapters");
const {
    createPlanReadinessAdapter
} = require("./src/onboarding/plan-readiness-adapter");
const {
    addAdminBootstrapReadinessSource
} = require("./src/onboarding/admin-bootstrap-readiness-adapter");
const {
    addSecurityReadinessSource
} = require("./src/onboarding/security-readiness-adapter");
const {
    createDomainReadinessService
} = require("./src/onboarding/domain-readiness-service");
const {
    createPublicRouteDomainEvidenceProvider
} = require("./src/onboarding/public-route-domain-evidence-provider");
const {
    createTenantInitialOwnerBootstrapService
} = require("./src/onboarding/tenant-initial-owner-bootstrap-service");
const {
    createSecurityLaunchReviewService
} = require("./src/onboarding/security-launch-review-service");

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

function createRuntimeDomainReadinessService({ db, clock = Date.now }) {
    const routeReader = createFirestorePublicRouteReader({ db });
    const evidenceProvider = createPublicRouteDomainEvidenceProvider({ routeReader });
    return createDomainReadinessService({ evidenceProvider, clock });
}

function createRuntimeSecurityOperations({ db, config, securityAlertSink = null }) {
    const sink = securityAlertSink || createFirestoreSecurityAlertSink({ db });
    const alertService = createSecurityAlertService({ sink, config });
    return createSecurityOperationsBridge({ alertService });
}

function startPlatformServer() {
    const guardrailsConfig = loadPlatformGuardrailsConfig();
    const scalabilityConfig = loadPlatformScalabilityConfig();
    const { auth, db } = createPlatformFirebase();
    const tenantRegistry = createFirestoreTenantRegistry({ db });
    const tenantMemberBindingRepository =
        createFirestoreTenantMemberBindingRepository({ db });
    const initialOwnerBootstrapService = createTenantInitialOwnerBootstrapService({
        auth,
        tenantRegistry,
        bindingRepository: tenantMemberBindingRepository
    });
    const auditWriter = createFirestoreAuditWriter({ db });
    const auditReader = createFirestoreAuditReader({ db });
    const lastAuditReadModel = createLastAuditReadModel({ auditReader });
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
    const securityAlertReader = createFirestoreSecurityAlertSink({ db });
    const securityOperations = createRuntimeSecurityOperations({
        db,
        config: guardrailsConfig.security.alerts,
        securityAlertSink: securityAlertReader
    });
    const abuseMonitor = createAbuseMonitor({
        securitySignals,
        securityOperations,
        windowMs: guardrailsConfig.security.authFailureWindowMs,
        threshold: guardrailsConfig.security.authFailureThreshold
    });
    const securityPostureService = createSecurityPostureService({
        securityAlertReader,
        stepUpConfig: guardrailsConfig.security.stepUp
    });
    const entitlementService = createEntitlementService({
        config: guardrailsConfig,
        securitySignals
    });
    const productRepository = createFirestoreProductRepository({ db });
    const catalogService = createCatalogService({
        tenantRegistry,
        productRepository,
        entitlementService
    });
    const orderRepository = createFirestoreOrderRepository({ db });
    const orderService = createOrderService({
        tenantRegistry,
        productRepository,
        orderRepository,
        entitlementService
    });
    const commercialPlanPreviewService = createCommercialPlanPreviewService({
        config: guardrailsConfig,
        entitlementService
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
    const domainReadinessService = createRuntimeDomainReadinessService({ db });
    const adminBootstrapEvidenceProvider =
        createFirestoreAdminBootstrapEvidenceProvider({ db });
    const securityReviewEvidenceProvider =
        createFirestoreSecurityReviewEvidenceProvider({ db });
    const securityReviewEvidenceWriter =
        createFirestoreSecurityReviewEvidenceWriter({ db });
    const securityLaunchReviewService = createSecurityLaunchReviewService({
        tenantRegistry,
        securityAlertReader,
        evidenceWriter: securityReviewEvidenceWriter
    });
    const customerReadinessService = createCustomerReadinessService({
        sourceAdapters: addSecurityReadinessSource({
            sourceAdapters: addAdminBootstrapReadinessSource({
                sourceAdapters: Object.freeze({
                    ...createCustomerReadinessSourceAdapters({
                        checkReadiness,
                        backupEvidenceProvider,
                        domainReadinessService
                    }),
                    plan: createPlanReadinessAdapter({
                        guardrailsConfig,
                        entitlementService
                    })
                }),
                evidenceProvider: adminBootstrapEvidenceProvider
            }),
            reviewEvidenceProvider: securityReviewEvidenceProvider,
            securityAlertReader
        })
    });
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
        securityOperations,
        securityAlertReader,
        securityPostureService,
        customerReadinessService,
        commercialPlanPreviewService,
        tenantOperations,
        finOpsService
    });
    attachSectorTemplateEndpoints({ app });
    attachTenantMemberIdentityEndpoints({
        app,
        auth,
        bindingReader: tenantMemberBindingRepository,
        initialOwnerBootstrapService,
        allowedOrigins
    });
    attachTenantOwnerRuntime({
        app,
        webConfig,
        tenantRegistry,
        catalogService,
        orderService
    });
    attachSecurityLaunchReviewEndpoint({
        app,
        securityLaunchReviewService
    });
    attachConfiguredBackupConnectivityDiagnosticEndpoint({
        app,
        tenantRegistry
    });
    attachCatalogAdminEndpoints({ app, catalogService });
    attachOrderAdminEndpoints({ app, orderService });
    attachConfiguredPublicOrderRuntime({
        app,
        db,
        tenantRegistry,
        orderService
    });
    attachLastAuditEndpoint({
        app,
        tenantRegistry,
        lastAuditReadModel
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
    createRuntimeDomainReadinessService,
    createRuntimeSecurityOperations,
    startPlatformServer
};
