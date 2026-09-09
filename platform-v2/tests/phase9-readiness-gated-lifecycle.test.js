const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    ACTIVATION_READINESS_SOURCES,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    createTenantLifecycleService
} = require("../src/tenant/tenant-lifecycle-service");
const {
    createTenantManagementService
} = require("../src/tenant/tenant-management-service");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const TENANT_ID = "synthetic-second-tenant";
const FIRST_TENANT_ID = "synthetic-first-tenant";
const ACTOR_ID = "synthetic-platform-operator";
const OBSERVED_AT = "2026-09-09T09:00:00.000Z";
const EVALUATED_AT_MS = Date.parse("2026-09-09T09:01:00.000Z");

function tenantFixture(tenantId = TENANT_ID, status = "provisioning") {
    return createTenantRecord({
        tenantId,
        displayName: tenantId === FIRST_TENANT_ID
            ? "Synthetic First Tenant"
            : "Synthetic Second Tenant",
        sector: "restaurant",
        plan: "synthetic-base",
        status,
        profile: {
            brandName: "Synthetic Tenant",
            timezone: "Europe/Istanbul"
        },
        now: new Date("2026-09-09T08:00:00.000Z")
    });
}

function readinessService(profileStatus = "ready") {
    const profileCodes = {
        pending: "PROFILE_INCOMPLETE",
        blocked: "PROFILE_INVALID",
        unavailable: "PROFILE_UNAVAILABLE"
    };
    const sourceAdapters = Object.fromEntries(
        ACTIVATION_READINESS_SOURCES.map(source => [source, {
            async evaluate({ tenantId }) {
                const status = source === "profile" ? profileStatus : "ready";
                return {
                    source,
                    tenantId,
                    status,
                    code: status === "ready" ? null : profileCodes[status],
                    observedAt: OBSERVED_AT
                };
            }
        }])
    );

    return createCustomerReadinessService({
        sourceAdapters,
        clock: () => EVALUATED_AT_MS
    });
}

function registryFixture(initialTenants = [tenantFixture()]) {
    const records = new Map(initialTenants.map(tenant => [tenant.tenantId, tenant]));
    const getCalls = [];
    const updateCalls = [];
    const registry = {
        async getById(tenantId) {
            getCalls.push(tenantId);
            return records.get(tenantId) || null;
        },
        async list({ limit = 100 } = {}) {
            return [...records.values()].slice(0, limit);
        },
        async create(tenant) {
            records.set(tenant.tenantId, tenant);
            return tenant;
        },
        async update(tenantId, tenant) {
            updateCalls.push({ tenantId, tenant });
            records.set(tenantId, tenant);
            return tenant;
        }
    };
    return { records, getCalls, updateCalls, registry };
}

function lifecycleFixture({
    initialTenants,
    readiness = readinessService(),
    clock = () => new Date("2026-09-09T09:05:00.000Z")
} = {}) {
    const state = registryFixture(initialTenants);
    const audit = [];
    const service = createTenantLifecycleService({
        tenantRegistry: state.registry,
        customerReadinessService: readiness,
        auditWriter: {
            async write(event) { audit.push(event); }
        },
        clock
    });
    return { ...state, audit, service };
}

function command(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        actorId: ACTOR_ID,
        requestId: "p9-7a-lifecycle-request",
        ...overrides
    };
}

async function startServer({
    customerReadinessService = readinessService(),
    initialTenants = [tenantFixture()],
    includeAuditWriter = true
} = {}) {
    const state = registryFixture(initialTenants);
    const audit = [];
    const auth = {
        async verifyIdToken(value) {
            if (value === "platform-token") {
                return { uid: ACTOR_ID, platformAdmin: true };
            }
            if (value === "tenant-token") {
                return { uid: "synthetic-tenant-member", platformAdmin: false };
            }
            throw new Error("authentication denied");
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry: state.registry,
        customerReadinessService,
        auditWriter: includeAuditWriter
            ? { async write(event) { audit.push(event); } }
            : null
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        ...state,
        audit,
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function platformHeaders(extra = {}) {
    return { Authorization: "Bearer platform-token", ...extra };
}

async function postLifecycle(fixture, action, tenantId = TENANT_ID, options = {}) {
    return fetch(
        `${fixture.baseUrl}/api/platform/tenants/${tenantId}/lifecycle/${action}`,
        { method: "POST", headers: platformHeaders(), ...options }
    );
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

test("generic PATCH lifecycle bypass ve mixed hazırlık değişikliğini atomik reddeder", async () => {
    const state = registryFixture();
    const audit = [];
    const management = createTenantManagementService({
        tenantRegistry: state.registry,
        auditWriter: { async write(event) { audit.push(event); } }
    });
    const before = state.records.get(TENANT_ID);

    await assert.rejects(
        () => management.update({
            ...command(),
            patch: {
                status: "active",
                plan: "synthetic-expanded",
                profile: { brandName: "Mixed Attempt" }
            }
        }),
        error => error?.code === "TENANT_LIFECYCLE_ACTION_REQUIRED"
    );
    assert.strictEqual(state.records.get(TENANT_ID), before);
    assert.equal(state.updateCalls.length, 0);
    assert.equal(audit.length, 0);

    const prepared = await management.update({
        ...command(),
        patch: {
            status: "provisioning",
            plan: "synthetic-expanded"
        }
    });
    assert.equal(prepared.status, "provisioning");
    assert.equal(prepared.plan, "synthetic-expanded");
});

test("pending blocked ve unavailable issued readiness aktivasyonu reddeder", async () => {
    for (const readinessStatus of ["pending", "blocked", "unavailable"]) {
        const fixture = lifecycleFixture({
            readiness: readinessService(readinessStatus)
        });
        await assert.rejects(
            () => fixture.service.activate(command()),
            error => error?.code === "TENANT_ACTIVATION_NOT_READY"
        );
        assert.equal(fixture.records.get(TENANT_ID).status, "provisioning");
        assert.equal(fixture.updateCalls.length, 0);
        assert.equal(fixture.audit.length, 0);
    }
});

test("eksik throwing veya unissued readiness generic unavailable kalır", async () => {
    const unsafeMarker = "synthetic-adapter-internal-marker";
    for (const readiness of [
        null,
        { async evaluate() { throw new Error(unsafeMarker); } },
        { async evaluate() { return { activationReadiness: "ready", canActivate: true }; } }
    ]) {
        const fixture = lifecycleFixture({ readiness });
        await assert.rejects(
            () => fixture.service.activate(command()),
            error => error?.code === "TENANT_LIFECYCLE_UNAVAILABLE" &&
                !error.message.includes(unsafeMarker)
        );
        assert.equal(fixture.updateCalls.length, 0);
        assert.equal(fixture.audit.length, 0);
    }
});

test("genuine issued readiness provisioning tenantı bir kez aktive eder ve audit korelasyonu üretir", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, "active");
    const secondTenant = tenantFixture();
    const fixture = lifecycleFixture({ initialTenants: [firstTenant, secondTenant] });

    const active = await fixture.service.activate(command());
    assert.equal(active.status, "active");
    assert.strictEqual(fixture.records.get(FIRST_TENANT_ID), firstTenant);
    assert.equal(fixture.updateCalls.length, 1);
    assert.equal(fixture.audit.length, 1);
    assert.equal(fixture.audit[0].action, "tenant.lifecycle.activated");
    assert.equal(fixture.audit[0].tenantId, TENANT_ID);
    assert.equal(fixture.audit[0].actorId, ACTOR_ID);
    assert.equal(fixture.audit[0].requestId, "p9-7a-lifecycle-request");
    assert.deepEqual(fixture.audit[0].metadata, {
        fromStatus: "provisioning",
        toStatus: "active"
    });

    await assert.rejects(
        () => fixture.service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_INVALID_TRANSITION"
    );
    assert.equal(fixture.updateCalls.length, 1);
    assert.equal(fixture.audit.length, 1);
});

test("activation readiness değerlendirmesi sırasında değişen tenant yeniden denemeye kapanır", async () => {
    const state = registryFixture();
    const issued = readinessService();
    const audit = [];
    const wrappedReadiness = {
        async evaluate(input) {
            const result = await issued.evaluate(input);
            state.records.set(TENANT_ID, {
                ...state.records.get(TENANT_ID),
                plan: "synthetic-concurrent-change"
            });
            return result;
        }
    };
    const service = createTenantLifecycleService({
        tenantRegistry: state.registry,
        customerReadinessService: wrappedReadiness,
        auditWriter: { async write(event) { audit.push(event); } }
    });

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_STATE_CHANGED"
    );
    assert.equal(state.records.get(TENANT_ID).status, "provisioning");
    assert.equal(state.updateCalls.length, 0);
    assert.equal(audit.length, 0);
});

test("active suspend ve readiness-gated resume sonrası suspended archived terminal olur", async () => {
    const times = [5, 6, 7, 8].map(minute =>
        new Date(`2026-09-09T09:0${minute}:00.000Z`)
    );
    const fixture = lifecycleFixture({
        initialTenants: [tenantFixture(TENANT_ID, "active")],
        clock: () => times.shift()
    });

    assert.equal((await fixture.service.suspend(command())).status, "suspended");
    assert.equal((await fixture.service.resume(command())).status, "active");
    assert.equal((await fixture.service.suspend(command())).status, "suspended");
    assert.equal((await fixture.service.archive(command())).status, "archived");
    assert.deepEqual(fixture.audit.map(event => event.action), [
        "tenant.lifecycle.suspended",
        "tenant.lifecycle.resumed",
        "tenant.lifecycle.suspended",
        "tenant.lifecycle.archived"
    ]);

    for (const action of ["activate", "suspend", "resume", "archive"]) {
        await assert.rejects(
            () => fixture.service[action](command()),
            error => error?.code === "TENANT_LIFECYCLE_INVALID_TRANSITION"
        );
    }
    assert.equal(fixture.updateCalls.length, 4);
    assert.equal(fixture.audit.length, 4);
});

test("suspended tenant resume için aggregate ready olmadığında yerinde kalır", async () => {
    const fixture = lifecycleFixture({
        initialTenants: [tenantFixture(TENANT_ID, "suspended")],
        readiness: readinessService("pending")
    });
    await assert.rejects(
        () => fixture.service.resume(command()),
        error => error?.code === "TENANT_RESUME_NOT_READY"
    );
    assert.equal(fixture.records.get(TENANT_ID).status, "suspended");
    assert.equal(fixture.updateCalls.length, 0);
    assert.equal(fixture.audit.length, 0);
});

test("activation HTTP yolu middleware arkasında ve canonical exact lookup ile sınırlıdır", async () => {
    const fixture = await startServer();
    const url = `${fixture.baseUrl}/api/platform/tenants/${TENANT_ID}/lifecycle/activate`;
    try {
        assert.equal((await fetch(url, { method: "POST" })).status, 401);
        assert.equal((await fetch(url, {
            method: "POST",
            headers: { Authorization: "Bearer tenant-token" }
        })).status, 403);

        for (const invalidId of ["SYNTHETIC-SECOND-TENANT", "invalid%20tenant"]) {
            const response = await postLifecycle(fixture, "activate", invalidId);
            assert.equal(response.status, 400, invalidId);
        }
        assert.equal((await postLifecycle(fixture, "activate", "missing-tenant")).status, 404);

        const withBody = await postLifecycle(fixture, "activate", TENANT_ID, {
            headers: platformHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ canActivate: true, checks: {} })
        });
        assert.equal(withBody.status, 400);
        const withUnparsedBody = await postLifecycle(fixture, "activate", TENANT_ID, {
            headers: platformHeaders({ "Content-Type": "text/plain" }),
            body: "synthetic caller readiness input"
        });
        assert.equal(withUnparsedBody.status, 400);
        const withQuery = await fetch(`${url}?canActivate=true`, {
            method: "POST",
            headers: platformHeaders()
        });
        assert.equal(withQuery.status, 400);
        assert.equal(fixture.records.get(TENANT_ID).status, "provisioning");
        assert.equal(fixture.updateCalls.length, 0);
        assert.equal(fixture.audit.length, 0);
    } finally {
        await closeServer(fixture.server);
    }
});

test("HTTP generic PATCH aktivasyonu yapamaz; ayrı activation yolu bir kez audit eder", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, "active");
    const fixture = await startServer({ initialTenants: [firstTenant, tenantFixture()] });
    try {
        const patchResponse = await fetch(
            `${fixture.baseUrl}/api/platform/tenants/${TENANT_ID}`,
            {
                method: "PATCH",
                headers: platformHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({
                    status: "active",
                    plan: "synthetic-expanded"
                })
            }
        );
        assert.equal(patchResponse.status, 409);
        assert.equal(fixture.records.get(TENANT_ID).status, "provisioning");
        assert.equal(fixture.records.get(TENANT_ID).plan, "synthetic-base");
        assert.strictEqual(fixture.records.get(FIRST_TENANT_ID), firstTenant);

        const activation = await postLifecycle(fixture, "activate");
        const body = await activation.json();
        assert.equal(activation.status, 200);
        assert.equal(body.tenant.status, "active");
        assert.equal(fixture.audit.length, 1);
        assert.equal(fixture.audit[0].requestId, activation.headers.get("x-request-id"));
        assert.equal(fixture.audit[0].actorId, ACTOR_ID);

        assert.equal((await postLifecycle(fixture, "activate")).status, 409);
        assert.equal(fixture.audit.length, 1);
        assert.strictEqual(fixture.records.get(FIRST_TENANT_ID), firstTenant);
    } finally {
        await closeServer(fixture.server);
    }
});

test("HTTP readiness exception ve forged model raw ayrıntı sızdırmadan 503 döner", async () => {
    const markers = [
        "synthetic-adapter-error-marker",
        "synthetic-adapter-body-marker",
        "synthetic-adapter-auth-marker"
    ];
    for (const customerReadinessService of [
        {
            async evaluate() {
                const error = new Error(markers[0]);
                error.body = markers[1];
                error.auth = markers[2];
                throw error;
            }
        },
        { async evaluate() { return { activationReadiness: "ready", canActivate: true }; } }
    ]) {
        const fixture = await startServer({ customerReadinessService });
        try {
            const { result: response, messages } = await captureConsoleErrors(
                () => postLifecycle(fixture, "activate")
            );
            const body = await response.json();
            assert.equal(response.status, 503);
            assert.deepEqual(body, {
                success: false,
                message: "Tenant lifecycle işlemi şu anda kullanılamıyor."
            });
            assert.deepEqual(messages, []);
            for (const marker of markers) {
                assert.equal(JSON.stringify(body).includes(marker), false);
                assert.equal(messages.join(" ").includes(marker), false);
            }
            assert.equal(fixture.updateCalls.length, 0);
            assert.equal(fixture.audit.length, 0);
        } finally {
            await closeServer(fixture.server);
        }
    }
});

test("audit veya readiness dependency yoksa lifecycle fail-closed kalır", async () => {
    for (const options of [
        { customerReadinessService: null },
        { includeAuditWriter: false }
    ]) {
        const fixture = await startServer(options);
        try {
            assert.equal((await postLifecycle(fixture, "activate")).status, 503);
            assert.equal(fixture.records.get(TENANT_ID).status, "provisioning");
            assert.equal(fixture.updateCalls.length, 0);
        } finally {
            await closeServer(fixture.server);
        }
    }
});

test("admin form statusu read-only gösterir ve generic PATCH payloadına katmaz", () => {
    const root = path.resolve(__dirname, "..");
    const html = fs.readFileSync(path.join(root, "public/admin/index.html"), "utf8");
    const script = fs.readFileSync(path.join(root, "public/admin/admin.js"), "utf8");

    assert.match(html, /<select id="status" name="status" disabled>/);
    assert.doesNotMatch(script, /status:\s*elements\.status\.value/);
    assert.doesNotMatch(script,
        /fetch\([^)]*lifecycle\/(?:activate|suspend|resume|archive)/);
});
