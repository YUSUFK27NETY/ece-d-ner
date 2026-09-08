const test = require("node:test");
const assert = require("node:assert/strict");

const {
    ACTIVATION_READINESS_SOURCE_POLICY,
    ACTIVATION_READINESS_SOURCES,
    ACTIVATION_READINESS_STATUSES,
    REQUIRED_ACTIVATION_READINESS_SOURCES,
    assertCustomerReadiness,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const { createTenantOnboardingService } = require("../src/tenant/onboarding-service");
const { TENANT_STATUSES, createTenantRecord } = require("../src/tenant/tenant-record");

const NOW_MS = Date.parse("2026-09-08T15:00:00.000Z");
const OBSERVED_AT = "2026-09-08T14:59:00.000Z";

function tenantFixture(status = "provisioning") {
    return createTenantRecord({
        tenantId: "second-tenant",
        displayName: "Second Tenant",
        sector: "restaurant",
        status,
        now: new Date("2026-09-08T14:00:00.000Z")
    });
}

function result(status = "ready", overrides = {}) {
    return {
        status,
        code: null,
        observedAt: OBSERVED_AT,
        ...overrides
    };
}

function adapter(value = result()) {
    return {
        async evaluate() {
            return value;
        }
    };
}

function allAdapters(overrides = {}) {
    return Object.fromEntries(
        ACTIVATION_READINESS_SOURCES.map(source => [
            source,
            Object.hasOwn(overrides, source) ? overrides[source] : adapter()
        ])
    );
}

function createService(sourceAdapters = allAdapters()) {
    return createCustomerReadinessService({
        sourceAdapters,
        clock: () => NOW_MS
    });
}

async function evaluate(service, status = "provisioning") {
    return service.evaluate({
        tenantId: "second-tenant",
        tenant: tenantFixture(status)
    });
}

test("Phase 9 readiness enumları durable tenant lifecycle sözleşmesini değiştirmez", () => {
    assert.deepEqual(Array.from(TENANT_STATUSES), [
        "provisioning", "active", "suspended", "archived"
    ]);
    assert.equal(TENANT_STATUSES.has("ready"), false);
    assert.deepEqual(ACTIVATION_READINESS_STATUSES, [
        "pending", "ready", "blocked", "unavailable"
    ]);
    assert.deepEqual(REQUIRED_ACTIVATION_READINESS_SOURCES, [
        "profile", "health", "plan", "adminBootstrap", "backup", "security"
    ]);
    assert.equal(ACTIVATION_READINESS_SOURCE_POLICY.domain.required, false);
});

test("tenantId doğrulaması exact scope uygular ve uyuşmazlıkta adapter çağırmaz", async () => {
    let calls = 0;
    const service = createService(allAdapters({
        profile: {
            async evaluate() {
                calls += 1;
                return result();
            }
        }
    }));

    await assert.rejects(
        () => service.evaluate({ tenantId: "invalid tenant", tenant: tenantFixture() }),
        TypeError
    );
    await assert.rejects(
        () => service.evaluate({ tenantId: "SECOND-TENANT", tenant: tenantFixture() }),
        TypeError
    );
    await assert.rejects(
        () => service.evaluate({
            tenantId: "other-tenant",
            tenant: tenantFixture()
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.equal(calls, 0);
});

test("adapterlara yalnız doğrulanmış exact tenant scope iletilir", async () => {
    const calls = [];
    const tenant = tenantFixture();
    const service = createService(allAdapters({
        profile: {
            async evaluate(input) {
                calls.push(input);
                return result();
            }
        }
    }));

    await service.evaluate({ tenantId: "second-tenant", tenant });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].tenantId, "second-tenant");
    assert.equal(calls[0].tenant, tenant);
    assert.equal(Object.isFrozen(calls[0]), true);
});

test("tüm required kaynaklar ready olduğunda provisioning tenant aktive edilebilir", async () => {
    const readiness = await evaluate(createService());

    assert.equal(readiness.activationReadiness, "ready");
    assert.equal(readiness.canActivate, true);
    assert.equal(readiness.tenantId, "second-tenant");
    assert.equal(readiness.lifecycleStatus, "provisioning");
    assert.equal(readiness.evaluatedAt, "2026-09-08T15:00:00.000Z");
    assert.equal(assertCustomerReadiness(readiness), readiness);
    assert.equal(Object.isFrozen(readiness), true);
    assert.equal(Object.isFrozen(readiness.checks), true);
});

test("blocked required kaynak diğer required durumlara üstün gelir", async () => {
    const readiness = await evaluate(createService(allAdapters({
        profile: adapter(result("pending")),
        health: adapter(result("unavailable")),
        security: adapter(result("blocked", { code: "SECURITY_BLOCKED" }))
    })));

    assert.equal(readiness.activationReadiness, "blocked");
    assert.equal(readiness.canActivate, false);
});

test("unavailable required kaynak pending duruma üstün gelir", async () => {
    const readiness = await evaluate(createService(allAdapters({
        profile: adapter(result("pending")),
        backup: adapter(result("unavailable", { code: "BACKUP_UNAVAILABLE" }))
    })));

    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
});

test("pending required kaynak all-ready sonucunu kapatır", async () => {
    const readiness = await evaluate(createService(allAdapters({
        adminBootstrap: adapter(result("pending", {
            code: "ADMIN_BOOTSTRAP_PENDING"
        }))
    })));

    assert.equal(readiness.activationReadiness, "pending");
    assert.equal(readiness.canActivate, false);
});

test("optional domain sonucu required activation readiness değerini gate etmez", async () => {
    for (const domainStatus of ["blocked", "unavailable", "pending"]) {
        const readiness = await evaluate(createService(allAdapters({
            domain: adapter(result(domainStatus))
        })));

        assert.equal(readiness.checks.domain.status, domainStatus);
        assert.equal(readiness.activationReadiness, "ready");
        assert.equal(readiness.canActivate, true);
    }
});

test("active suspended ve archived tenantlar yeniden aktive edilemez", async () => {
    for (const status of ["active", "suspended", "archived"]) {
        const readiness = await evaluate(createService(), status);

        assert.equal(readiness.activationReadiness, "ready", status);
        assert.equal(readiness.canActivate, false, status);
    }
});

test("adapter exception güvenli unavailable olur ve raw hata response içine sızmaz", async () => {
    const readiness = await evaluate(createService(allAdapters({
        health: {
            async evaluate() {
                const error = new Error("raw-provider-error-marker");
                error.stack = "raw-provider-stack-marker";
                error.body = "raw-provider-body-marker";
                throw error;
            }
        }
    })));
    const serialized = JSON.stringify(readiness);

    assert.deepEqual(readiness.checks.health, {
        status: "unavailable",
        code: null,
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "unavailable");
    for (const marker of [
        "raw-provider-error-marker",
        "raw-provider-stack-marker",
        "raw-provider-body-marker"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("bağlı olmayan runtime kaynakları ready uydurmak yerine unavailable kalır", async () => {
    const readiness = await evaluate(createService({}));

    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
    for (const source of ACTIVATION_READINESS_SOURCES) {
        assert.deepEqual(readiness.checks[source], {
            status: "unavailable",
            code: null,
            observedAt: null
        });
    }
});

test("hostile provider nesnesindeki secret ve PII sabit projeksiyona sızmaz", async () => {
    const hostile = result("ready", {
        token: "opaque-token-marker",
        password: ["opaque", "password", "marker"].join("-"),
        credential: "opaque-credential-marker",
        secret: "opaque-secret-marker",
        body: { nested: "opaque-body-marker" },
        email: "not-returned@example.invalid",
        phone: "+000000000"
    });
    Object.defineProperty(hostile, "rawPrivateKey", {
        enumerable: true,
        get() {
            throw new Error("sensitive accessor invoked");
        }
    });
    const readiness = await evaluate(createService(allAdapters({
        profile: adapter(hostile)
    })));
    const serialized = JSON.stringify(readiness);

    assert.deepEqual(Object.keys(readiness.checks.profile), [
        "status", "code", "observedAt"
    ]);
    for (const marker of [
        "opaque-token-marker",
        "opaque-password-marker",
        "opaque-credential-marker",
        "opaque-secret-marker",
        "opaque-body-marker",
        "not-returned@example.invalid",
        "+000000000",
        "rawPrivateKey"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("unknown source ve status fail-closed reddedilir", async () => {
    assert.throws(
        () => createService({ unknownSource: adapter() }),
        TypeError
    );

    const readiness = await evaluate(createService(allAdapters({
        plan: adapter(result("healthy"))
    })));
    assert.deepEqual(readiness.checks.plan, {
        status: "unavailable",
        code: null,
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "unavailable");

    const wrongSource = await evaluate(createService(allAdapters({
        health: adapter(result("ready", { source: "unknown" }))
    })));
    assert.equal(wrongSource.checks.health.status, "unavailable");
});

test("cross-tenant adapter sonucu başka tenant için readiness üretemez", async () => {
    const readiness = await evaluate(createService(allAdapters({
        backup: adapter(result("ready", { tenantId: "other-tenant" }))
    })));

    assert.deepEqual(readiness.checks.backup, {
        status: "unavailable",
        code: null,
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
});

test("caller-controlled required alanı ve bilinmeyen safe code gate politikasını değiştiremez", async () => {
    const readiness = await evaluate(createService(allAdapters({
        domain: adapter(result("blocked", {
            required: true,
            code: "UNTRUSTED_PROVIDER_CODE"
        }))
    })));

    assert.deepEqual(readiness.checks.domain, {
        status: "unavailable",
        code: null,
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "ready");
    assert.equal(readiness.canActivate, true);
});

test("mevcut onboarding duplicate create davranışı TENANT_ALREADY_EXISTS kalır", async () => {
    const stored = new Map();
    const service = createTenantOnboardingService({
        tenantRegistry: {
            async getById(tenantId) {
                return stored.get(tenantId) || null;
            },
            async create(tenant) {
                stored.set(tenant.tenantId, tenant);
                return tenant;
            }
        }
    });
    const input = {
        tenantId: "second-tenant",
        displayName: "Second Tenant",
        sector: "restaurant"
    };

    await service.onboard(input);
    await assert.rejects(
        () => service.onboard(input),
        error => error?.code === "TENANT_ALREADY_EXISTS"
    );
    assert.equal(stored.size, 1);
});
