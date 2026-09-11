const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuditEvent } = require("../src/audit/audit-event");
const {
    createFirestoreTenantRegistry
} = require("../src/firestore/firestore-tenant-registry");
const {
    ACTIVATION_READINESS_SOURCES,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    createTenantLifecycleService
} = require("../src/tenant/tenant-lifecycle-service");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const FIRST_TENANT_ID = "synthetic-first-tenant";
const SECOND_TENANT_ID = "synthetic-second-tenant";
const ACTOR_ID = "synthetic-platform-operator";
const OBSERVED_AT = "2026-09-09T10:00:00.000Z";
const EVALUATED_AT_MS = Date.parse("2026-09-09T10:01:00.000Z");
const COMMIT_AT = new Date("2026-09-09T10:02:00.000Z");

function tenantFixture(tenantId = SECOND_TENANT_ID, status = "provisioning") {
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
        now: new Date("2026-09-09T09:00:00.000Z")
    });
}

function readyService() {
    const sourceAdapters = Object.fromEntries(
        ACTIVATION_READINESS_SOURCES.map(source => [source, {
            async evaluate({ tenantId }) {
                return {
                    source,
                    tenantId,
                    status: "ready",
                    code: null,
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

function snapshot(id, value) {
    return {
        id,
        exists: value !== undefined,
        data() {
            return value === undefined ? undefined : structuredClone(value);
        }
    };
}

function createTransactionalDb(initialTenants, {
    failAudit = false,
    beforeTransactionRead = null
} = {}) {
    const tenants = new Map(
        initialTenants.map(tenant => [tenant.tenantId, structuredClone(tenant)])
    );
    const audits = new Map();
    const transactionCalls = [];
    let hookUsed = false;

    const collection = {
        doc(tenantId) {
            return {
                id: tenantId,
                path: `platformTenants/${tenantId}`,
                async get() {
                    return snapshot(tenantId, tenants.get(tenantId));
                },
                async create(value) {
                    tenants.set(tenantId, structuredClone(value));
                },
                async update(value) {
                    tenants.set(tenantId, structuredClone(value));
                }
            };
        },
        orderBy() {
            throw new Error("list is not used by this focused test");
        }
    };

    const db = {
        collection(name) {
            assert.equal(name, "platformTenants");
            return collection;
        },
        doc(path) {
            return { path };
        },
        async runTransaction(handler) {
            const staged = [];
            transactionCalls.push("begin");
            const transaction = {
                async get(ref) {
                    if (!hookUsed && beforeTransactionRead) {
                        hookUsed = true;
                        await beforeTransactionRead({ tenants, audits });
                    }
                    transactionCalls.push(`get:${ref.path}`);
                    return snapshot(ref.id, tenants.get(ref.id));
                },
                update(ref, value) {
                    transactionCalls.push(`update:${ref.path}`);
                    staged.push({ type: "tenant", ref, value: structuredClone(value) });
                },
                create(ref, value) {
                    transactionCalls.push(`create:${ref.path}`);
                    if (failAudit) {
                        const error = new Error("synthetic-firestore-private-marker");
                        error.body = "synthetic-firestore-private-body";
                        throw error;
                    }
                    if (audits.has(ref.path)) {
                        throw new Error("synthetic duplicate audit");
                    }
                    staged.push({ type: "audit", ref, value: structuredClone(value) });
                }
            };

            const result = await handler(transaction);
            for (const write of staged) {
                if (write.type === "tenant") {
                    tenants.set(write.ref.id, write.value);
                } else {
                    audits.set(write.ref.path, write.value);
                }
            }
            transactionCalls.push("commit");
            return result;
        }
    };

    return { db, tenants, audits, transactionCalls };
}

function lifecycle(registry, status = "provisioning") {
    return createTenantLifecycleService({
        tenantRegistry: registry,
        customerReadinessService: readyService(),
        clock: () => new Date(COMMIT_AT)
    });
}

function command() {
    return {
        tenantId: SECOND_TENANT_ID,
        actorId: ACTOR_ID,
        requestId: "p9-7a1-request"
    };
}

test("Firestore lifecycle tenant mutation ve success audit'i tek transaction outcome olarak commit eder", async () => {
    const first = tenantFixture(FIRST_TENANT_ID, "active");
    const second = tenantFixture();
    const state = createTransactionalDb([first, second]);
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = lifecycle(registry);

    const active = await service.activate(command());

    assert.equal(active.status, "active");
    assert.equal(state.tenants.get(SECOND_TENANT_ID).status, "active");
    assert.deepEqual(state.tenants.get(FIRST_TENANT_ID), structuredClone(first));
    assert.equal(state.audits.size, 1);
    const [[auditPath, event]] = [...state.audits.entries()];
    assert.match(
        auditPath,
        /^tenants\/synthetic-second-tenant\/audit\/[0-9a-f-]+$/
    );
    assert.equal(event.tenantId, SECOND_TENANT_ID);
    assert.equal(event.actorId, ACTOR_ID);
    assert.equal(event.requestId, "p9-7a1-request");
    assert.equal(event.action, "tenant.lifecycle.activated");
    assert.equal(state.transactionCalls[0], "begin");
    assert.equal(state.transactionCalls.at(-1), "commit");

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_INVALID_TRANSITION"
    );
    assert.equal(state.audits.size, 1);
});

test("audit create başarısızsa transaction tenant statusunu commit etmez ve raw hata sızdırmaz", async () => {
    const second = tenantFixture();
    const state = createTransactionalDb([second], { failAudit: true });
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = lifecycle(registry);

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_UNAVAILABLE" &&
            !error.message.includes("synthetic-firestore-private")
    );

    assert.equal(state.tenants.get(SECOND_TENANT_ID).status, "provisioning");
    assert.equal(state.audits.size, 0);
    assert.equal(state.transactionCalls.includes("commit"), false);
});

test("readiness sonrasındaki concurrent edit compare-and-commit ile korunur", async () => {
    const second = tenantFixture();
    const state = createTransactionalDb([second], {
        beforeTransactionRead({ tenants }) {
            tenants.set(SECOND_TENANT_ID, {
                ...tenants.get(SECOND_TENANT_ID),
                plan: "synthetic-concurrent-plan"
            });
        }
    });
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = lifecycle(registry);

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_STATE_CHANGED"
    );

    assert.equal(state.tenants.get(SECOND_TENANT_ID).status, "provisioning");
    assert.equal(state.tenants.get(SECOND_TENANT_ID).plan, "synthetic-concurrent-plan");
    assert.equal(state.audits.size, 0);
    assert.equal(state.transactionCalls.includes("commit"), false);
});

test("suspend da concurrent profile/plan editini stale tenant ile overwrite etmez", async () => {
    const second = tenantFixture(SECOND_TENANT_ID, "active");
    const state = createTransactionalDb([second], {
        beforeTransactionRead({ tenants }) {
            tenants.set(SECOND_TENANT_ID, {
                ...tenants.get(SECOND_TENANT_ID),
                plan: "synthetic-live-edit"
            });
        }
    });
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = lifecycle(registry, "active");

    await assert.rejects(
        () => service.suspend(command()),
        error => error?.code === "TENANT_LIFECYCLE_STATE_CHANGED"
    );

    assert.equal(state.tenants.get(SECOND_TENANT_ID).status, "active");
    assert.equal(state.tenants.get(SECOND_TENANT_ID).plan, "synthetic-live-edit");
    assert.equal(state.audits.size, 0);
});

test("atomic persistence capability yoksa sequential fallback yapmadan fail-closed kalır", async () => {
    const tenant = tenantFixture();
    let updateCalls = 0;
    const service = createTenantLifecycleService({
        tenantRegistry: {
            async getById() { return tenant; },
            async update() { updateCalls += 1; return tenant; }
        },
        customerReadinessService: readyService()
    });

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_UNAVAILABLE"
    );
    assert.equal(updateCalls, 0);
});

test("atomic adapter raw provider hatasını safe unavailable'a map eder", async () => {
    const tenant = tenantFixture();
    const service = createTenantLifecycleService({
        tenantRegistry: {
            async getById() { return tenant; },
            async update() { throw new Error("must not be called"); },
            async commitLifecycleTransition() {
                const error = new Error("synthetic-provider-private-marker");
                error.body = "synthetic-provider-private-body";
                throw error;
            }
        },
        customerReadinessService: readyService()
    });

    await assert.rejects(
        () => service.activate(command()),
        error => error?.code === "TENANT_LIFECYCLE_UNAVAILABLE" &&
            !error.message.includes("synthetic-provider-private")
    );
});

test("Firestore atomic commit cross-tenant audit eventini transaction öncesi reddeder", async () => {
    const second = tenantFixture();
    const state = createTransactionalDb([second]);
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const expected = await registry.getById(SECOND_TENANT_ID);
    const next = { ...expected, status: "active" };
    const forgedAudit = createAuditEvent({
        tenantId: FIRST_TENANT_ID,
        action: "tenant.lifecycle.activated",
        actorId: ACTOR_ID,
        requestId: "p9-7a1-forged",
        now: COMMIT_AT
    });

    await assert.rejects(
        () => registry.commitLifecycleTransition({
            tenantId: SECOND_TENANT_ID,
            expectedTenant: expected,
            nextTenant: next,
            auditEvent: forgedAudit
        }),
        TypeError
    );

    assert.equal(state.tenants.get(SECOND_TENANT_ID).status, "provisioning");
    assert.equal(state.audits.size, 0);
    assert.equal(state.transactionCalls.length, 0);
});
