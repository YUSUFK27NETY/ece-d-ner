const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPlatformScalabilityConfig } = require("../src/config/platform-scalability-config");
const { createTenantCache } = require("../src/cache/tenant-cache");
const { createInMemoryRolloutStore } = require("../src/rollout/in-memory-rollout-store");
const { createTenantReleaseRolloutService } = require("../src/rollout/tenant-release-rollout");
const { createDependencyResilienceService } = require("../src/resilience/dependency-resilience");

const admin = { role: "platform_admin", actorId: "phase7-admin" };

function cacheDescriptor(tenantId) {
    return { tenantId, classification: "public_static", resourceType: "menu", resourceId: "main", version: 1 };
}

test("cache key tenant/resource/version bound kalır; poisoning ve cross-tenant okuma reddedilir", async () => {
    const config = loadPlatformScalabilityConfig();
    const cache = createTenantCache({ config });
    await cache.put({ context: admin, ...cacheDescriptor("tenant-a"), value: { title: "A" } });
    await cache.put({ context: admin, ...cacheDescriptor("tenant-b"), value: { title: "B" } });

    assert.deepEqual((await cache.get({ context: admin, ...cacheDescriptor("tenant-a") })).value, { title: "A" });
    assert.deepEqual((await cache.get({ context: admin, ...cacheDescriptor("tenant-b") })).value, { title: "B" });
    await assert.rejects(cache.get({
        context: { role: "tenant_admin", tenantId: "tenant-a" }, ...cacheDescriptor("tenant-b")
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
    await assert.rejects(cache.put({
        context: admin, ...cacheDescriptor("tenant-a"), resourceId: "main|tenant-b", value: {}
    }), /resourceId geçersiz/);
});

test("private/admin cache edilmez; public TTL/SWR ve exact tenant invalidation uygulanır", async () => {
    let nowMs = Date.parse("2026-09-04T10:00:00.000Z");
    const config = loadPlatformScalabilityConfig(JSON.stringify({
        cache: { publicTtlSeconds: 1, staleWhileRevalidateSeconds: 1, maxEntriesPerTenant: 2 }
    }));
    const cache = createTenantCache({ config, now: () => new Date(nowMs) });
    const privateResult = await cache.put({
        context: admin, tenantId: "tenant-a", classification: "private",
        resourceType: "profile", resourceId: "owner", version: 1, value: { credential: "never-store" }
    });
    assert.deepEqual(privateResult, { stored: false, cacheControl: "private, no-store", classification: "private" });
    await cache.put({ context: admin, ...cacheDescriptor("tenant-a"), value: { title: "A" } });
    nowMs += 1000;
    assert.equal((await cache.get({ context: admin, ...cacheDescriptor("tenant-a") })).state, "stale");
    nowMs += 1000;
    assert.equal((await cache.get({ context: admin, ...cacheDescriptor("tenant-a") })).state, "expired");
    await cache.put({ context: admin, ...cacheDescriptor("tenant-a"), value: { title: "A2" } });
    await cache.put({ context: admin, ...cacheDescriptor("tenant-b"), value: { title: "B" } });
    const invalidation = await cache.invalidate({ context: admin, tenantId: "tenant-a" });
    assert.equal(invalidation.removed, 1);
    assert.equal((await cache.getSummary({ context: admin, tenantId: "tenant-a" })).invalidatedEntries, 1);
    assert.equal((await cache.getSummary({ context: admin, tenantId: "tenant-b" })).publicEntries, 1);
});

test("release rollout canary → staged → stable ilerler ve sağlıksız sinyal otomatik apply yapmaz", async () => {
    const events = [];
    const service = createTenantReleaseRolloutService({
        store: createInMemoryRolloutStore(),
        auditWriter: { async write(event) { events.push(event); } }
    });
    await service.start({
        context: admin, tenantId: "tenant-a", cohort: "pilot", currentVersion: "v6", targetVersion: "v7"
    });
    await assert.rejects(service.promote({ context: admin, tenantId: "tenant-a", stage: "stable" }), error => error.code === "ROLLOUT_TRANSITION_INVALID");
    assert.equal((await service.promote({ context: admin, tenantId: "tenant-a", stage: "staged" })).stage, "staged");
    const signal = await service.recordHealth({
        context: admin, tenantId: "tenant-a", healthy: false, reasonCode: "error-budget"
    });
    assert.equal(signal.rollbackSignal, true);
    assert.equal(signal.automaticApply, false);
    await assert.rejects(service.promote({ context: admin, tenantId: "tenant-a", stage: "stable" }), error => error.code === "ROLLOUT_TRANSITION_INVALID");
    assert.ok(events.some(event => event.action === "tenant.release.rollback_signaled"));
    await assert.rejects(service.getStatus({
        context: { role: "tenant_admin", tenantId: "tenant-b" }, tenantId: "tenant-a"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
});

test("healthy rollout stable aşamaya geçince hedef sürümü current yapar", async () => {
    const service = createTenantReleaseRolloutService({ store: createInMemoryRolloutStore() });
    await service.start({ context: admin, tenantId: "tenant-a", cohort: "pilot", currentVersion: "v6", targetVersion: "v7" });
    await service.recordHealth({ context: admin, tenantId: "tenant-a", healthy: true });
    await service.promote({ context: admin, tenantId: "tenant-a", stage: "staged" });
    const stable = await service.promote({ context: admin, tenantId: "tenant-a", stage: "stable" });
    assert.equal(stable.currentVersion, "v7");
});

test("provider resilience bounded retry/backoff, circuit, recovery ve güvenli hata kodu sağlar", async () => {
    let nowMs = Date.parse("2026-09-04T10:00:00.000Z");
    const delays = [];
    const signals = [];
    const config = loadPlatformScalabilityConfig(JSON.stringify({
        resilience: {
            timeoutMs: 10, maxAttempts: 3, baseBackoffMs: 2, maxBackoffMs: 4,
            failureThreshold: 3, recoveryMs: 100
        }
    }));
    const service = createDependencyResilienceService({
        config,
        now: () => new Date(nowMs),
        sleep: async delay => delays.push(delay),
        onSignal: async signal => signals.push(signal)
    });
    let attempts = 0;
    await assert.rejects(service.execute({
        dependency: "firestore",
        operation: async () => { attempts += 1; throw new Error("credential=must-not-leak"); }
    }), error => error.code === "DEPENDENCY_ERROR" && !error.message.includes("must-not-leak"));
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [2, 4]);
    assert.equal(service.getStatus("firestore").status, "unavailable");
    assert.equal(service.readiness().healthy, false);
    assert.doesNotMatch(JSON.stringify(signals), /credential|must-not-leak/);
    await assert.rejects(service.execute({ dependency: "firestore", operation: async () => true }), error => error.code === "DEPENDENCY_CIRCUIT_OPEN");
    nowMs += 101;
    assert.equal(await service.execute({ dependency: "firestore", operation: async () => "ok" }), "ok");
    assert.equal(service.getStatus("firestore").status, "healthy");
    assert.equal(service.readiness().healthy, true);
});

test("provider timeout raw provider detayını sızdırmadan normalize edilir", async () => {
    const config = loadPlatformScalabilityConfig(JSON.stringify({
        resilience: { timeoutMs: 10, maxAttempts: 1, failureThreshold: 1, recoveryMs: 100 }
    }));
    const service = createDependencyResilienceService({ config });
    await assert.rejects(service.execute({
        dependency: "object-storage",
        operation: () => new Promise(() => {})
    }), error => error.code === "DEPENDENCY_TIMEOUT" && error.message === "Dependency işlemi tamamlanamadı.");
});

test("tek geçici provider hatası circuit açmadan degraded readiness bırakır", async () => {
    const config = loadPlatformScalabilityConfig(JSON.stringify({
        resilience: { timeoutMs: 10, maxAttempts: 1, failureThreshold: 3, recoveryMs: 100 }
    }));
    const service = createDependencyResilienceService({ config });
    await assert.rejects(service.execute({ dependency: "firestore", operation: async () => { throw new Error("down"); } }));
    assert.equal(service.getStatus("firestore").status, "degraded");
    assert.equal(service.readiness().healthy, true);
});
