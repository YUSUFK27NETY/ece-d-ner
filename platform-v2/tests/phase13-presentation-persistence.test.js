const test = require("node:test");
const assert = require("node:assert/strict");

const { createTenantRecord } = require("../src/tenant/tenant-record");
const {
    createTenantManagementService
} = require("../src/tenant/tenant-management-service");

function baseInput(overrides = {}) {
    return {
        tenantId: "test-tenant",
        displayName: "Test Tenant",
        sector: "barber",
        plan: "starter",
        features: {},
        profile: {},
        createdBy: "admin-1",
        now: new Date("2026-09-16T12:00:00.000Z"),
        ...overrides
    };
}

test("legacy tenant creation presentation verilmeden mevcut record şeklini korur", () => {
    const tenant = createTenantRecord(baseInput());

    assert.equal(Object.hasOwn(tenant, "presentation"), false);
    assert.equal(tenant.plan, "starter");
});

test("tenant creation explicit presentation ayarını normalize ederek saklar", () => {
    const tenant = createTenantRecord(baseInput({
        plan: "business_pro",
        presentation: { tier: " BUSINESS ", version: 1 }
    }));

    assert.deepEqual(tenant.presentation, {
        tier: "business",
        version: 1
    });
    assert.equal(tenant.plan, "business_pro");
});

test("tenant creation bilinmeyen presentation tierını fail-closed reddeder", () => {
    assert.throws(
        () => createTenantRecord(baseInput({
            presentation: { tier: "enterprise", version: 1 }
        })),
        TypeError
    );
});

test("tenant management presentationı plandan bağımsız günceller", async () => {
    const current = createTenantRecord(baseInput({ plan: "starter" }));
    let persisted = null;
    const service = createTenantManagementService({
        tenantRegistry: {
            async getById() {
                return current;
            },
            async update(id, value) {
                assert.equal(id, "test-tenant");
                persisted = value;
                return value;
            }
        }
    });

    const updated = await service.update({
        tenantId: "test-tenant",
        patch: {
            presentation: { tier: "pro", version: 1 }
        },
        actorId: "admin-2",
        now: new Date("2026-09-16T13:00:00.000Z")
    });

    assert.equal(updated.plan, "starter");
    assert.deepEqual(updated.presentation, { tier: "pro", version: 1 });
    assert.deepEqual(persisted.presentation, { tier: "pro", version: 1 });
});

test("plan update mevcut presentation ayarını değiştirmez", async () => {
    const current = createTenantRecord(baseInput({
        plan: "starter",
        presentation: { tier: "business", version: 1 }
    }));
    const service = createTenantManagementService({
        tenantRegistry: {
            async getById() {
                return current;
            },
            async update(id, value) {
                assert.equal(id, "test-tenant");
                return value;
            }
        }
    });

    const updated = await service.update({
        tenantId: "test-tenant",
        patch: { plan: "business_pro" },
        actorId: "admin-2",
        now: new Date("2026-09-16T13:00:00.000Z")
    });

    assert.equal(updated.plan, "business_pro");
    assert.deepEqual(updated.presentation, { tier: "business", version: 1 });
});

test("tenant management invalid presentation ayarını persist etmez", async () => {
    const current = createTenantRecord(baseInput());
    let updateCalls = 0;
    const service = createTenantManagementService({
        tenantRegistry: {
            async getById() {
                return current;
            },
            async update() {
                updateCalls += 1;
                return current;
            }
        }
    });

    await assert.rejects(
        () => service.update({
            tenantId: "test-tenant",
            patch: { presentation: { tier: "unknown", version: 1 } },
            actorId: "admin-2"
        }),
        TypeError
    );
    assert.equal(updateCalls, 0);
});
