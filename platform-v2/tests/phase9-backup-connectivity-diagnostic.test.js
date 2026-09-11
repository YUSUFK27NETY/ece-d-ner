const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    projectStorageError,
    createBackupConnectivityDiagnosticService
} = require("../src/onboarding/backup-connectivity-diagnostic-service");

const TENANT_ID = "phase9-live-second-20260910";

function tenantRegistry(status = "provisioning") {
    return {
        async getById(tenantId) {
            return tenantId === TENANT_ID
                ? { tenantId: TENANT_ID, status }
                : null;
        }
    };
}

function diagnosticInput() {
    return {
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: TENANT_ID
    };
}

test("backup connectivity diagnostic exact tenant prefix ile yalnız listObjects çağırır", async () => {
    const calls = [];
    const service = createBackupConnectivityDiagnosticService({
        tenantRegistry: tenantRegistry(),
        storageProvider: {
            async listObjects(input) {
                calls.push(input);
                return { objects: [] };
            }
        }
    });

    assert.deepEqual(await service.diagnose(diagnosticInput()), {
        ok: true,
        tenantId: TENANT_ID,
        operation: "listObjects",
        error: null
    });
    assert.deepEqual(calls, [{
        prefix: "backups/phase9-live-second-20260910/firestore/"
    }]);
});

test("R2 HTTP error yalnız safe code/status olarak projekte edilir", async () => {
    const secretMarker = "must-never-leak-secret";
    const service = createBackupConnectivityDiagnosticService({
        tenantRegistry: tenantRegistry(),
        storageProvider: {
            async listObjects() {
                const error = new Error(secretMarker);
                error.code = "R2_HTTP_403";
                error.status = 403;
                error.authorization = secretMarker;
                throw error;
            }
        }
    });

    const result = await service.diagnose(diagnosticInput());
    assert.deepEqual(result, {
        ok: false,
        tenantId: TENANT_ID,
        operation: "listObjects",
        error: { code: "R2_HTTP_403", status: 403 }
    });
    assert.equal(JSON.stringify(result).includes(secretMarker), false);
});

test("unknown storage error generic fail-closed projection kullanır", () => {
    const error = new Error("provider internal detail");
    error.code = "SOME_INTERNAL_ERROR";
    error.status = 700;
    assert.deepEqual(projectStorageError(error), {
        code: "R2_REQUEST_FAILED",
        status: null
    });
});

test("diagnostic yalnız platform_admin ve provisioning tenant için çalışır", async () => {
    const storageProvider = {
        async listObjects() { throw new Error("should not run"); }
    };
    const activeService = createBackupConnectivityDiagnosticService({
        tenantRegistry: tenantRegistry("active"),
        storageProvider
    });
    await assert.rejects(
        () => activeService.diagnose(diagnosticInput()),
        error => error?.code === "BACKUP_DIAGNOSTIC_INVALID_STATE"
    );

    const provisioningService = createBackupConnectivityDiagnosticService({
        tenantRegistry: tenantRegistry(),
        storageProvider
    });
    await assert.rejects(
        () => provisioningService.diagnose({
            context: { role: "tenant_owner", actorId: "owner-1" },
            tenantId: TENANT_ID
        }),
        TypeError
    );
});

test("server diagnostic endpointi Platform API auth middleware sonrasında attach eder", () => {
    const workspace = path.resolve(__dirname, "../..");
    const serverSource = fs.readFileSync(
        path.join(workspace, "platform-v2/server.js"),
        "utf8"
    );
    assert.match(
        serverSource,
        /attachConfiguredBackupConnectivityDiagnosticEndpoint\(\{[\s\S]*app,[\s\S]*tenantRegistry[\s\S]*\}\)/
    );
});
