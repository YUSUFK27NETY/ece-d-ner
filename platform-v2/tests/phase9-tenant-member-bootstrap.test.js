const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    ROLE_PERMISSIONS
} = require("../src/auth/authorize-tenant-action");
const {
    createTenantContext
} = require("../src/tenant/tenant-context");
const {
    TENANT_STATUSES,
    createTenantRecord
} = require("../src/tenant/tenant-record");
const {
    ASSIGNABLE_TENANT_BOOTSTRAP_ROLES,
    MEMBER_BOOTSTRAP_INTENT_STATUS,
    createBootstrapIdentity
} = require("../src/onboarding/tenant-member-bootstrap-contract");
const {
    DUPLICATE_CODE,
    createTenantMemberBootstrapService
} = require("../src/onboarding/tenant-member-bootstrap-service");
const {
    createCustomerReadinessSourceAdapters
} = require("../src/onboarding/customer-readiness-adapters");
const {
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");

const NOW = new Date("2026-09-08T16:30:00.000Z");

function ownerContext(tenantId = "second-tenant") {
    return createTenantContext({
        tenantId,
        role: "tenant_owner",
        actorId: "owner-1"
    });
}

function command(overrides = {}) {
    return {
        context: ownerContext(),
        tenantId: "second-tenant",
        subjectRef: "subject_01HX9K6QF6A1",
        kind: "member",
        role: "tenant_admin",
        requestId: "request-123",
        ...overrides
    };
}

function atomicRegistry() {
    const records = new Map();
    let createCalls = 0;

    return Object.freeze({
        records,
        get createCalls() { return createCalls; },
        registry: Object.freeze({
            async create(intent) {
                createCalls += 1;
                if (records.has(intent.bootstrapId)) {
                    const error = new Error("raw duplicate storage marker");
                    error.code = DUPLICATE_CODE;
                    throw error;
                }
                records.set(intent.bootstrapId, intent);
            }
        })
    });
}

function createHarness({ registryState = atomicRegistry() } = {}) {
    const audit = [];
    const service = createTenantMemberBootstrapService({
        registry: registryState.registry,
        auditWriter: {
            async write(event) { audit.push(event); }
        },
        clock: () => new Date(NOW)
    });

    return { service, audit, registryState };
}

test("assignable bootstrap rolleri mevcut tenant rollerinden türetilir ve platform_admin içermez", () => {
    assert.deepEqual(ASSIGNABLE_TENANT_BOOTSTRAP_ROLES, [
        "tenant_owner", "tenant_admin", "staff", "viewer"
    ]);
    assert.equal(ASSIGNABLE_TENANT_BOOTSTRAP_ROLES.includes("platform_admin"), false);
    assert.equal(Object.isFrozen(ASSIGNABLE_TENANT_BOOTSTRAP_ROLES), true);
});

test("initial_owner yalnız tenant_owner üretebilir", async () => {
    const { service, registryState } = createHarness();

    await assert.rejects(
        () => service.createIntent(command({
            kind: "initial_owner",
            role: "tenant_admin"
        })),
        TypeError
    );
    assert.equal(registryState.createCalls, 0);

    const result = await service.createIntent(command({
        kind: "initial_owner",
        role: "tenant_owner"
    }));
    assert.equal(result.kind, "initial_owner");
    assert.equal(result.role, "tenant_owner");
});

test("normal member bootstrap tenant_owner oluşturamaz veya ownership transfer edemez", async () => {
    const { service, registryState } = createHarness();

    await assert.rejects(
        () => service.createIntent(command({ role: "tenant_owner" })),
        TypeError
    );
    assert.equal(registryState.createCalls, 0);
});

test("aynı tenant tenant_owner members.manage ile sabit ve frozen intent projectionı alır", async () => {
    const { service, registryState } = createHarness();
    const result = await service.createIntent(command());

    assert.deepEqual(Object.keys(result), [
        "schemaVersion",
        "bootstrapId",
        "idempotencyKey",
        "tenantId",
        "kind",
        "role",
        "status",
        "externalIdentityWorkRequired",
        "createdAt"
    ]);
    assert.equal(result.status, MEMBER_BOOTSTRAP_INTENT_STATUS);
    assert.equal(result.externalIdentityWorkRequired, true);
    assert.equal(result.tenantId, "second-tenant");
    assert.equal(Object.isFrozen(result), true);
    assert.equal(registryState.records.size, 1);
});

test("tenant_admin staff ve viewer mevcut RBAC gereği member yönetemez", async () => {
    for (const role of ["tenant_admin", "staff", "viewer"]) {
        const { service, registryState, audit } = createHarness();
        const context = createTenantContext({
            tenantId: "second-tenant",
            role,
            actorId: `${role}-1`
        });

        await assert.rejects(
            () => service.createIntent(command({ context })),
            error => error?.code === "PERMISSION_DENIED"
        );
        assert.equal(registryState.createCalls, 0, role);
        assert.equal(audit.length, 0, role);
    }
});

test("cross-tenant girişim registry ve audit öncesi mevcut boundary semantiğiyle kapanır", async () => {
    const { service, registryState, audit } = createHarness();

    await assert.rejects(
        () => service.createIntent(command({
            context: ownerContext("other-tenant")
        })),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.equal(registryState.createCalls, 0);
    assert.equal(audit.length, 0);
});

test("Platform Admin canonical exact target için bootstrap kontratı hazırlayabilir", async () => {
    const { service, registryState } = createHarness();
    const context = Object.freeze({
        role: "platform_admin",
        actorId: "platform-admin-1"
    });
    const result = await service.createIntent(command({ context }));

    assert.equal(result.tenantId, "second-tenant");
    assert.equal(registryState.records.size, 1);
});

test("invalid ve non-canonical tenantId fail-closed reddedilir", async () => {
    for (const tenantId of ["invalid tenant", "SECOND-TENANT", " second-tenant "]) {
        const { service, registryState } = createHarness();
        await assert.rejects(
            () => service.createIntent(command({ tenantId })),
            TypeError
        );
        assert.equal(registryState.createCalls, 0, tenantId);
    }
});

test("subjectRef opaque canonical identifier olmalı; email ve telefon-benzeri değerler reddedilir", async () => {
    for (const subjectRef of [
        "member@example.invalid",
        "+905551112233",
        "905551112233",
        " subject-1 ",
        "subject/1"
    ]) {
        const { service, registryState } = createHarness();
        await assert.rejects(
            () => service.createIntent(command({ subjectRef })),
            TypeError
        );
        assert.equal(registryState.createCalls, 0, subjectRef);
    }
});

test("hostile secret PII ve provider alanları getter çalıştırmadan reddedilir", async () => {
    const { service, registryState, audit } = createHarness();
    let getterCalls = 0;

    for (const field of [
        "email", "password", "token", "credential", "secret",
        "inviteLink", "providerBody", "rawResponse"
    ]) {
        const input = command();
        Object.defineProperty(input, field, {
            enumerable: true,
            get() {
                getterCalls += 1;
                throw new Error("sensitive getter marker");
            }
        });
        await assert.rejects(() => service.createIntent(input), error => {
            assert.equal(error instanceof TypeError, true);
            assert.equal(error.message.includes("marker"), false);
            return true;
        });
    }

    assert.equal(getterCalls, 0);
    assert.equal(registryState.createCalls, 0);
    assert.equal(audit.length, 0);
});

test("context içindeki hostile alanlar da sabit authorization projectionına giremez", async () => {
    const { service, registryState, audit } = createHarness();
    const context = {
        tenantId: "second-tenant",
        role: "tenant_owner",
        actorId: "owner-1"
    };
    Object.defineProperty(context, "token", {
        enumerable: true,
        get() { throw new Error("context token marker"); }
    });

    await assert.rejects(() => service.createIntent(command({ context })), error => {
        assert.equal(error instanceof TypeError, true);
        assert.equal(error.message.includes("marker"), false);
        return true;
    });
    assert.equal(registryState.createCalls, 0);
    assert.equal(audit.length, 0);
});

test("opaque subject ref projection ve audit içine girmez", async () => {
    const subjectRef = "opaque-subject-do-not-project";
    const { service, audit } = createHarness();
    const result = await service.createIntent(command({ subjectRef }));
    const visible = JSON.stringify({ result, audit });

    assert.equal(visible.includes(subjectRef), false);
    assert.equal("subjectRef" in result, false);
    assert.equal("subjectRef" in audit[0].metadata, false);
});

test("bootstrap identity canonical alanlardan deterministiktir ve duplicate ikinci kayıt veya audit üretmez", async () => {
    const input = command();
    const expectedKey = createBootstrapIdentity({
        tenantId: input.tenantId,
        subjectRef: input.subjectRef,
        kind: input.kind,
        role: input.role
    });
    const { service, registryState, audit } = createHarness();
    const first = await service.createIntent(input);

    assert.equal(first.idempotencyKey, expectedKey);
    await assert.rejects(
        () => service.createIntent(command()),
        error => error?.code === DUPLICATE_CODE &&
            !error.message.includes("raw duplicate storage marker")
    );
    assert.equal(registryState.records.size, 1);
    assert.equal(audit.length, 1);
});

test("audit yalnız safe kind ve role metadata ile tenant actor request korelasyonu taşır", async () => {
    const { service, audit } = createHarness();
    await service.createIntent(command());

    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenantId, "second-tenant");
    assert.equal(audit[0].actorId, "owner-1");
    assert.equal(audit[0].requestId, "request-123");
    assert.equal(audit[0].action, "tenant.member_bootstrap.intent.created");
    assert.deepEqual(audit[0].metadata, {
        kind: "member",
        role: "tenant_admin"
    });
});

test("provider hook veya invitation mutation inputu kontrata kabul edilmez ve çağrılmaz", async () => {
    const { service, registryState, audit } = createHarness();
    let providerCalls = 0;
    const input = command({
        identityProvider: {
            async invite() { providerCalls += 1; }
        }
    });

    await assert.rejects(() => service.createIntent(input), TypeError);
    assert.equal(providerCalls, 0);
    assert.equal(registryState.createCalls, 0);
    assert.equal(audit.length, 0);
});

test("ROLE_PERMISSIONS ve durable tenant status sözleşmeleri değişmeden kalır", () => {
    assert.deepEqual(ROLE_PERMISSIONS, {
        platform_admin: ["*"],
        tenant_owner: [
            "tenant.read", "tenant.update", "catalog.manage", "orders.manage",
            "members.manage", "settings.manage", "audit.read",
            "tenant.telemetry.read", "tenant.cost.read", "tenant.security.read",
            "tenant.operations.read"
        ],
        tenant_admin: [
            "tenant.read", "tenant.update", "catalog.manage", "orders.manage",
            "settings.manage", "audit.read", "tenant.telemetry.read",
            "tenant.cost.read", "tenant.security.read", "tenant.operations.read"
        ],
        staff: ["tenant.read", "catalog.read", "orders.manage"],
        viewer: ["tenant.read", "catalog.read", "orders.read"]
    });
    assert.deepEqual(Array.from(TENANT_STATUSES), [
        "provisioning", "active", "suspended", "archived"
    ]);
});

test("P9 readiness adminBootstrap kaynağını production wiring olmadan unavailable tutar", async () => {
    const adapters = createCustomerReadinessSourceAdapters({
        checkReadiness: async () => ({
            ready: true,
            checkedAt: "2026-09-08T16:29:00.000Z"
        })
    });
    assert.equal(Object.hasOwn(adapters, "adminBootstrap"), false);

    const service = createCustomerReadinessService({
        sourceAdapters: adapters,
        clock: () => NOW.getTime()
    });
    const tenant = createTenantRecord({
        tenantId: "second-tenant",
        displayName: "Second Tenant",
        sector: "restaurant",
        now: new Date("2026-09-08T16:00:00.000Z")
    });
    const readiness = await service.evaluate({
        tenantId: "second-tenant",
        tenant
    });

    assert.deepEqual(readiness.checks.adminBootstrap, {
        status: "unavailable",
        code: null,
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
});

test("P9-3 kaynakları server V1 provider SDK veya production wiring import etmez", () => {
    const workspace = path.resolve(__dirname, "../..");
    const serverSource = fs.readFileSync(
        path.join(workspace, "platform-v2/server.js"),
        "utf8"
    );
    const sources = [
        "tenant-member-bootstrap-contract.js",
        "tenant-member-bootstrap-service.js"
    ].map(file => fs.readFileSync(
        path.join(workspace, "platform-v2/src/onboarding", file),
        "utf8"
    )).join("\n");

    assert.doesNotMatch(sources, /firebase-admin|firebase\/auth|inviteUser|enrollUser|provider SDK/iu);
    assert.doesNotMatch(serverSource, /createTenantMemberBootstrapService/);
});
