const { createPlatformFirebase } = require("./src/firebase/create-platform-firebase");
const { createFirestoreTenantRegistry } = require("./src/firestore/firestore-tenant-registry");
const { createFirestoreAuditWriter } = require("./src/firestore/firestore-audit-writer");
const { createPlatformApp } = require("./src/http/create-platform-app");

function startPlatformServer() {
    const { auth, db } = createPlatformFirebase();
    const tenantRegistry = createFirestoreTenantRegistry({ db });
    const auditWriter = createFirestoreAuditWriter({ db });
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        auditWriter
    });

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
