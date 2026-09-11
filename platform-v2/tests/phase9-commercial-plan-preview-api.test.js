const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const {
    loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const {
    createCommercialPlanPreviewService
} = require("../src/entitlements/commercial-plan-preview-service");
const { createPlatformApp } = require("../src/http/create-platform-app");
const { createTenantRecord } = require("../src/tenant/tenant-record");

function configFixture() {
    return loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            "alpha-plan": {
                allowedFeatures: ["catalog", "orders"],
                softRequestLimit: 100,
                warningThreshold: 0.7,
                dedicatedReviewThreshold: 1.2,
                monthlyRevenueReference: 12345678
            },
            "beta-plan": {
                allowedFeatures: ["catalog", "appointments"],
                softRequestLimit: 200,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1.5,
                monthlyRevenueReference: 87654321
            }
        }
    }));
}

function tenantFixture() {
    return createTenantRecord({
        tenantId: "tenant-a",
        displayName: "Tenant A",
        sector: "restaurant",
        plan: "alpha-plan",
        features: {
            catalog: true,
            orders: true,
            appointments: true
        },
        now: new Date("2026-09-08T17:00:00.000Z")
    });
}

function registryFixture(tenants = new Map([["tenant-a", tenantFixture()]]), calls = []) {
    return {
        async getById(tenantId) {
            calls.push(tenantId);
            return tenants.get(tenantId) || null;
        },
        async list() { return [...tenants.values()]; },
        async create(tenant) { tenants.set(tenant.tenantId, tenant); return tenant; },
        async update(tenantId, tenant) { tenants.set(tenantId, tenant); return tenant; }
    };
}

function actualService(config = configFixture()) {
    return createCommercialPlanPreviewService({
        config,
        entitlementService: createEntitlementService({ config })
    });
}

async function startTestServer({
    commercialPlanPreviewService = actualService(),
    tenantRegistry = registryFixture()
} = {}) {
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (token === "tenant-token") {
                return { uid: "tenant-user-1", platformAdmin: false };
            }
            throw new Error("raw auth marker");
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        commercialPlanPreviewService
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function adminHeaders() {
    return { Authorization: "Bearer platform-token" };
}

async function captureConsoleErrors(action) {
    const original = console.error;
    const messages = [];
    console.error = (...args) => { messages.push(args.join(" ")); };
    try {
        return { result: await action(), messages };
    } finally {
        console.error = original;
    }
}

test("commercial plan preview service injection iki read metodunu doğrular", () => {
    const base = {
        auth: { async verifyIdToken() { return {}; } },
        tenantRegistry: registryFixture()
    };

    assert.doesNotThrow(() => createPlatformApp(base));
    for (const commercialPlanPreviewService of [
        {},
        { getCatalog() {} },
        { preview() {} }
    ]) {
        assert.throws(
            () => createPlatformApp({
                ...base,
                commercialPlanPreviewService
            }),
            TypeError
        );
    }
});

test("plan catalog ve preview GET mevcut Platform Admin middleware arkasında kalır", async () => {
    const fixture = await startTestServer();
    const paths = [
        "/api/platform/plans",
        "/api/platform/tenants/tenant-a/plan-preview?targetPlan=beta-plan"
    ];

    try {
        for (const path of paths) {
            assert.equal((await fetch(`${fixture.baseUrl}${path}`)).status, 401);
            assert.equal((await fetch(`${fixture.baseUrl}${path}`, {
                headers: { Authorization: "Bearer tenant-token" }
            })).status, 403);
        }
    } finally {
        await closeServer(fixture.server);
    }
});

test("catalog endpoint yalnız issued config plan ID catalogunu döndürür", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(`${fixture.baseUrl}/api/platform/plans`, {
            headers: adminHeaders()
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            success: true,
            catalog: {
                schemaVersion: 1,
                planIds: ["alpha-plan", "beta-plan", "default"]
            }
        });
        assert.equal(JSON.stringify(body).includes("allowedFeatures"), false);
        assert.equal(JSON.stringify(body).includes("monthlyRevenueReference"), false);
    } finally {
        await closeServer(fixture.server);
    }
});

test("preview exact tenant lookup yapar; invalid scope 400 ve missing tenant 404 döner", async () => {
    const calls = [];
    const fixture = await startTestServer({
        tenantRegistry: registryFixture(
            new Map([["tenant-a", tenantFixture()]]),
            calls
        )
    });

    try {
        for (const path of [
            "/api/platform/tenants/TENANT-A/plan-preview?targetPlan=beta-plan",
            "/api/platform/tenants/invalid%20tenant/plan-preview?targetPlan=beta-plan",
            "/api/platform/tenants/tenant-a/plan-preview",
            "/api/platform/tenants/tenant-a/plan-preview?targetPlan=beta-plan&targetPlan=alpha-plan"
        ]) {
            const response = await fetch(`${fixture.baseUrl}${path}`, {
                headers: adminHeaders()
            });
            assert.equal(response.status, 400, path);
        }
        assert.deepEqual(calls, []);

        const missing = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/missing-tenant/plan-preview?targetPlan=beta-plan`,
            { headers: adminHeaders() }
        );
        assert.equal(missing.status, 404);
        assert.deepEqual(calls, ["missing-tenant"]);
    } finally {
        await closeServer(fixture.server);
    }
});

test("unknown target plan safe 400 olur ve default preview üretilmez", async () => {
    const fixture = await startTestServer();

    try {
        for (const targetPlan of ["missing-plan", "BETA-PLAN", "constructor"]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/plan-preview?targetPlan=${encodeURIComponent(targetPlan)}`,
                { headers: adminHeaders() }
            );
            const body = await response.json();
            assert.equal(response.status, 400, targetPlan);
            assert.deepEqual(body, {
                success: false,
                message: "Hedef plan yapılandırılmamış."
            });
            assert.equal("preview" in body, false);
        }
    } finally {
        await closeServer(fixture.server);
    }
});

test("valid preview yalnız sabit safe projection döndürür ve fiyat alanı taşımaz", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/tenant-a/plan-preview?targetPlan=beta-plan`,
            { headers: adminHeaders() }
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(body), ["success", "preview"]);
        assert.deepEqual(Object.keys(body.preview), [
            "schemaVersion",
            "tenantId",
            "currentPlan",
            "targetPlan",
            "currentPlanConfigured",
            "currentUsesDefaultPolicyFallback",
            "automaticApply",
            "features",
            "limits"
        ]);
        assert.equal(body.preview.tenantId, "tenant-a");
        assert.equal(body.preview.automaticApply, false);
        assert.equal(body.preview.features.length, 9);
        assert.deepEqual(Object.keys(body.preview.limits), [
            "softRequestLimit",
            "warningThreshold",
            "dedicatedReviewThreshold"
        ]);
        const serialized = JSON.stringify(body);
        for (const marker of [
            "monthlyRevenueReference",
            "customerPrice",
            "priceRecommendation",
            "12345678",
            "87654321"
        ]) {
            assert.equal(serialized.includes(marker), false, marker);
        }
    } finally {
        await closeServer(fixture.server);
    }
});

test("catalog/preview forged result ve raw exception generic safe 500 olur", async () => {
    for (const commercialPlanPreviewService of [
        {
            getCatalog() { return { schemaVersion: 1, planIds: ["default"] }; },
            preview() { return { automaticApply: false }; }
        },
        {
            getCatalog() {
                const error = new Error("raw catalog error marker");
                error.body = "raw config body marker";
                throw error;
            },
            preview() {
                const error = new Error("raw preview error marker");
                error.token = "raw preview token marker";
                throw error;
            }
        }
    ]) {
        const fixture = await startTestServer({ commercialPlanPreviewService });
        try {
            const catalog = await captureConsoleErrors(() => fetch(
                `${fixture.baseUrl}/api/platform/plans`,
                { headers: adminHeaders() }
            ));
            assert.equal(catalog.result.status, 500);
            assert.deepEqual(await catalog.result.json(), {
                success: false,
                message: "Plan kataloğu alınamadı."
            });
            assert.deepEqual(catalog.messages, ["Commercial plan catalog okunamadı."]);

            const preview = await captureConsoleErrors(() => fetch(
                `${fixture.baseUrl}/api/platform/tenants/tenant-a/plan-preview?targetPlan=beta-plan`,
                { headers: adminHeaders() }
            ));
            assert.equal(preview.result.status, 500);
            const body = await preview.result.json();
            assert.deepEqual(body, {
                success: false,
                message: "Plan önizlemesi alınamadı."
            });
            assert.deepEqual(preview.messages, ["Commercial plan preview okunamadı."]);
            const visible = JSON.stringify({ body, messages: preview.messages });
            for (const marker of [
                "raw preview error marker",
                "raw preview token marker",
                "raw config body marker"
            ]) {
                assert.equal(visible.includes(marker), false, marker);
            }
        } finally {
            await closeServer(fixture.server);
        }
    }
});

test("plan preview ve catalog pathleri GET-only kalır; tenant planı mutate edilmez", async () => {
    const tenant = tenantFixture();
    const before = structuredClone(tenant);
    const tenants = new Map([["tenant-a", tenant]]);
    const fixture = await startTestServer({
        tenantRegistry: registryFixture(tenants)
    });

    try {
        for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
            for (const path of [
                "/api/platform/plans",
                "/api/platform/tenants/tenant-a/plan-preview?targetPlan=beta-plan",
                "/api/platform/tenants/tenant-a/plan-preview/apply"
            ]) {
                const response = await fetch(`${fixture.baseUrl}${path}`, {
                    method,
                    headers: adminHeaders()
                });
                assert.equal(response.status, 404, `${method} ${path}`);
            }
        }
        assert.deepEqual(tenants.get("tenant-a"), before);
    } finally {
        await closeServer(fixture.server);
    }
});
