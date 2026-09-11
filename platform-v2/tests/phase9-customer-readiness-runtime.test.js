const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createBackupReadinessAdapter,
    createCustomerReadinessSourceAdapters,
    createHealthReadinessAdapter,
    createProfileReadinessAdapter
} = require("../src/onboarding/customer-readiness-adapters");
const {
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const NOW_MS = Date.parse("2026-09-08T16:00:00.000Z");
const OBSERVED_AT = "2026-09-08T15:59:00.000Z";

function tenantFixture(overrides = {}) {
    return {
        ...createTenantRecord({
            tenantId: "second-tenant",
            displayName: "Second Tenant",
            sector: "restaurant",
            now: new Date("2026-09-08T15:00:00.000Z")
        }),
        ...overrides
    };
}

async function evaluateSource(source, sourceAdapter, tenant = tenantFixture()) {
    const service = createCustomerReadinessService({
        sourceAdapters: { [source]: sourceAdapter },
        clock: () => NOW_MS
    });
    return service.evaluate({ tenantId: "second-tenant", tenant });
}

test("profile adapter persisted yapısal alanları PII taşımadan ready yapar", async () => {
    const profile = {
        timezone: "Europe/Istanbul",
        email: "not-returned@example.invalid",
        phone: "+000000000"
    };
    Object.defineProperty(profile, "password", {
        enumerable: true,
        get() { throw new Error("sensitive accessor invoked"); }
    });
    const readiness = await evaluateSource(
        "profile",
        createProfileReadinessAdapter(),
        tenantFixture({ profile })
    );
    const serialized = JSON.stringify(readiness);

    assert.deepEqual(readiness.checks.profile, {
        status: "ready",
        code: null,
        observedAt: "2026-09-08T15:00:00.000Z"
    });
    for (const marker of ["not-returned@example.invalid", "+000000000", "password"]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("profile adapter incomplete ve malformed kayıtları pending/blocked ayırır", async () => {
    const incomplete = await evaluateSource(
        "profile",
        createProfileReadinessAdapter(),
        tenantFixture({ profile: { timezone: null } })
    );
    assert.deepEqual(incomplete.checks.profile, {
        status: "pending",
        code: "PROFILE_INCOMPLETE",
        observedAt: "2026-09-08T15:00:00.000Z"
    });

    const invalid = await evaluateSource(
        "profile",
        createProfileReadinessAdapter(),
        tenantFixture({ sector: "Restaurant", profile: { timezone: "Not/AZone" } })
    );
    assert.deepEqual(invalid.checks.profile, {
        status: "blocked",
        code: "PROFILE_INVALID",
        observedAt: "2026-09-08T15:00:00.000Z"
    });
});

test("health adapter ready ve explicit not-ready durumlarını güvenli eşler", async () => {
    for (const [ready, expected] of [
        [true, { status: "ready", code: null }],
        [false, { status: "blocked", code: "HEALTH_CHECK_FAILED" }]
    ]) {
        const readiness = await evaluateSource(
            "health",
            createHealthReadinessAdapter({
                async checkReadiness() {
                    return { ready, checkedAt: OBSERVED_AT, checks: { raw: "ignored" } };
                }
            })
        );
        assert.deepEqual(readiness.checks.health, {
            ...expected,
            observedAt: OBSERVED_AT
        });
    }
});

test("health malformed sonucu ve exception P9-1 sınırında unavailable olur", async () => {
    for (const checkReadiness of [
        async () => ({ ready: "yes", checkedAt: OBSERVED_AT }),
        async () => ({ ready: true, checkedAt: "not-canonical" }),
        async () => { throw new Error("raw-health-error-marker"); }
    ]) {
        const readiness = await evaluateSource(
            "health",
            createHealthReadinessAdapter({ checkReadiness })
        );
        assert.deepEqual(readiness.checks.health, {
            status: "unavailable",
            code: null,
            observedAt: null
        });
        assert.equal(JSON.stringify(readiness).includes("raw-health-error-marker"), false);
    }
});

test("backup adapter yalnız doğrulanmış gerçek evidence ile ready olur", async () => {
    const calls = [];
    const ready = await evaluateSource(
        "backup",
        createBackupReadinessAdapter({
            backupEvidenceProvider: {
                async getStatus(input) {
                    calls.push(input);
                    return {
                        objectCount: 2,
                        verifiedAt: OBSERVED_AT,
                        providerBody: "must-not-leak"
                    };
                }
            }
        })
    );
    assert.deepEqual(calls, [{ tenantId: "second-tenant" }]);
    assert.deepEqual(ready.checks.backup, {
        status: "ready",
        code: null,
        observedAt: OBSERVED_AT
    });
    assert.equal(JSON.stringify(ready).includes("must-not-leak"), false);

    const pending = await evaluateSource(
        "backup",
        createBackupReadinessAdapter({
            backupEvidenceProvider: {
                async getStatus() {
                    return { objectCount: 0, verifiedAt: null };
                }
            }
        })
    );
    assert.deepEqual(pending.checks.backup, {
        status: "pending",
        code: "BACKUP_NOT_VERIFIED",
        observedAt: null
    });

    const noncanonicalEvidence = await evaluateSource(
        "backup",
        createBackupReadinessAdapter({
            backupEvidenceProvider: {
                async getStatus() {
                    return { objectCount: 1, verifiedAt: "not-canonical" };
                }
            }
        })
    );
    assert.deepEqual(noncanonicalEvidence.checks.backup, {
        status: "pending",
        code: "BACKUP_NOT_VERIFIED",
        observedAt: null
    });
});

test("backup provider yoksa adapter kaydı ve readiness değeri unavailable kalır", async () => {
    const adapters = createCustomerReadinessSourceAdapters({
        checkReadiness: async () => ({ ready: true, checkedAt: OBSERVED_AT })
    });
    assert.deepEqual(Object.keys(adapters), ["profile", "health"]);

    const service = createCustomerReadinessService({
        sourceAdapters: adapters,
        clock: () => NOW_MS
    });
    const readiness = await service.evaluate({
        tenantId: "second-tenant",
        tenant: tenantFixture()
    });
    assert.equal(readiness.checks.backup.status, "unavailable");
});

test("P9-2 yalnız profile health ve koşullu backup runtime kaynaklarını bağlar", () => {
    const adapters = createCustomerReadinessSourceAdapters({
        checkReadiness: async () => ({ ready: true, checkedAt: OBSERVED_AT }),
        backupEvidenceProvider: {
            async getStatus() { return { objectCount: 0, verifiedAt: null }; }
        }
    });

    assert.deepEqual(Object.keys(adapters), ["profile", "health", "backup"]);
    for (const source of ["plan", "adminBootstrap", "security", "domain"]) {
        assert.equal(Object.hasOwn(adapters, source), false, source);
    }
});

test("runtime wiring existing sources kullanır ve V1/provider mutation import etmez", () => {
    const workspace = path.resolve(__dirname, "../..");
    const serverSource = fs.readFileSync(path.join(workspace, "platform-v2/server.js"), "utf8");
    const adapterSource = fs.readFileSync(
        path.join(workspace, "platform-v2/src/onboarding/customer-readiness-adapters.js"),
        "utf8"
    );

    assert.match(serverSource, /createCustomerReadinessSourceAdapters\(\{[\s\S]*checkReadiness,[\s\S]*backupEvidenceProvider/);
    assert.doesNotMatch(adapterSource, /firebase-admin|identity|billing|dns|waf|r2-object|\.\.\/\.\.\/server/iu);
    assert.doesNotMatch(serverSource, /createInMemory.*Readiness|default.*plan.*ready/iu);
});
