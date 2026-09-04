const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const { createPlatformApp } = require("../src/http/create-platform-app");
const { loadPlatformGuardrailsConfig } = require("../src/config/platform-guardrails-config");
const { createUsageTelemetryService } = require("../src/usage/usage-telemetry");
const { createInMemoryUsageStore } = require("../src/usage/in-memory-usage-store");
const { createSecuritySignalService } = require("../src/security/security-signal");
const {
    createInMemorySecuritySignalStore
} = require("../src/security/in-memory-security-signal-store");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createConfigCostProvider } = require("../src/finops/cost-provider");
const { createFinOpsService } = require("../src/finops/finops-service");
const { createTenantOperationsService } = require("../src/operations/tenant-operations-service");
const { createTenantRateLimiter } = require("../src/security/tenant-rate-limiter");
const { createAbuseMonitor } = require("../src/security/abuse-monitor");

function platformContext() {
    return { role: "platform_admin", actorId: "platform-admin-1" };
}

async function createFixture() {
    const config = loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            starter: {
                allowedFeatures: "*",
                softRequestLimit: 10,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1,
                monthlyRevenueReference: 2000
            }
        },
        finops: {
            rates: {
                requestPer100000: 1000
            },
            sharedMonthlyCosts: {
                renderCompute: 20
            }
        }
    }));
    const tenants = new Map([
        ["tenant-a", {
            tenantId: "tenant-a",
            displayName: "Tenant A",
            sector: "restaurant",
            plan: "starter",
            status: "active",
            features: { catalog: true, orders: true },
            profile: {}
        }],
        ["tenant-b", {
            tenantId: "tenant-b",
            displayName: "Tenant B",
            sector: "barber",
            plan: "starter",
            status: "active",
            features: { catalog: true, appointments: true },
            profile: {}
        }]
    ]);
    const tenantRegistry = {
        async getById(id) { return tenants.get(id) || null; },
        async list({ limit }) { return [...tenants.values()].slice(0, limit); },
        async create(tenant) { tenants.set(tenant.tenantId, tenant); return tenant; },
        async update(id, tenant) { tenants.set(id, tenant); return tenant; }
    };
    const usageTelemetry = createUsageTelemetryService({ store: createInMemoryUsageStore() });
    const securitySignals = createSecuritySignalService({
        store: createInMemorySecuritySignalStore()
    });
    const entitlementService = createEntitlementService({ config, securitySignals });
    const finOpsService = createFinOpsService({
        config,
        costProvider: createConfigCostProvider({ finopsConfig: config.finops }),
        usageTelemetry,
        tenantRegistry,
        securitySignals
    });
    const tenantOperations = createTenantOperationsService({
        tenantRegistry,
        usageTelemetry,
        entitlementService,
        finOpsService,
        securitySignals,
        checkReadiness: async () => ({ ready: true, checks: { firestore: { status: "ok" } } }),
        signalListLimit: 10
    });
    const at = new Date();

    await usageTelemetry.record({
        tenantId: "tenant-a",
        operation: "orders.list",
        operationClass: "read",
        timestamp: at,
        requestCount: 8,
        errorCount: 1,
        latencyMs: 80,
        firestoreReads: 8,
        backup: {
            sizeBytes: 4096,
            objectCount: 2,
            verifiedAt: at,
            restoreDrillAt: at,
            restoreDrillStatus: "passed"
        }
    });
    await securitySignals.emit({
        tenantId: "tenant-a",
        type: "quota_warning",
        severity: "warning",
        requestId: "request-operations",
        operation: "orders.list",
        metadata: { usageRatio: 0.8 }
    });

    return {
        config,
        tenants,
        tenantRegistry,
        usageTelemetry,
        securitySignals,
        finOpsService,
        tenantOperations
    };
}

test("tenant operations overview health, usage, cost, plan, backup ve security özetini birleştirir", async () => {
    const fixture = await createFixture();
    const overview = await fixture.tenantOperations.getOverview({
        context: platformContext(),
        tenantId: "tenant-a"
    });

    assert.equal(overview.health.readiness, "ready");
    assert.equal(overview.usage.monthly.requestCount, 8);
    assert.equal(overview.usage.monthly.errorCount, 1);
    assert.equal(overview.plan.limitStatus, "warning");
    assert.equal(overview.plan.autoDisabled, false);
    assert.equal(overview.backup.restoreDrillStatus, "passed");
    assert.equal(overview.security.byType.quota_warning, 1);
    assert.equal(typeof overview.cost.estimatedMonthlyTechnicalCost, "number");
});

test("cross-tenant operations ve cost görünürlüğü fail-closed reddedilir", async () => {
    const fixture = await createFixture();
    const context = { role: "tenant_owner", actorId: "owner-a", tenantId: "tenant-a" };

    await assert.rejects(fixture.tenantOperations.getOverview({
        context,
        tenantId: "tenant-b"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
    await assert.rejects(fixture.finOpsService.getTenantEstimate({
        context,
        tenantId: "tenant-b"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
});

test("Platform Admin operations API yetkisiz kullanıcıya veri sızdırmaz ve güvenli özet döner", async () => {
    const fixture = await createFixture();
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") return { uid: "platform-admin-1", platformAdmin: true };
            if (token === "tenant-token") return { uid: "tenant-user-1", platformAdmin: false };
            throw new Error("invalid token");
        }
    };
    const abuseMonitor = createAbuseMonitor({
        securitySignals: fixture.securitySignals,
        windowMs: fixture.config.security.authFailureWindowMs,
        threshold: fixture.config.security.authFailureThreshold
    });
    const app = createPlatformApp({
        auth,
        tenantRegistry: fixture.tenantRegistry,
        usageTelemetry: fixture.usageTelemetry,
        tenantRateLimiter: createTenantRateLimiter(),
        tenantRateLimitPolicy: fixture.config.rateLimits.adminTenant,
        securitySignals: fixture.securitySignals,
        abuseMonitor,
        tenantOperations: fixture.tenantOperations,
        finOpsService: fixture.finOpsService
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const denied = await fetch(`${baseUrl}/api/platform/tenants/tenant-a/operations`, {
            headers: { Authorization: "Bearer tenant-token" }
        });
        assert.equal(denied.status, 403);
        assert.equal("overview" in await denied.json(), false);

        const response = await fetch(`${baseUrl}/api/platform/tenants/tenant-a/operations`, {
            headers: { Authorization: "Bearer platform-token" }
        });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.overview.tenantId, "tenant-a");
        assert.equal(body.overview.plan.limitStatus, "warning");
        assert.doesNotMatch(JSON.stringify(body), /platform-token|tenant-token|request body/i);

        await new Promise(resolve => setImmediate(resolve));
        const measured = await fixture.usageTelemetry.getAggregate({
            context: platformContext(),
            tenantId: "tenant-a",
            period: "monthly"
        });
        assert.equal(measured.operationCounts["platform.tenant.operations.read"], 1);
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("Platform Admin top-tenants API limit doğrular ve maliyete göre sıralar", async () => {
    const fixture = await createFixture();
    const app = createPlatformApp({
        auth: {
            async verifyIdToken() {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
        },
        tenantRegistry: fixture.tenantRegistry,
        tenantOperations: fixture.tenantOperations,
        finOpsService: fixture.finOpsService
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const headers = { Authorization: "Bearer token" };

    try {
        const invalid = await fetch(`${baseUrl}/api/platform/finops/top-tenants?limit=101`, { headers });
        assert.equal(invalid.status, 400);

        const response = await fetch(`${baseUrl}/api/platform/finops/top-tenants?limit=1`, { headers });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.finops.estimates.length, 1);
        assert.equal(body.finops.estimates[0].tenantId, "tenant-a");
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("admin UI operasyon görünürlüğünü ayrı API endpointinden yükler", () => {
    const root = path.join(__dirname, "../public/admin");
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const js = fs.readFileSync(path.join(root, "admin.js"), "utf8");

    assert.match(html, /Tenant Health/);
    assert.match(html, /Tenant Usage/);
    assert.match(html, /Tenant Cost/);
    assert.match(html, /Backup \/ DR/);
    assert.match(html, /Security/);
    assert.match(js, /\/operations/);
    assert.doesNotMatch(js, /innerHTML\s*=/);
});
