const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFeatureFlags
} = require("../src/tenant/feature-catalog");
const {
    createTenantRecord
} = require("../src/tenant/tenant-record");
const {
    createTenantOnboardingService
} = require("../src/tenant/onboarding-service");
const {
    createTenantContext
} = require("../src/tenant/tenant-context");
const {
    authorizeTenantAction
} = require("../src/auth/authorize-tenant-action");
const {
    createAuditEvent
} = require("../src/audit/audit-event");
const {
    createFirestoreTenantRegistry
} = require("../src/firestore/firestore-tenant-registry");

test("feature flag kataloğu bilinmeyen anahtarları reddeder", () => {
    const flags = createFeatureFlags({
        orders: true,
        whatsapp: true
    });

    assert.equal(flags.catalog, true);
    assert.equal(flags.orders, true);
    assert.equal(flags.whatsapp, true);
    assert.throws(
        () => createFeatureFlags({ unknown: true }),
        TypeError
    );
});

test("tenant record merkezi registry için stabil metadata üretir", () => {
    const now = new Date("2026-08-31T10:00:00.000Z");
    const tenant = createTenantRecord({
        tenantId: "ece-doner",
        displayName: "Ece Döner",
        sector: "restaurant",
        plan: "starter",
        features: { orders: true, whatsapp: true },
        createdBy: "platform-user-1",
        now
    });

    assert.equal(tenant.schemaVersion, 1);
    assert.equal(tenant.tenantId, "ece-doner");
    assert.equal(tenant.status, "provisioning");
    assert.equal(tenant.features.orders, true);
    assert.equal(tenant.createdAt, now.toISOString());
});

test("onboarding duplicate tenant oluşturmaz ve audit yazar", async () => {
    const stored = new Map();
    const audit = [];
    const tenantRegistry = {
        async getById(id) {
            return stored.get(id) || null;
        },
        async create(tenant) {
            stored.set(tenant.tenantId, tenant);
            return tenant;
        }
    };
    const auditWriter = {
        async write(event) {
            audit.push(event);
        }
    };

    const service = createTenantOnboardingService({
        tenantRegistry,
        auditWriter
    });

    const tenant = await service.onboard({
        tenantId: "ece-doner",
        displayName: "Ece Döner",
        sector: "restaurant",
        features: { orders: true },
        createdBy: "platform-admin"
    });

    assert.equal(tenant.tenantId, "ece-doner");
    assert.equal(stored.size, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "tenant.created");

    await assert.rejects(
        () => service.onboard({
            tenantId: "ece-doner",
            displayName: "Ece Döner",
            sector: "restaurant"
        }),
        error => error?.code === "TENANT_ALREADY_EXISTS"
    );
});

test("platform admin tenant dışı context ile tüm tenantları yönetebilir", () => {
    const platformContext = createTenantContext({
        role: "platform_admin",
        actorId: "platform-admin"
    });

    assert.equal(platformContext.tenantId, null);
    assert.equal(
        authorizeTenantAction({
            context: platformContext,
            tenantId: "ece-doner",
            permission: "tenant.update"
        }),
        true
    );
});

test("tenant rolü başka tenant sınırına geçemez", () => {
    const tenantContext = createTenantContext({
        tenantId: "ece-doner",
        role: "tenant_owner",
        actorId: "owner-1"
    });

    assert.throws(
        () => authorizeTenantAction({
            context: tenantContext,
            tenantId: "baska-isletme",
            permission: "tenant.update"
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("audit event tenant, request ve actor korelasyonunu taşır", () => {
    const event = createAuditEvent({
        tenantId: "ece-doner",
        action: "tenant.settings.updated",
        actorId: "owner-1",
        requestId: "request-123",
        metadata: { field: "isOpen" },
        now: new Date("2026-08-31T11:00:00.000Z")
    });

    assert.equal(event.tenantId, "ece-doner");
    assert.equal(event.requestId, "request-123");
    assert.equal(event.actorId, "owner-1");
    assert.equal(event.createdAt, "2026-08-31T11:00:00.000Z");
    assert.ok(event.eventId);
});

test("Firestore tenant registry adapter platformTenants collection kullanır", async () => {
    const calls = [];
    const docs = new Map();

    const db = {
        collection(name) {
            calls.push(["collection", name]);
            return {
                doc(id) {
                    calls.push(["doc", id]);
                    return {
                        async get() {
                            const value = docs.get(id);
                            return {
                                exists: Boolean(value),
                                id,
                                data() {
                                    return value;
                                }
                            };
                        },
                        async create(value) {
                            if (docs.has(id)) {
                                throw new Error("already exists");
                            }
                            docs.set(id, value);
                        }
                    };
                }
            };
        }
    };

    const registry = createFirestoreTenantRegistry({ db });

    assert.equal(await registry.getById("ece-doner"), null);

    const tenant = createTenantRecord({
        tenantId: "ece-doner",
        displayName: "Ece Döner",
        sector: "restaurant"
    });

    await registry.create(tenant);
    const stored = await registry.getById("ece-doner");

    assert.equal(stored.tenantId, "ece-doner");
    assert.equal(calls[0][1], "platformTenants");
});
