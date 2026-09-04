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

function startPlatformServer() {
    const guardrailsConfig = loadPlatformGuardrailsConfig();
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
    const checkReadiness = createReadinessChecker({
        timeoutMs: readinessTimeoutMs,
        checks: {
            firestore: createFirestoreReadinessCheck({ db })
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
    const tenantOperations = createTenantOperationsService({
        tenantRegistry,
        usageTelemetry,
        entitlementService,
        finOpsService,
        securitySignals,
        checkReadiness,
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
    startPlatformServer
};
