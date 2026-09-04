const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPlatformScalabilityConfig } = require("../src/config/platform-scalability-config");
const { createCapacitySloService } = require("../src/capacity/capacity-slo-service");
const { createInMemoryPlacementRegistry } = require("../src/routing/in-memory-placement-registry");
const { createTenantRoutingService } = require("../src/routing/tenant-routing-service");
const { createFirestorePlacementRegistry } = require("../src/firestore/firestore-placement-registry");
const {
    createUsageDelta,
    emptyUsageAggregate,
    getAggregationPeriod,
    mergeUsageAggregate,
    presentUsageAggregate
} = require("../src/usage/usage-telemetry");

const admin = { role: "platform_admin", actorId: "phase7-admin" };

function placement(tenantId, overrides = {}) {
    return {
        tenantId,
        placementType: "shared",
        placementId: "shared-primary",
        region: "eu-west",
        status: "active",
        version: 1,
        releaseChannel: "stable",
        cohort: "default",
        updatedAt: "2026-09-04T10:00:00.000Z",
        ...overrides
    };
}

test("capacity eşikleri warning, critical ve dedicated review durumlarını config üzerinden üretir", () => {
    const config = loadPlatformScalabilityConfig(JSON.stringify({
        capacity: {
            thresholds: {
                requestRate: { warning: 1, critical: 2, dedicatedReview: 3 }
            }
        }
    }));
    const service = createCapacitySloService({ config });

    assert.equal(service.evaluate({ scope: "tenant", tenantId: "tenant-a", metrics: { requestRate: 1 } }).status, "warning");
    assert.equal(service.evaluate({ scope: "tenant", tenantId: "tenant-a", metrics: { requestRate: 2 } }).status, "critical");
    assert.equal(service.evaluate({ scope: "tenant", tenantId: "tenant-a", metrics: { requestRate: 3 } }).status, "dedicated_review");
    assert.equal(service.evaluate({ scope: "tenant", tenantId: "tenant-a", metrics: { requestRate: 3 } }).dedicatedReview, true);
});

test("capacity SLO ve platform toplamı request, error, operation ve worker sinyallerini birleştirir", () => {
    const service = createCapacitySloService({ config: loadPlatformScalabilityConfig() });
    const tenant = service.evaluate({
        scope: "tenant",
        tenantId: "tenant-a",
        metrics: { requestRate: 10, latencyP95Ms: 600, latencyP99Ms: 1200, errorRate: 0.02 }
    });
    assert.equal(tenant.slo.status, "violated");

    const platform = service.aggregatePlatform({ tenants: [
        { tenantId: "tenant-a", metrics: { requestRate: 10, errorRate: 0.1, firestoreOperations: 4, workerConcurrency: 1, workerCapacity: 2 } },
        { tenantId: "tenant-b", metrics: { requestRate: 30, errorRate: 0, firestoreOperations: 6, workerConcurrency: 2, workerCapacity: 4 } }
    ] });
    assert.equal(platform.tenantCount, 2);
    assert.equal(platform.metrics.requestRate, 40);
    assert.equal(platform.metrics.errorRate, 0.025);
    assert.equal(platform.metrics.operationLoad, 10);
    assert.equal(platform.metrics.workerUtilization, 0.5);
});

test("geçersiz scalability config fail-closed kapanır", () => {
    assert.throws(() => loadPlatformScalabilityConfig(JSON.stringify({
        capacity: { slo: { p95LatencyMs: 5000, p99LatencyMs: 1000 } }
    })), /SLO latency threshold sırası/);
    assert.throws(() => loadPlatformScalabilityConfig('{"__proto__":{"x":1}}'), /güvenli olmayan/);
});

test("routing shared, shard ve dedicated placement çözer; cache tenantlar arasında karışmaz", async () => {
    const registry = createInMemoryPlacementRegistry([
        placement("tenant-a"),
        placement("tenant-b", { placementType: "shard", placementId: "shard-b", shardId: "shard-b" }),
        placement("tenant-c", { placementType: "dedicated", placementId: "dedicated-c" })
    ]);
    const routing = createTenantRoutingService({ registry, cacheTtlMs: 1000 });

    assert.equal((await routing.resolve({ context: admin, tenantId: "tenant-a" })).placementType, "shared");
    assert.equal((await routing.resolve({ context: admin, tenantId: "tenant-b" })).placementId, "shard-b");
    assert.equal((await routing.resolve({ context: admin, tenantId: "tenant-c" })).placementType, "dedicated");
    await assert.rejects(
        routing.resolve({ context: { role: "tenant_admin", tenantId: "tenant-a" }, tenantId: "tenant-b" }),
        error => error.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("routing missing, inactive, invalid shard ve cross-tenant mutation kayıtlarını reddeder", async () => {
    const registry = createInMemoryPlacementRegistry([
        placement("tenant-a"),
        placement("tenant-b", { status: "inactive" })
    ]);
    const events = [];
    const routing = createTenantRoutingService({
        registry,
        auditWriter: { async write(event) { events.push(event); } }
    });
    await assert.rejects(routing.resolve({ context: admin, tenantId: "tenant-missing" }), error => error.code === "TENANT_ROUTE_NOT_FOUND");
    await assert.rejects(routing.resolve({ context: admin, tenantId: "tenant-b" }), error => error.code === "TENANT_ROUTE_UNAVAILABLE");
    await assert.rejects(routing.updatePlacement({
        context: admin,
        tenantId: "tenant-a",
        placement: placement("tenant-b", { version: 2 })
    }), error => error.code === "TENANT_BOUNDARY_VIOLATION");
    await assert.rejects(routing.updatePlacement({
        context: admin,
        tenantId: "tenant-a",
        placement: placement("tenant-a", { placementType: "shard", placementId: "shard-a", shardId: "wrong", version: 2 })
    }), error => error.code === "INVALID_SHARD_BINDING");

    const saved = await routing.updatePlacement({
        context: admin,
        tenantId: "tenant-a",
        placement: placement("tenant-a", { placementType: "dedicated", placementId: "dedicated-a", version: 2 })
    });
    assert.equal(saved.placementType, "dedicated");
    assert.equal(events[0].action, "tenant.placement.updated");
});

test("Firestore placement adapter yalnız exact tenant dokümanını okur", async () => {
    const reads = [];
    const collection = {
        doc(id) {
            return {
                async get() {
                    reads.push(id);
                    return { exists: true, data: () => placement(id) };
                },
                async set() {}
            };
        }
    };
    const registry = createFirestorePlacementRegistry({ db: { collection() { return collection; } } });
    const result = await registry.get("tenant-a");
    assert.equal(result.tenantId, "tenant-a");
    assert.deepEqual(reads, ["tenant-a"]);
});

test("telemetry histogram gerçek p95/p99 üretir ve eski aggregate için güvenli fallback kullanır", () => {
    const descriptor = getAggregationPeriod("daily", "2026-09-04T10:00:00.000Z");
    let aggregate = emptyUsageAggregate("tenant-a", descriptor);
    for (let index = 0; index < 99; index += 1) {
        aggregate = mergeUsageAggregate(aggregate, createUsageDelta({
            tenantId: "tenant-a", operation: "menu.read", operationClass: "read",
            timestamp: "2026-09-04T10:00:00.000Z", latencyMs: index < 95 ? 100 : 1500
        }), descriptor);
    }
    const output = presentUsageAggregate(aggregate);
    assert.equal(output.latencyP95Ms, 100);
    assert.equal(output.latencyP99Ms, 2000);

    const legacy = presentUsageAggregate({ ...aggregate, latencyBuckets: undefined, latencyMaxMs: 321 });
    assert.equal(legacy.latencyP95Ms, 321);
    assert.equal(legacy.latencyP99Ms, 321);
});
