const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    PHASE9_ROUTE_FIXTURE_TENANT_ENV,
    PHASE9_ROUTE_FIXTURE_MODE_ENV,
    scheduleConfiguredPhase9RouteFixture
} = require("../src/http/attach-backup-connectivity-diagnostic-endpoint");
const {
    fixtureDomain
} = require("../scripts/run-phase9-route-fixture");

const TENANT_ID = "phase9-live-second-20260910";

test("route fixture yalnız explicit tenant + setup/cleanup mode ile schedule edilir", async () => {
    for (const mode of ["setup", "cleanup"]) {
        const scheduled = [];
        const calls = [];
        const env = {
            [PHASE9_ROUTE_FIXTURE_TENANT_ENV]: TENANT_ID,
            [PHASE9_ROUTE_FIXTURE_MODE_ENV]: mode
        };
        assert.equal(scheduleConfiguredPhase9RouteFixture({
            env,
            schedule(fn) { scheduled.push(fn); },
            loadFixture() {
                return {
                    async runPhase9RouteFixture(receivedEnv) {
                        calls.push(receivedEnv);
                    }
                };
            }
        }), true);
        assert.equal(scheduled.length, 1);
        scheduled[0]();
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(calls, [env]);
    }
});

test("route fixture eksik/invalid env ile schedule edilmez", () => {
    for (const env of [
        {},
        { [PHASE9_ROUTE_FIXTURE_TENANT_ENV]: TENANT_ID },
        {
            [PHASE9_ROUTE_FIXTURE_TENANT_ENV]: TENANT_ID,
            [PHASE9_ROUTE_FIXTURE_MODE_ENV]: "invalid"
        }
    ]) {
        let scheduled = false;
        assert.equal(scheduleConfiguredPhase9RouteFixture({
            env,
            schedule() { scheduled = true; }
        }), false);
        assert.equal(scheduled, false);
    }
});

test("route fixture reserved example.com domain üretir", () => {
    assert.equal(
        fixtureDomain(TENANT_ID),
        "phase9-live-second-20260910.example.com"
    );
});

test("route fixture sadece staging test route/profile alanını kurup geri temizler", () => {
    const workspace = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(
        path.join(workspace, "platform-v2/scripts/run-phase9-route-fixture.js"),
        "utf8"
    );
    assert.match(source, /platformTenantPublicRoutes/);
    assert.match(source, /\.example\.com/);
    assert.match(source, /ref\.create\(/);
    assert.match(source, /ref\.delete\(\)/);
    assert.match(source, /customDomain: null/);
    assert.match(source, /ROUTE_FIXTURE_CLEANUP_SCOPE_MISMATCH/);
    assert.doesNotMatch(source, /cloudflare|dns|certificate|billing/i);
    assert.doesNotMatch(
        source,
        /console\.(?:log|error)\([^\n]*(?:customToken|idToken|apiKey|password|email|phone)/
    );
});
