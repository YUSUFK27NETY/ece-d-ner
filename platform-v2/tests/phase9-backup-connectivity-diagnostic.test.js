const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    projectStorageError,
    createBackupConnectivityDiagnosticService
} = require("../src/onboarding/backup-connectivity-diagnostic-service");
const {
    createR2ObjectStorageProvider
} = require("../src/storage/r2-object-storage-provider");
const {
    BACKUP_DRILL_TENANT_ENV,
    PHASE9_ACTIVATION_TENANT_ENV,
    PHASE9_ACTIVATION_ADMIN_EMAIL_ENV,
    scheduleConfiguredBackupDrill,
    scheduleConfiguredPhase9Activation
} = require("../src/http/attach-backup-connectivity-diagnostic-endpoint");

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

test("R2 HTTP error yalnız safe code/status/providerCode olarak projekte edilir", async () => {
    const detailMarker = "must-never-leak-response-detail";
    const service = createBackupConnectivityDiagnosticService({
        tenantRegistry: tenantRegistry(),
        storageProvider: {
            async listObjects() {
                const error = new Error(detailMarker);
                error.code = "R2_HTTP_403";
                error.status = 403;
                error.providerCode = "SignatureDoesNotMatch";
                error.authorization = detailMarker;
                throw error;
            }
        }
    });

    const result = await service.diagnose(diagnosticInput());
    assert.deepEqual(result, {
        ok: false,
        tenantId: TENANT_ID,
        operation: "listObjects",
        error: {
            code: "R2_HTTP_403",
            status: 403,
            providerCode: "SignatureDoesNotMatch"
        }
    });
    assert.equal(JSON.stringify(result).includes(detailMarker), false);
});

test("R2 provider XML error body içinden yalnız güvenli Code alanını taşır", async () => {
    const detailMarker = "never-surface-provider-message";
    const provider = createR2ObjectStorageProvider({
        endpoint: "https://example.r2.cloudflarestorage.com",
        bucket: "phase9-test-bucket",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key",
        region: "auto"
    }, {
        now: () => new Date("2026-09-11T08:00:00.000Z"),
        fetchImpl: async () => ({
            ok: false,
            status: 403,
            async text() {
                return `<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>${detailMarker}</Message></Error>`;
            }
        })
    });

    await assert.rejects(
        () => provider.listObjects({ prefix: "backups/test/firestore/" }),
        error => {
            assert.equal(error.code, "R2_HTTP_403");
            assert.equal(error.status, 403);
            assert.equal(error.providerCode, "AccessDenied");
            assert.equal(error.message.includes(detailMarker), false);
            return true;
        }
    );
});

test("provider error code güvenli formata uymuyorsa dışarı taşınmaz", () => {
    const error = new Error("provider internal detail");
    error.code = "R2_HTTP_403";
    error.status = 403;
    error.providerCode = "AccessDenied<unsafe>";
    assert.deepEqual(projectStorageError(error), {
        code: "R2_HTTP_403",
        status: 403,
        providerCode: null
    });
});

test("unknown storage error generic fail-closed projection kullanır", () => {
    const error = new Error("provider internal detail");
    error.code = "SOME_INTERNAL_ERROR";
    error.status = 700;
    error.providerCode = "AccessDenied";
    assert.deepEqual(projectStorageError(error), {
        code: "R2_REQUEST_FAILED",
        status: null,
        providerCode: null
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

test("startup backup drill yalnız explicit tenant env ile bir kez schedule edilir", () => {
    const scheduled = [];
    let loads = 0;
    const env = { [BACKUP_DRILL_TENANT_ENV]: TENANT_ID };

    assert.equal(scheduleConfiguredBackupDrill({
        env,
        schedule(fn) {
            scheduled.push(fn);
        },
        loadDrill() {
            loads += 1;
        }
    }), true);
    assert.equal(scheduled.length, 1);
    assert.equal(loads, 0);

    scheduled[0]();
    assert.equal(loads, 1);
});

test("startup backup drill env yoksa hiçbir şey schedule etmez", () => {
    let scheduled = false;
    let loaded = false;

    assert.equal(scheduleConfiguredBackupDrill({
        env: {},
        schedule() {
            scheduled = true;
        },
        loadDrill() {
            loaded = true;
        }
    }), false);
    assert.equal(scheduled, false);
    assert.equal(loaded, false);
});

test("controlled activation yalnız tenant ve admin email birlikte verilirse bir kez schedule edilir", async () => {
    const scheduled = [];
    const calls = [];
    const env = {
        [PHASE9_ACTIVATION_TENANT_ENV]: TENANT_ID,
        [PHASE9_ACTIVATION_ADMIN_EMAIL_ENV]: "platform-admin@example.test"
    };

    assert.equal(scheduleConfiguredPhase9Activation({
        env,
        schedule(fn) {
            scheduled.push(fn);
        },
        loadActivation() {
            return {
                async runPhase9ControlledActivation(receivedEnv) {
                    calls.push(receivedEnv);
                }
            };
        }
    }), true);
    assert.equal(scheduled.length, 1);
    assert.equal(calls.length, 0);

    scheduled[0]();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [env]);
});

test("controlled activation eksik trigger env ile schedule edilmez", () => {
    for (const env of [
        {},
        { [PHASE9_ACTIVATION_TENANT_ENV]: TENANT_ID },
        { [PHASE9_ACTIVATION_ADMIN_EMAIL_ENV]: "platform-admin@example.test" }
    ]) {
        let scheduled = false;
        let loaded = false;
        assert.equal(scheduleConfiguredPhase9Activation({
            env,
            schedule() {
                scheduled = true;
            },
            loadActivation() {
                loaded = true;
                return {};
            }
        }), false);
        assert.equal(scheduled, false);
        assert.equal(loaded, false);
    }
});

test("controlled activation runner readiness, lifecycle ve audit doğrulamasını HTTP üzerinden yapar", () => {
    const workspace = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(
        path.join(workspace, "platform-v2/scripts/run-phase9-controlled-activation.js"),
        "utf8"
    );
    assert.match(source, /activationReadiness !== "ready"/);
    assert.match(source, /readiness\.canActivate !== true/);
    assert.match(source, /checks\?\.backup\?\.status !== "ready"/);
    assert.match(source, /\/lifecycle\/activate/);
    assert.match(source, /method: "POST"/);
    assert.match(source, /\/last-audit/);
    assert.match(source, /lastAudit\.action !== "tenant\.lifecycle\.activated"/);
    assert.match(source, /PHASE9_ACTIVATION_OK/);
    assert.doesNotMatch(source, /console\.(?:log|error)\([^\n]*(?:customToken|idToken|apiKey)/);
});

test("backup drill hata logu yalnız stage/code/kind taşır ve güvenli keyring sınıfları kullanır", () => {
    const workspace = path.resolve(__dirname, "../..");
    const drillSource = fs.readFileSync(
        path.join(workspace, "platform-v2/scripts/run-backup-drill.js"),
        "utf8"
    );
    assert.match(drillSource, /BACKUP_DRILL_FAILED stage=\$\{drillStage\} code=\$\{code\} kind=\$\{kind\}/);
    assert.doesNotMatch(drillSource, /BACKUP_DRILL_FAILED[^\n]*error\?\.message/);
    for (const code of [
        "BACKUP_KEYS_JSON_MISSING",
        "BACKUP_KEYS_JSON_INVALID",
        "BACKUP_KEYRING_KEYS_INVALID",
        "BACKUP_KEY_ID_INVALID",
        "BACKUP_KEY_ID_DUPLICATE",
        "BACKUP_KEY_INVALID_BASE64",
        "BACKUP_KEY_INVALID_LENGTH",
        "BACKUP_ACTIVE_KEY_NOT_FOUND"
    ]) {
        assert.match(drillSource, new RegExp(code));
    }
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
