const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    PHASE9_ACCEPTANCE_TENANT_ENV,
    PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV,
    scheduleConfiguredPhase9Acceptance
} = require("../src/http/attach-backup-connectivity-diagnostic-endpoint");

const TENANT_ID = "phase9-live-second-20260910";
const BASELINE_ID = "phase9-live-baseline-20260910";

test("controlled live acceptance yalnız target+baseline env ile bir kez schedule edilir", async () => {
    const scheduled = [];
    const calls = [];
    const env = {
        [PHASE9_ACCEPTANCE_TENANT_ENV]: TENANT_ID,
        [PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV]: BASELINE_ID
    };

    assert.equal(scheduleConfiguredPhase9Acceptance({
        env,
        schedule(fn) {
            scheduled.push(fn);
        },
        loadAcceptance() {
            return {
                async runPhase9LiveAcceptance(receivedEnv) {
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

test("controlled live acceptance eksik env ile schedule edilmez", () => {
    for (const env of [
        {},
        { [PHASE9_ACCEPTANCE_TENANT_ENV]: TENANT_ID },
        { [PHASE9_ACCEPTANCE_BASELINE_TENANT_ENV]: BASELINE_ID }
    ]) {
        let scheduled = false;
        let loaded = false;
        assert.equal(scheduleConfiguredPhase9Acceptance({
            env,
            schedule() {
                scheduled = true;
            },
            loadAcceptance() {
                loaded = true;
                return {};
            }
        }), false);
        assert.equal(scheduled, false);
        assert.equal(loaded, false);
    }
});

test("live acceptance gerçek HTTP business flow, isolation ve lifecycle handoff doğrulamalarını içerir", () => {
    const workspace = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(
        path.join(workspace, "platform-v2/scripts/run-phase9-live-acceptance.js"),
        "utf8"
    );

    for (const expected of [
        "/catalog/products",
        "PUBLIC_ORDER_PATH",
        "/orders?limit=200",
        "/status",
        "/lifecycle/${action}",
        'action: "suspend"',
        'action: "resume"',
        'action: "archive"',
        "/last-audit",
        "tenant.lifecycle.archived",
        "ACCEPTANCE_BASELINE_CHANGED_BY_BUSINESS_FLOW",
        "ACCEPTANCE_BASELINE_CHANGED_BY_LIFECYCLE",
        "PHASE9_LIVE_ACCEPTANCE_OK"
    ]) {
        assert.equal(source.includes(expected), true, expected);
    }

    assert.equal(source.includes("readConfiguredHmacKey"), true);
    assert.equal(source.includes("createPublicRouteSignature"), true);
    assert.doesNotMatch(
        source,
        /console\.(?:log|error)\([^\n]*(?:customToken|idToken|apiKey|hmacKey|phone|customerName)/
    );
});

test("live acceptance hard-stop sırası baseline isolation bozulursa lifecycle mutationa geçmez", () => {
    const workspace = path.resolve(__dirname, "../..");
    const source = fs.readFileSync(
        path.join(workspace, "platform-v2/scripts/run-phase9-live-acceptance.js"),
        "utf8"
    );
    const isolationIndex = source.indexOf("ACCEPTANCE_BASELINE_CHANGED_BY_BUSINESS_FLOW");
    const suspendIndex = source.indexOf('stage = "lifecycle-suspend"');
    assert.ok(isolationIndex > 0);
    assert.ok(suspendIndex > isolationIndex);
});
