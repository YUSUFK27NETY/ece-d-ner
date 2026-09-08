const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    ACTIVATION_READINESS_SOURCES,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const NOW_MS = Date.parse("2026-09-08T16:00:00.000Z");
const OBSERVED_AT = "2026-09-08T15:59:00.000Z";

function tenantFixture(tenantId = "second-tenant") {
    return createTenantRecord({
        tenantId,
        displayName: "Second Tenant",
        sector: "restaurant",
        now: new Date("2026-09-08T15:00:00.000Z")
    });
}

function issuedReadinessService() {
    const sourceAdapters = {};
    for (const source of ACTIVATION_READINESS_SOURCES) {
        sourceAdapters[source] = {
            async evaluate({ tenantId }) {
                return {
                    source,
                    tenantId,
                    status: "ready",
                    code: null,
                    observedAt: OBSERVED_AT,
                    providerPayload: "must-not-enter-api"
                };
            }
        };
    }
    return createCustomerReadinessService({
        sourceAdapters,
        clock: () => NOW_MS
    });
}

function registryFixture(tenants = new Map([["second-tenant", tenantFixture()]]), calls = []) {
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

async function startTestServer({
    customerReadinessService = issuedReadinessService(),
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
            throw new Error("invalid auth source");
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry,
        customerReadinessService
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

test("customer readiness service injection evaluate kontratını doğrular", () => {
    const base = {
        auth: { async verifyIdToken() { return {}; } },
        tenantRegistry: registryFixture()
    };

    assert.doesNotThrow(() => createPlatformApp(base));
    assert.throws(
        () => createPlatformApp({ ...base, customerReadinessService: {} }),
        TypeError
    );
});

test("readiness GET mevcut Platform Admin auth middleware arkasında kalır", async () => {
    const fixture = await startTestServer();
    const url = `${fixture.baseUrl}/api/platform/tenants/second-tenant/readiness`;

    try {
        const unauthenticated = await fetch(url);
        assert.equal(unauthenticated.status, 401);

        const tenantUser = await fetch(url, {
            headers: { Authorization: "Bearer tenant-token" }
        });
        assert.equal(tenantUser.status, 403);
    } finally {
        await closeServer(fixture.server);
    }
});

test("canonical exact tenantId lookup zorlanır ve eksik tenant 404 döner", async () => {
    const calls = [];
    const fixture = await startTestServer({
        tenantRegistry: registryFixture(new Map([["second-tenant", tenantFixture()]]), calls)
    });

    try {
        for (const tenantId of ["SECOND-TENANT", "invalid%20tenant"]) {
            const response = await fetch(
                `${fixture.baseUrl}/api/platform/tenants/${tenantId}/readiness`,
                { headers: adminHeaders() }
            );
            assert.equal(response.status, 400, tenantId);
        }
        assert.deepEqual(calls, []);

        const missing = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/missing-tenant/readiness`,
            { headers: adminHeaders() }
        );
        assert.equal(missing.status, 404);
        assert.deepEqual(calls, ["missing-tenant"]);
    } finally {
        await closeServer(fixture.server);
    }
});

test("valid Platform Admin GET yalnız issued sabit readiness projection döndürür", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/second-tenant/readiness`,
            { headers: adminHeaders() }
        );
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.deepEqual(Object.keys(body), ["success", "readiness"]);
        assert.deepEqual(Object.keys(body.readiness), [
            "tenantId",
            "lifecycleStatus",
            "activationReadiness",
            "canActivate",
            "checks",
            "evaluatedAt"
        ]);
        assert.deepEqual(Object.keys(body.readiness.checks), ACTIVATION_READINESS_SOURCES);
        for (const source of ACTIVATION_READINESS_SOURCES) {
            assert.deepEqual(Object.keys(body.readiness.checks[source]), [
                "status", "code", "observedAt"
            ]);
        }
        assert.equal(body.readiness.activationReadiness, "ready");
        assert.equal(body.readiness.canActivate, true);
        assert.equal(JSON.stringify(body).includes("must-not-enter-api"), false);
    } finally {
        await closeServer(fixture.server);
    }
});

test("service exception ve forged model generic safe 500 olur", async () => {
    for (const customerReadinessService of [
        {
            async evaluate() {
                const error = new Error("raw-readiness-error-marker");
                error.body = "raw-readiness-body-marker";
                error.token = "raw-readiness-token-marker";
                throw error;
            }
        },
        { async evaluate() { return { activationReadiness: "ready" }; } }
    ]) {
        const fixture = await startTestServer({ customerReadinessService });
        try {
            const { result: response, messages } = await captureConsoleErrors(() =>
                fetch(`${fixture.baseUrl}/api/platform/tenants/second-tenant/readiness`, {
                    headers: adminHeaders()
                })
            );
            const body = await response.json();
            assert.equal(response.status, 500);
            assert.deepEqual(body, {
                success: false,
                message: "Müşteri hazırlığı alınamadı."
            });
            assert.deepEqual(messages, ["Müşteri hazırlığı okunamadı."]);
            for (const marker of ["raw-readiness-error-marker", "raw-readiness-body-marker", "raw-readiness-token-marker"]) {
                assert.equal(JSON.stringify(body).includes(marker), false, marker);
                assert.equal(messages.join(" ").includes(marker), false, marker);
            }
        } finally {
            await closeServer(fixture.server);
        }
    }
});

test("readiness path için mutation endpointleri eklenmez", async () => {
    const fixture = await startTestServer();
    const url = `${fixture.baseUrl}/api/platform/tenants/second-tenant/readiness`;

    try {
        for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
            const response = await fetch(url, {
                method,
                headers: adminHeaders()
            });
            assert.equal(response.status, 404, method);
        }
    } finally {
        await closeServer(fixture.server);
    }
});
