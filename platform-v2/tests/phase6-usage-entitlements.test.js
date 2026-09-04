const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const {
    createUsageDelta,
    createUsageTelemetryService,
    getAggregationPeriod
} = require("../src/usage/usage-telemetry");
const { createInMemoryUsageStore } = require("../src/usage/in-memory-usage-store");
const {
    createFirestoreUsageStore,
    telemetryDocumentPath
} = require("../src/firestore/firestore-usage-store");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");

function platformContext() {
    return { role: "platform_admin", actorId: "platform-admin-1" };
}

function tenantContext(tenantId) {
    return { role: "tenant_owner", actorId: "owner-1", tenantId };
}

function configWithPlan(policy = {}) {
    return loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            starter: {
                allowedFeatures: ["catalog", "orders"],
                softRequestLimit: 100,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1,
                ...policy
            }
        }
    }));
}

test("guardrail config invalid threshold değerinde fail-closed ve raw değeri sızdırmadan kapanır", () => {
    const raw = JSON.stringify({
        plans: {
            starter: {
                softRequestLimit: "super-secret-raw-value"
            }
        }
    });

    assert.throws(
        () => loadPlatformGuardrailsConfig(raw),
        error => error instanceof TypeError &&
            !error.message.includes("super-secret-raw-value")
    );
});

test("guardrail config public ve admin tenant rate-limit policylerini ayrı tutar", () => {
    const config = loadPlatformGuardrailsConfig();

    assert.notDeepEqual(config.rateLimits.public, config.rateLimits.adminTenant);
    assert.ok(config.rateLimits.public.burstMax < config.rateLimits.public.sustainedMax);
});

test("usage delta yalnız kontrollü telemetry alanlarını üretir; body ve token saklamaz", () => {
    const delta = createUsageDelta({
        tenantId: "tenant-a",
        operation: "orders.create",
        operationClass: "write",
        statusCode: 201,
        latencyMs: 12.5,
        firestoreReads: 2,
        firestoreWrites: 1,
        body: { customer: "PII" },
        token: "secret-token"
    });

    assert.equal(delta.requestCount, 1);
    assert.equal(delta.providerUsage.firestoreReads, 2);
    assert.equal(delta.providerUsage.firestoreWrites, 1);
    assert.equal("body" in delta, false);
    assert.equal("token" in delta, false);
    assert.doesNotMatch(JSON.stringify(delta), /PII|secret-token/);
});

test("usage telemetry günlük ve aylık aggregate üretir", async () => {
    const service = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const at = new Date("2026-09-04T10:00:00.000Z");

    await service.record({
        tenantId: "tenant-a",
        operation: "orders.list",
        operationClass: "read",
        timestamp: at,
        statusCode: 200,
        latencyMs: 10,
        firestoreReads: 3
    });
    await service.record({
        tenantId: "tenant-a",
        operation: "orders.create",
        operationClass: "write",
        timestamp: at,
        statusCode: 500,
        latencyMs: 30,
        firestoreWrites: 1
    });

    const daily = await service.getAggregate({
        context: platformContext(),
        tenantId: "tenant-a",
        period: "daily",
        at
    });
    const monthly = await service.getAggregate({
        context: platformContext(),
        tenantId: "tenant-a",
        period: "monthly",
        at
    });

    assert.equal(daily.requestCount, 2);
    assert.equal(daily.errorCount, 1);
    assert.equal(daily.latencyAverageMs, 20);
    assert.equal(daily.latencyMaxMs, 30);
    assert.equal(daily.operationCounts["orders.create"], 1);
    assert.equal(daily.providerUsage.firestoreReads, 3);
    assert.equal(monthly.requestCount, 2);
});

test("telemetry operation anahtarı Object prototype adlarıyla çakışmaz", async () => {
    const service = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const at = new Date("2026-09-04T10:00:00.000Z");
    await service.record({
        tenantId: "tenant-a",
        operation: "constructor",
        operationClass: "system",
        timestamp: at
    });

    const usage = await service.getAggregate({
        context: platformContext(),
        tenantId: "tenant-a",
        period: "daily",
        at
    });
    assert.equal(usage.operationCounts.constructor, 1);
});

test("cross-tenant telemetry read fail-closed reddedilir", async () => {
    const service = createUsageTelemetryService({ store: createInMemoryUsageStore() });

    await assert.rejects(
        service.getAggregate({
            context: tenantContext("tenant-a"),
            tenantId: "tenant-b",
            period: "monthly"
        }),
        error => error.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("backup metadata genişletilebilir telemetry kontratında güvenli alanlarla aggregate edilir", async () => {
    const service = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const at = new Date("2026-09-04T10:00:00.000Z");

    await service.record({
        tenantId: "tenant-a",
        operation: "backup.verify",
        operationClass: "backup",
        timestamp: at,
        requestCount: 0,
        backup: {
            sizeBytes: 2048,
            objectCount: 2,
            verifiedAt: at,
            restoreDrillStatus: "passed",
            restoreDrillAt: at
        }
    });

    const usage = await service.getAggregate({
        context: tenantContext("tenant-a"),
        tenantId: "tenant-a",
        period: "monthly",
        at
    });
    assert.equal(usage.backup.sizeBytes, 2048);
    assert.equal(usage.backup.restoreDrillStatus, "passed");
});

test("partial backup telemetry önceki verify/drill metadata'sını silmez", async () => {
    const service = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const at = new Date("2026-09-04T10:00:00.000Z");

    await service.record({
        tenantId: "tenant-a",
        operation: "backup.verify",
        operationClass: "backup",
        timestamp: at,
        requestCount: 0,
        backup: {
            verifiedAt: at,
            restoreDrillStatus: "passed"
        }
    });
    await service.record({
        tenantId: "tenant-a",
        operation: "backup.inventory",
        operationClass: "backup",
        timestamp: at,
        requestCount: 0,
        backup: { objectCount: 3 }
    });

    const usage = await service.getAggregate({
        context: platformContext(),
        tenantId: "tenant-a",
        period: "monthly",
        at
    });
    assert.equal(usage.backup.objectCount, 3);
    assert.equal(usage.backup.restoreDrillStatus, "passed");
    assert.equal(usage.backup.verifiedAt, at.toISOString());
});

test("Firestore telemetry path tenant root dışına çıkamaz", () => {
    const period = getAggregationPeriod("monthly", "2026-09-04T00:00:00.000Z");
    assert.equal(
        telemetryDocumentPath("tenant-a", period),
        "tenants/tenant-a/telemetry/monthly_2026-09"
    );
    assert.throws(() => telemetryDocumentPath("../tenant-b", period), TypeError);
});

test("Firestore telemetry adapter mevcut cross-tenant aggregate'i yazmadan reddeder", async () => {
    let writes = 0;
    const db = {
        doc(path) {
            return { path };
        },
        async runTransaction(callback) {
            return callback({
                async get() {
                    return {
                        exists: true,
                        data() {
                            return {
                                tenantId: "tenant-b",
                                period: "monthly",
                                periodStart: "2026-09"
                            };
                        }
                    };
                },
                set() {
                    writes++;
                }
            });
        }
    };
    const store = createFirestoreUsageStore({ db });
    const delta = createUsageDelta({
        tenantId: "tenant-a",
        operation: "orders.list",
        operationClass: "read",
        timestamp: "2026-09-04T00:00:00.000Z"
    });

    await assert.rejects(
        store.increment({
            tenantId: "tenant-a",
            descriptor: getAggregationPeriod("monthly", delta.timestamp),
            delta
        }),
        error => error.code === "TENANT_BOUNDARY_VIOLATION"
    );
    assert.equal(writes, 0);
});

test("feature entitlement UI durumundan bağımsız backend katmanında enforce edilir", () => {
    const service = createEntitlementService({ config: configWithPlan() });
    const tenant = {
        tenantId: "tenant-a",
        plan: "starter",
        features: { orders: false }
    };

    assert.throws(() => service.assertFeatureAccess({
        context: tenantContext("tenant-a"),
        tenant,
        permission: "orders.manage",
        feature: "orders",
        currentUsage: 1
    }), error => error.code === "ENTITLEMENT_DENIED");
});

test("soft quota yüzde 80'de warning üretir", () => {
    const service = createEntitlementService({ config: configWithPlan() });
    const result = service.evaluate({
        tenant: {
            tenantId: "tenant-a",
            plan: "starter",
            features: { catalog: true }
        },
        feature: "catalog",
        currentUsage: 80
    });

    assert.equal(result.limit.status, "warning");
    assert.equal(result.limit.usageRatio, 0.8);
});

test("soft quota yüzde 100 üzerinde tenantı otomatik kapatmaz ve review sinyali verir", () => {
    const service = createEntitlementService({ config: configWithPlan() });
    const result = service.assertFeatureAccess({
        context: tenantContext("tenant-a"),
        tenant: {
            tenantId: "tenant-a",
            plan: "starter",
            features: { orders: true }
        },
        permission: "orders.manage",
        feature: "orders",
        currentUsage: 125
    });

    assert.equal(result.featureEnabled, true);
    assert.equal(result.limit.status, "over_limit");
    assert.equal(result.limit.dedicatedReview, true);
    assert.equal(result.limit.autoDisabled, false);
});

test("eski tenant kaydı bilinmeyen planda güvenli default entitlement ile çalışır", () => {
    const service = createEntitlementService({ config: loadPlatformGuardrailsConfig() });
    const result = service.evaluate({
        tenant: {
            tenantId: "tenant-old",
            plan: "legacy-plan"
        },
        feature: "catalog",
        currentUsage: 10
    });

    assert.equal(result.usedDefaultPlanPolicy, true);
    assert.equal(result.featureEnabled, true);
    assert.equal(result.limit.status, "unlimited");
});

test("plan adı Object prototype anahtarına denk gelse bile default policy güvenle seçilir", () => {
    const service = createEntitlementService({ config: loadPlatformGuardrailsConfig() });
    const result = service.evaluate({
        tenant: { tenantId: "constructor", plan: "constructor" },
        feature: "catalog",
        currentUsage: 0
    });

    assert.equal(result.usedDefaultPlanPolicy, true);
    assert.equal(result.featureEnabled, true);
});

test("tenant override soft limiti açıkça null yaparak plan limitini kaldırabilir", () => {
    const config = loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            starter: {
                allowedFeatures: "*",
                softRequestLimit: 100,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }
        },
        tenantOverrides: {
            "tenant-a": { softRequestLimit: null }
        }
    }));
    const service = createEntitlementService({ config });
    const result = service.evaluate({
        tenant: { tenantId: "tenant-a", plan: "starter" },
        feature: "catalog",
        currentUsage: 1000
    });

    assert.equal(result.limit.status, "unlimited");
});
