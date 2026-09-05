const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPlatformScalabilityConfig } = require("../src/config/platform-scalability-config");
const { createCapacitySloService } = require("../src/capacity/capacity-slo-service");
const { createTenantOperationsService } = require("../src/operations/tenant-operations-service");

const context = { role: "platform_admin", actorId: "phase7-admin" };

function usage(period) {
    return {
        tenantId: "tenant-a", period, periodStart: "2026-09-04", requestCount: 100,
        errorCount: 2, latencyAverageMs: 80, latencyMaxMs: 900,
        latencyP95Ms: 500, latencyP99Ms: 1000, lastError: null,
        providerUsage: { firestoreReads: 50, firestoreWrites: 10, r2BandwidthBytes: 2048 },
        backup: null
    };
}

test("operations response Phase 7 özetlerini tenant-bound ve allowlist edilmiş alanlarla döndürür", async () => {
    const config = loadPlatformScalabilityConfig();
    const service = createTenantOperationsService({
        tenantRegistry: {
            async getById(id) { return id === "tenant-a" ? { tenantId: id, plan: "starter" } : null; }
        },
        usageTelemetry: { async getAggregate({ period }) { return usage(period); } },
        entitlementService: {
            evaluate() {
                return {
                    plan: "starter", featureEnabled: true, usedDefaultPlanPolicy: false,
                    limit: { softLimit: 1000, usage: 100, usageRatio: 0.1, status: "normal", warning: false, dedicatedReview: false }
                };
            }
        },
        finOpsService: {
            async getTenantEstimate() {
                return { estimatedMonthlyTechnicalCost: 12, currency: "USD", infraRevenueRatio: 0.05, status: "normal" };
            }
        },
        securitySignals: { async listTenant() { return []; } },
        capacityService: createCapacitySloService({ config }),
        routingService: {
            async resolve({ tenantId }) {
                assert.equal(tenantId, "tenant-a");
                return {
                    tenantId, placementType: "shard", placementId: "shard-a", region: "eu-west",
                    status: "active", releaseChannel: "canary", cohort: "pilot", version: 3,
                    credential: "must-not-leak"
                };
            }
        },
        migrationService: {
            async getTenantStatus() { return { state: "verified", migrationId: "migration-a", sourcePlacementType: "shared", destinationPlacementType: "shard", updatedAt: "2026-09-04T10:00:00.000Z", objectBody: "must-not-leak" }; }
        },
        jobQueue: {
            async getSummary() { return { backlog: 2, running: 1, deadLetter: 0, workerHealth: "healthy", perTenantConcurrency: 2, token: "must-not-leak" }; }
        },
        tenantCache: {
            async getSummary() { return { publicEntries: 4, fresh: 3, stale: 1, privateStored: 99, lastInvalidatedAt: "2026-09-04T09:00:00.000Z", invalidatedEntries: 2, body: "must-not-leak" }; }
        },
        rolloutService: {
            async getStatus() { return { cohort: "pilot", stage: "canary", health: "healthy", currentVersion: "v6", targetVersion: "v7", rollbackSignal: false, automaticApply: true, secret: "must-not-leak" }; }
        },
        resilienceService: {
            getSummary() { return { status: "degraded", dependencies: [{ dependency: "firestore", status: "degraded", circuit: "half_open", consecutiveFailures: 1, lastErrorCode: "DEPENDENCY_ERROR", rawError: "must-not-leak" }] }; }
        }
    });

    const overview = await service.getOverview({ context, tenantId: "tenant-a", at: new Date("2026-09-04T12:00:00.000Z") });
    assert.equal(overview.placement.type, "shard");
    assert.equal(overview.capacity.sloStatus, "violated");
    assert.equal(overview.migration.state, "verified");
    assert.equal(overview.queue.workerHealth, "healthy");
    assert.equal(overview.cache.privateStored, 0);
    assert.equal(overview.cache.invalidatedEntries, 2);
    assert.equal(overview.release.automaticApply, false);
    assert.equal(overview.resilience.status, "degraded");
    assert.doesNotMatch(JSON.stringify(overview), /must-not-leak|credential|objectBody|rawError/);
});

test("Phase 7 kaynakları yoksa operations görünürlüğü backward-compatible unknown/idle kalır", async () => {
    const service = createTenantOperationsService({
        tenantRegistry: { async getById() { return { tenantId: "tenant-a", plan: "starter" }; } },
        usageTelemetry: { async getAggregate({ period }) { return usage(period); } },
        entitlementService: {
            evaluate() { return { plan: "starter", featureEnabled: true, usedDefaultPlanPolicy: false, limit: { softLimit: null, usage: 0, usageRatio: 0, status: "normal", warning: false, dedicatedReview: false } }; }
        },
        finOpsService: { async getTenantEstimate() { return { status: "unknown" }; } },
        securitySignals: { async listTenant() { return []; } }
    });
    const overview = await service.getOverview({ context, tenantId: "tenant-a" });
    assert.equal(overview.placement.type, "unknown");
    assert.equal(overview.capacity.status, "unknown");
    assert.equal(overview.migration.state, "idle");
    assert.equal(overview.queue.workerHealth, "unknown");
    assert.equal(overview.release.stage, "stable");
    assert.equal(overview.resilience.status, "unknown");
});
