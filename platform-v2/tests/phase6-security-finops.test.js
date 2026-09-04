const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPlatformGuardrailsConfig } = require("../src/config/platform-guardrails-config");
const { createTenantRateLimiter } = require("../src/security/tenant-rate-limiter");
const {
    createSecuritySignal,
    createSecuritySignalService
} = require("../src/security/security-signal");
const {
    createInMemorySecuritySignalStore
} = require("../src/security/in-memory-security-signal-store");
const { createAbuseMonitor } = require("../src/security/abuse-monitor");
const { createTenantAccessGuard } = require("../src/security/tenant-access-guard");
const {
    securitySignalDocumentPath
} = require("../src/firestore/firestore-security-signal-store");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createUsageTelemetryService } = require("../src/usage/usage-telemetry");
const { createInMemoryUsageStore } = require("../src/usage/in-memory-usage-store");
const { createConfigCostProvider } = require("../src/finops/cost-provider");
const { createFinOpsService } = require("../src/finops/finops-service");
const {
    allocateSharedCosts,
    detectCostAnomaly,
    estimateTenantCost
} = require("../src/finops/cost-model");

function platformContext() {
    return { role: "platform_admin", actorId: "platform-admin-1" };
}

function tenantContext(tenantId) {
    return { role: "tenant_owner", tenantId, actorId: "owner-1" };
}

function createSignals() {
    return createSecuritySignalService({
        store: createInMemorySecuritySignalStore()
    });
}

function finopsConfig() {
    return loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            starter: {
                allowedFeatures: "*",
                softRequestLimit: 100,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1,
                monthlyRevenueReference: 1000
            }
        },
        finops: {
            thresholds: {
                warningRatio: 0.10,
                criticalRatio: 0.15
            },
            anomaly: {
                multiplier: 2,
                minimumIncrease: 5
            },
            rates: {
                requestPer100000: 1000,
                firestoreReadPer100000: 500,
                firestoreWritePer100000: 1000
            },
            sharedMonthlyCosts: {
                renderCompute: 90
            }
        }
    }));
}

test("tenant rate limiter tenantları birbirinden izole eder", () => {
    let now = 1000;
    const limiter = createTenantRateLimiter({ now: () => now });
    const policy = {
        sustainedWindowMs: 60_000,
        sustainedMax: 2,
        burstWindowMs: 10_000,
        burstMax: 2
    };

    assert.equal(limiter.consume({ tenantId: "tenant-a", policy, scope: "public" }).allowed, true);
    assert.equal(limiter.consume({ tenantId: "tenant-a", policy, scope: "public" }).allowed, true);
    assert.equal(limiter.consume({ tenantId: "tenant-a", policy, scope: "public" }).allowed, false);
    assert.equal(limiter.consume({ tenantId: "tenant-b", policy, scope: "public" }).allowed, true);
    now += 60_001;
    assert.equal(limiter.consume({ tenantId: "tenant-a", policy, scope: "public" }).allowed, true);
});

test("tenant rate limiter invalid tenant binding için fail-closed olur", () => {
    const limiter = createTenantRateLimiter();

    assert.throws(() => limiter.consume({
        tenantId: "../tenant-b",
        scope: "public",
        policy: {
            sustainedWindowMs: 1000,
            sustainedMax: 1,
            burstWindowMs: 1000,
            burstMax: 1
        }
    }), TypeError);
});

test("tenant rate limiter invalid policy ile fail-open çalışmaz", () => {
    const limiter = createTenantRateLimiter();

    assert.throws(() => limiter.consume({
        tenantId: "tenant-a",
        scope: "public",
        policy: {
            sustainedWindowMs: 60_000,
            sustainedMax: undefined,
            burstWindowMs: 10_000,
            burstMax: 10
        }
    }), TypeError);
});

test("repeated 401 security signal threshold sonunda üretilir", async () => {
    const signals = createSignals();
    const monitor = createAbuseMonitor({
        securitySignals: signals,
        windowMs: 10_000,
        threshold: 3,
        now: () => 1000
    });

    assert.equal(await monitor.recordDenied({ operation: "platform.admin.auth", statusCode: 401 }), null);
    assert.equal(await monitor.recordDenied({ operation: "platform.admin.auth", statusCode: 401 }), null);
    const emitted = await monitor.recordDenied({ operation: "platform.admin.auth", statusCode: 401 });

    assert.equal(emitted.type, "repeated_unauthorized");
    assert.equal(emitted.count, 3);
    assert.equal(emitted.tenantId, null);

    const stored = await signals.listTenant({
        context: platformContext(),
        tenantId: "tenant-a",
        limit: 10
    });
    assert.equal(stored.length, 0, "platform-scope auth signal tenant verisine karışmamalı");
});

test("repeated tenant 403 güvenli forbidden sinyali üretir", async () => {
    const signals = createSignals();
    const monitor = createAbuseMonitor({
        securitySignals: signals,
        windowMs: 10_000,
        threshold: 2,
        now: () => 1000
    });

    await monitor.recordDenied({
        tenantId: "tenant-a",
        requestId: "request-1",
        operation: "orders.manage",
        statusCode: 403
    });
    await monitor.recordDenied({
        tenantId: "tenant-a",
        requestId: "request-2",
        operation: "orders.manage",
        statusCode: 403
    });

    const stored = await signals.listTenant({
        context: tenantContext("tenant-a"),
        tenantId: "tenant-a",
        limit: 10
    });
    assert.equal(stored.length, 1);
    assert.equal(stored[0].type, "forbidden");
    assert.equal(stored[0].requestId, "request-2");
    assert.equal(stored[0].tenantId, "tenant-a");
});

test("tenant boundary violation kaynak tenant altında signal üretir", async () => {
    const signals = createSignals();
    const monitor = createAbuseMonitor({
        securitySignals: signals,
        windowMs: 10_000,
        threshold: 2,
        now: () => 1000
    });
    const guard = createTenantAccessGuard({ abuseMonitor: monitor });

    await assert.rejects(guard.authorize({
        context: tenantContext("tenant-a"),
        tenantId: "tenant-b",
        permission: "tenant.read",
        requestId: "request-boundary",
        operation: "tenant.profile.read"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");

    const stored = await signals.listTenant({
        context: tenantContext("tenant-a"),
        tenantId: "tenant-a",
        limit: 10
    });
    assert.equal(stored[0].type, "tenant_boundary_violation");
    assert.equal(stored[0].operation, "tenant.profile.read");
});

test("security signal payload body, token ve serbest PII metadata kabul etmez", () => {
    assert.throws(() => createSecuritySignal({
        tenantId: "tenant-a",
        type: "quota_warning",
        operation: "orders.create",
        metadata: {
            token: "secret",
            body: "customer data"
        }
    }), TypeError);
});

test("Firestore security signal path tenant-safe ve platform scope için ayrıdır", () => {
    const tenantSignal = createSecuritySignal({
        tenantId: "tenant-a",
        type: "quota_warning",
        operation: "orders.create"
    });
    const platformSignal = createSecuritySignal({
        type: "repeated_unauthorized",
        operation: "platform.admin.auth"
    });

    assert.equal(
        securitySignalDocumentPath(tenantSignal),
        `tenants/tenant-a/securitySignals/${tenantSignal.signalId}`
    );
    assert.equal(
        securitySignalDocumentPath(platformSignal),
        `platformSecuritySignals/${platformSignal.signalId}`
    );
});

test("quota warning ve upper-plan review sinyalleri tenant/request/operation ile koreledir", async () => {
    const signals = createSignals();
    const config = finopsConfig();
    const service = createEntitlementService({ config, securitySignals: signals });

    const result = await service.evaluateAndSignal({
        tenant: {
            tenantId: "tenant-a",
            plan: "starter",
            features: { orders: true }
        },
        feature: "orders",
        currentUsage: 110,
        requestId: "request-quota",
        operation: "orders.create"
    });
    const stored = await signals.listTenant({
        context: platformContext(),
        tenantId: "tenant-a",
        limit: 10
    });

    assert.equal(result.limit.autoDisabled, false);
    assert.deepEqual(stored.map(signal => signal.type).sort(), ["quota_warning", "upper_plan_review"]);
    assert.ok(stored.every(signal => signal.requestId === "request-quota"));
});

test("invalid cost config fail-closed olur", () => {
    assert.throws(() => loadPlatformGuardrailsConfig(JSON.stringify({
        finops: {
            thresholds: {
                warningRatio: 0.3,
                criticalRatio: 0.1
            }
        }
    })), /threshold sırası/);
});

test("invalid quota config fail-closed olur", () => {
    assert.throws(() => loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            starter: {
                allowedFeatures: "*",
                softRequestLimit: 0,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }
        }
    })), /softRequestLimit/);
});

test("shared cost allocation request payına göre deterministik ve tamdır", () => {
    const first = allocateSharedCosts({
        totalSharedCost: 100,
        tenantUsages: [
            { tenantId: "tenant-b", requestCount: 1 },
            { tenantId: "tenant-a", requestCount: 3 }
        ]
    });
    const second = allocateSharedCosts({
        totalSharedCost: 100,
        tenantUsages: [
            { tenantId: "tenant-a", requestCount: 3 },
            { tenantId: "tenant-b", requestCount: 1 }
        ]
    });

    assert.deepEqual(first, second);
    assert.equal(first.allocations["tenant-a"], 75);
    assert.equal(first.allocations["tenant-b"], 25);
    assert.equal(first.allocatedTotal, 100);
    assert.equal(first.unattributedCost, 0);
});

test("tenant yoksa shared cost açıkça unattributed kalır", () => {
    const result = allocateSharedCosts({ tenantUsages: [], totalSharedCost: 50 });
    assert.equal(result.allocatedTotal, 0);
    assert.equal(result.unattributedCost, 50);
});

test("FinOps modeli attributable ve shared cost ile ratio/status hesaplar", () => {
    const config = finopsConfig();
    const estimate = estimateTenantCost({
        tenantId: "tenant-a",
        usage: {
            requestCount: 1000,
            providerUsage: {
                firestoreReads: 1000,
                firestoreWrites: 100
            }
        },
        rateCard: config.finops.rates,
        allocatedSharedCost: 100,
        monthlyRevenueReference: 1000,
        currency: "TRY",
        thresholds: config.finops.thresholds
    });

    assert.ok(estimate.attributableCost > 0);
    assert.ok(estimate.estimatedMonthlyTechnicalCost > 100);
    assert.equal(estimate.status, "warning");
    assert.equal(estimate.estimatedContributionMargin,
        1000 - estimate.estimatedMonthlyTechnicalCost);
});

test("sudden cost anomaly multiplier ve minimum artış kapılarını birlikte uygular", () => {
    const config = { multiplier: 2, minimumIncrease: 20 };
    assert.equal(detectCostAnomaly({ currentCost: 50, baselineCost: 20, config }).anomalous, true);
    assert.equal(detectCostAnomaly({ currentCost: 25, baselineCost: 10, config }).anomalous, false);
    assert.equal(detectCostAnomaly({ currentCost: 19, baselineCost: 0, config }).anomalous, false);
});

test("FinOps service top-N pahalı tenantları sıralar ve cross-tenant cost read'i reddeder", async () => {
    const config = finopsConfig();
    const usageTelemetry = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const tenants = [
        { tenantId: "tenant-a", plan: "starter", features: { catalog: true } },
        { tenantId: "tenant-b", plan: "starter", features: { catalog: true } }
    ];
    const tenantRegistry = {
        async list() { return tenants; },
        async getById(id) { return tenants.find(tenant => tenant.tenantId === id) || null; }
    };
    const at = new Date("2026-09-04T00:00:00.000Z");
    await usageTelemetry.record({
        tenantId: "tenant-a",
        operation: "orders.list",
        operationClass: "read",
        timestamp: at,
        requestCount: 1000,
        firestoreReads: 1000
    });
    await usageTelemetry.record({
        tenantId: "tenant-b",
        operation: "orders.list",
        operationClass: "read",
        timestamp: at,
        requestCount: 100,
        firestoreReads: 100
    });
    const signals = createSignals();
    const service = createFinOpsService({
        config,
        costProvider: createConfigCostProvider({ finopsConfig: config.finops }),
        usageTelemetry,
        tenantRegistry,
        securitySignals: signals
    });

    const top = await service.getTopTenants({ context: platformContext(), limit: 1, at });
    assert.equal(top.estimates.length, 1);
    assert.equal(top.estimates[0].tenantId, "tenant-a");

    await service.evaluateAndSignal({
        context: platformContext(),
        at,
        requestId: "request-finops"
    });
    const anomalySignals = await signals.listTenant({
        context: platformContext(),
        tenantId: "tenant-a",
        limit: 10
    });
    assert.equal(anomalySignals[0].type, "cost_anomaly");
    assert.equal(anomalySignals[0].requestId, "request-finops");

    await assert.rejects(service.getTenantEstimate({
        context: tenantContext("tenant-a"),
        tenantId: "tenant-b",
        at
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
});
