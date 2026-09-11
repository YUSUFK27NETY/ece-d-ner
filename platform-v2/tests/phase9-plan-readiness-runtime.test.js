const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const {
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    createCustomerReadinessSourceAdapters
} = require("../src/onboarding/customer-readiness-adapters");
const {
    createPlanReadinessAdapter
} = require("../src/onboarding/plan-readiness-adapter");

const TENANT_ID = "second-tenant";
const OBSERVED_AT = "2026-09-09T16:30:00.000Z";
const NOW_MS = Date.parse("2026-09-09T17:00:00.000Z");

function planPolicy() {
    return Object.freeze({
        allowedFeatures: "*",
        softRequestLimit: null,
        warningThreshold: 0.8,
        dedicatedReviewThreshold: 1
    });
}

function configFixture() {
    return Object.freeze({
        plans: Object.freeze({
            default: planPolicy(),
            starter: planPolicy()
        }),
        tenantOverrides: Object.freeze({}),
        finops: Object.freeze({
            defaultMonthlyRevenue: 2000
        })
    });
}

function tenantFixture(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        status: "provisioning",
        plan: "starter",
        updatedAt: OBSERVED_AT,
        ...overrides
    };
}

function entitlementFor(config = configFixture()) {
    return createEntitlementService({ config });
}

async function evaluatePlan(adapter, tenant = tenantFixture()) {
    const service = createCustomerReadinessService({
        sourceAdapters: { plan: adapter },
        clock: () => NOW_MS
    });

    return service.evaluate({
        tenantId: TENANT_ID,
        tenant
    });
}

test("configured exact plan genuine EntitlementService policy ile ready olur", async () => {
    const guardrailsConfig = configFixture();
    const readiness = await evaluatePlan(createPlanReadinessAdapter({
        guardrailsConfig,
        entitlementService: entitlementFor(guardrailsConfig)
    }));

    assert.deepEqual(readiness.checks.plan, {
        status: "ready",
        code: null,
        observedAt: OBSERVED_AT
    });
    assert.equal(readiness.checks.adminBootstrap.status, "unavailable");
    assert.equal(readiness.checks.security.status, "unavailable");
    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
});

test("missing tenant plan pending kalır", async () => {
    const guardrailsConfig = configFixture();
    const adapter = createPlanReadinessAdapter({
        guardrailsConfig,
        entitlementService: entitlementFor(guardrailsConfig)
    });

    for (const plan of [undefined, null, ""]) {
        const readiness = await evaluatePlan(adapter, tenantFixture({ plan }));
        assert.deepEqual(readiness.checks.plan, {
            status: "pending",
            code: "PLAN_NOT_CONFIGURED",
            observedAt: OBSERVED_AT
        });
    }
});

test("catalog unknown veya malformed tenant plan blocked olur", async () => {
    const guardrailsConfig = configFixture();
    const adapter = createPlanReadinessAdapter({
        guardrailsConfig,
        entitlementService: entitlementFor(guardrailsConfig)
    });

    for (const plan of ["enterprise", "Starter", " starter"]) {
        const readiness = await evaluatePlan(adapter, tenantFixture({ plan }));
        assert.deepEqual(readiness.checks.plan, {
            status: "blocked",
            code: "PLAN_UNSUPPORTED",
            observedAt: OBSERVED_AT
        });
    }
});

test("entitlement fallback mismatch malformed veya throw unavailable olur", async () => {
    const guardrailsConfig = configFixture();
    const rawMarker = "synthetic-plan-dependency-marker";
    const services = [
        Object.freeze({
            resolvePolicy() {
                return Object.freeze({
                    plan: "starter",
                    usedDefaultPlanPolicy: true
                });
            }
        }),
        Object.freeze({
            resolvePolicy() {
                return Object.freeze({
                    plan: "other",
                    usedDefaultPlanPolicy: false
                });
            }
        }),
        Object.freeze({
            resolvePolicy() {
                return Object.freeze({ plan: "starter" });
            }
        }),
        Object.freeze({
            resolvePolicy() {
                throw new Error(rawMarker);
            }
        })
    ];

    for (const entitlementService of services) {
        const readiness = await evaluatePlan(createPlanReadinessAdapter({
            guardrailsConfig,
            entitlementService
        }));
        assert.deepEqual(readiness.checks.plan, {
            status: "unavailable",
            code: null,
            observedAt: null
        });
        assert.equal(JSON.stringify(readiness).includes(rawMarker), false);
    }
});

test("missing veya malformed plan dependency P9 source boundary'de unavailable olur", async () => {
    const validEntitlement = entitlementFor();
    const adapters = [
        createPlanReadinessAdapter(),
        createPlanReadinessAdapter({
            guardrailsConfig: configFixture(),
            entitlementService: null
        }),
        createPlanReadinessAdapter({
            guardrailsConfig: Object.freeze({ plans: null }),
            entitlementService: validEntitlement
        })
    ];

    for (const adapter of adapters) {
        const readiness = await evaluatePlan(adapter);
        assert.equal(readiness.checks.plan.status, "unavailable");
        assert.equal(readiness.checks.plan.code, null);
    }
});

test("plan adapter exact tenant binding ve fixed safe projection kullanır", () => {
    const guardrailsConfig = configFixture();
    const genuine = createPlanReadinessAdapter({
        guardrailsConfig,
        entitlementService: entitlementFor(guardrailsConfig)
    });

    assert.throws(
        () => genuine.evaluate({
            tenantId: TENANT_ID,
            tenant: tenantFixture({ tenantId: "first-tenant" })
        }),
        TypeError
    );
    assert.throws(
        () => genuine.evaluate({
            tenantId: "Second-Tenant",
            tenant: tenantFixture()
        }),
        TypeError
    );

    const hostileEntitlement = Object.freeze({
        resolvePolicy() {
            return Object.freeze({
                plan: "starter",
                usedDefaultPlanPolicy: false,
                rawProviderBody: "synthetic-private-policy-marker",
                customerEmail: "hidden@example.invalid"
            });
        }
    });
    const result = createPlanReadinessAdapter({
        guardrailsConfig,
        entitlementService: hostileEntitlement
    }).evaluate({
        tenantId: TENANT_ID,
        tenant: {
            ...tenantFixture(),
            rawProviderBody: "synthetic-private-tenant-marker",
            customerEmail: "tenant@example.invalid"
        }
    });

    assert.deepEqual(Object.keys(result), [
        "source", "tenantId", "status", "code", "observedAt"
    ]);
    assert.equal(JSON.stringify(result).includes("synthetic-private"), false);
    assert.equal(JSON.stringify(result).includes("@example.invalid"), false);
});

test("server base genuine kaynakları koruyup yalnız plan readiness ekler", async () => {
    const guardrailsConfig = configFixture();
    const entitlementService = entitlementFor(guardrailsConfig);
    const baseAdapters = createCustomerReadinessSourceAdapters({
        checkReadiness: async () => ({
            ready: true,
            checkedAt: OBSERVED_AT
        })
    });
    const adapters = Object.freeze({
        ...baseAdapters,
        plan: createPlanReadinessAdapter({
            guardrailsConfig,
            entitlementService
        })
    });

    assert.deepEqual(Object.keys(baseAdapters), ["profile", "health"]);
    assert.deepEqual(Object.keys(adapters), ["profile", "health", "plan"]);
    assert.equal(Object.hasOwn(adapters, "adminBootstrap"), false);
    assert.equal(Object.hasOwn(adapters, "security"), false);
    assert.equal((await adapters.plan.evaluate({
        tenantId: TENANT_ID,
        tenant: tenantFixture()
    })).status, "ready");

    const platformRoot = path.resolve(__dirname, "..");
    const serverSource = fs.readFileSync(
        path.join(platformRoot, "server.js"),
        "utf8"
    );

    assert.match(serverSource,
        /\.\.\.createCustomerReadinessSourceAdapters\(\{[\s\S]*checkReadiness,[\s\S]*backupEvidenceProvider,[\s\S]*domainReadinessService[\s\S]*\}\),[\s\S]*plan:\s*createPlanReadinessAdapter\(\{[\s\S]*guardrailsConfig,[\s\S]*entitlementService/);
    assert.doesNotMatch(serverSource,
        /adminBootstrap:\s*create|security:\s*createSecurityReadiness/);
    assert.doesNotMatch(serverSource, /createInMemoryPlanReadiness/);
});
