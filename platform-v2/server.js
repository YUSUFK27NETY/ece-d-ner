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

function startPlatformServer() {
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
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        auditWriter,
        webConfig,
        allowedOrigins
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
