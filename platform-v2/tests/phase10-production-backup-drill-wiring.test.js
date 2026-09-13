const test = require("node:test");
const assert = require("node:assert/strict");

const {
    BACKUP_DRILL_TENANT_ENV,
    R2_BACKUP_CONFIG_KEYS,
    attachConfiguredBackupConnectivityDiagnosticEndpoint
} = require("../src/http/attach-backup-connectivity-diagnostic-endpoint");

test("configured backup runtime explicit startup drill scheduler'ı wiring eder", () => {
    const env = {
        [BACKUP_DRILL_TENANT_ENV]: "ela-doner",
        [R2_BACKUP_CONFIG_KEYS[0]]: "https://example.r2.cloudflarestorage.com",
        [R2_BACKUP_CONFIG_KEYS[1]]: "ece-platform-backups",
        [R2_BACKUP_CONFIG_KEYS[2]]: "test-access-key",
        [R2_BACKUP_CONFIG_KEYS[3]]: "test-secret-key"
    };
    const scheduled = [];
    const routes = [];
    const app = {
        get(path, handler) {
            routes.push({ path, handler });
        }
    };

    const result = attachConfiguredBackupConnectivityDiagnosticEndpoint({
        app,
        tenantRegistry: {
            async getById() {
                return null;
            }
        },
        env,
        scheduleBackupDrill(input) {
            scheduled.push(input);
            return true;
        }
    });

    assert.equal(result, app);
    assert.equal(routes.length, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].env, env);
});

test("R2 yapılandırması yoksa scheduler çağrılmaz", () => {
    let scheduled = false;
    const app = { get() {} };

    const result = attachConfiguredBackupConnectivityDiagnosticEndpoint({
        app,
        tenantRegistry: {},
        env: {},
        scheduleBackupDrill() {
            scheduled = true;
        }
    });

    assert.equal(result, app);
    assert.equal(scheduled, false);
});
