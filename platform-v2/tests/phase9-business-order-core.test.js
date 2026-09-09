const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");

const { createAuditEvent } = require("../src/audit/audit-event");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createProductRecord } = require("../src/catalog/product-model");
const { createOrderService } = require("../src/orders/order-service");
const {
    applyOrderStatus,
    createCanonicalRequestHash,
    createOrderRecord,
    createTenantBoundOrderId,
    normalizeOrderRequest,
    priceOrderItems,
    projectAdminOrder
} = require("../src/orders/order-model");
const {
    assertTrustedTenantResolution,
    issueTrustedTenantResolution
} = require("../src/orders/trusted-tenant-resolution");
const { createFirestoreOrderRepository } = require("../src/firestore/firestore-order-repository");

const NOW = new Date("2026-09-09T18:30:00.000Z");
const IDEMPOTENCY_KEY = "order-request-key-0001";

function config() {
    return Object.freeze({
        plans: Object.freeze({
            default: Object.freeze({
                allowedFeatures: "*",
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }),
            starter: Object.freeze({
                allowedFeatures: Object.freeze(["catalog", "orders"]),
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            })
        }),
        tenantOverrides: Object.freeze({}),
        finops: Object.freeze({ defaultMonthlyRevenue: 2000 })
    });
}

function tenant(id, { plan = "starter", status = "active" } = {}) {
    return Object.freeze({
        tenantId: id,
        displayName: id,
        sector: "restaurant",
        plan,
        status,
        features: Object.freeze({ catalog: true, orders: true })
    });
}

function orderRequest(overrides = {}) {
    return {
        customerName: "Test Customer",
        phone: "05000000000",
        orderType: "delivery",
        address: "Test Address 1",
        note: "Test note",
        items: [{
            productId: "product-1",
            quantity: 2,
            clientPrice: 120
        }],
        ...overrides
    };
}

function product(tenantId, overrides = {}) {
    return createProductRecord({
        tenantId,
        productId: overrides.productId || "product-1",
        draft: {
            name: overrides.name || "Test Döner",
            category: "Main",
            price: overrides.price === undefined ? 120 : overrides.price,
            available: overrides.available === undefined ? true : overrides.available
        },
        now: new Date(NOW)
    });
}

function memoryProductRepository(seed) {
    const records = new Map(seed.map(value => [
        `${value.tenantId}/${value.productId}`,
        value
    ]));
    const calls = [];
    return {
        records,
        calls,
        repository: Object.freeze({
            async getById(tenantId, productId) {
                calls.push([tenantId, productId]);
                return records.get(`${tenantId}/${productId}`) || null;
            }
        })
    };
}

function memoryOrderRepository(seed = []) {
    const records = new Map(seed.map(value => [
        `${value.tenantId}/${value.orderId}`,
        value
    ]));
    const audits = [];
    const calls = [];
    return {
        records,
        audits,
        calls,
        repository: Object.freeze({
            async getById(tenantId, orderId) {
                calls.push(["get", tenantId, orderId]);
                return records.get(`${tenantId}/${orderId}`) || null;
            },
            async listByTenant(tenantId, { limit }) {
                calls.push(["list", tenantId, limit]);
                return [...records.values()]
                    .filter(order => order.tenantId === tenantId)
                    .slice(0, limit);
            },
            async commitCreate({ order, auditEvent }) {
                calls.push(["create", order.tenantId, order.orderId]);
                const key = `${order.tenantId}/${order.orderId}`;
                const existing = records.get(key);
                if (existing) {
                    if (existing.requestHash !== order.requestHash) {
                        const error = new Error("conflict");
                        error.code = "ORDER_IDEMPOTENCY_CONFLICT";
                        throw error;
                    }
                    return { created: false, order: existing };
                }
                records.set(key, order);
                audits.push(auditEvent);
                return { created: true, order };
            },
            async commitStatusUpdate({ expectedOrder, nextOrder, auditEvent }) {
                calls.push(["status", nextOrder.tenantId, nextOrder.orderId]);
                const key = `${nextOrder.tenantId}/${nextOrder.orderId}`;
                assert.equal(isDeepStrictEqual(records.get(key), expectedOrder), true);
                records.set(key, nextOrder);
                audits.push(auditEvent);
                return nextOrder;
            }
        })
    };
}

function harness({ secondPlan = "starter", secondStatus = "active", productOverrides = {} } = {}) {
    const tenants = new Map([
        ["first-tenant", tenant("first-tenant")],
        ["second-tenant", tenant("second-tenant", {
            plan: secondPlan,
            status: secondStatus
        })]
    ]);
    const tenantCalls = [];
    const tenantRegistry = Object.freeze({
        async getById(id) {
            tenantCalls.push(id);
            return tenants.get(id) || null;
        }
    });
    const firstProduct = product("first-tenant");
    const secondProduct = product("second-tenant", productOverrides);
    const productState = memoryProductRepository([firstProduct, secondProduct]);
    const orderState = memoryOrderRepository();
    let tick = 0;
    const service = createOrderService({
        tenantRegistry,
        productRepository: productState.repository,
        orderRepository: orderState.repository,
        entitlementService: createEntitlementService({ config: config() }),
        clock: () => new Date(NOW.getTime() + (++tick * 1000))
    });
    return {
        service,
        tenants,
        tenantCalls,
        firstProduct,
        secondProduct,
        productState,
        orderState
    };
}

function trustedSecondTenant() {
    return issueTrustedTenantResolution({
        tenantId: "second-tenant",
        source: "internal_test",
        observedAt: new Date(NOW)
    });
}

function platformAdmin() {
    return Object.freeze({
        role: "platform_admin",
        actorId: "platform-admin-1"
    });
}

test("trusted tenant resolution plain caller object ile forge edilemez", async () => {
    const f = harness();
    const forged = Object.freeze({
        tenantId: "second-tenant",
        source: "internal_test",
        observedAt: NOW.toISOString()
    });
    assert.throws(
        () => assertTrustedTenantResolution(forged),
        error => error?.code === "TRUSTED_TENANT_RESOLUTION_REQUIRED"
    );
    await assert.rejects(
        () => f.service.createCustomerOrder({
            resolution: forged,
            request: orderRequest(),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "TRUSTED_TENANT_RESOLUTION_REQUIRED"
    );
    assert.deepEqual(f.tenantCalls, []);
    assert.deepEqual(f.productState.calls, []);
    assert.deepEqual(f.orderState.calls, []);
});

test("second-tenant customer order canonical fiyatla bir kez oluşturulur ve customer response PII içermez", async () => {
    const f = harness();
    const resolution = trustedSecondTenant();
    const result = await f.service.createCustomerOrder({
        resolution,
        request: orderRequest(),
        idempotencyKey: IDEMPOTENCY_KEY,
        requestId: "req-order-1"
    });

    assert.equal(result.tenantId, "second-tenant");
    assert.equal(result.total, 240);
    assert.equal(result.items[0].price, 120);
    assert.equal(result.status, "pending");
    const visible = JSON.stringify(result);
    for (const marker of ["Test Customer", "+905000000000", "Test Address 1", "Test note"]) {
        assert.equal(visible.includes(marker), false);
    }
    assert.equal(f.orderState.records.size, 1);
    assert.equal(f.orderState.audits.length, 1);
    assert.deepEqual(f.orderState.audits[0].metadata, { orderId: result.orderId });
    const auditText = JSON.stringify(f.orderState.audits[0]);
    assert.equal(auditText.includes("Test Customer"), false);
    assert.equal(auditText.includes("Test Address"), false);
    assert.equal([...f.orderState.records.values()].every(order => order.tenantId === "second-tenant"), true);
});

test("same idempotency request mevcut siparişi döndürür; duplicate product lookup/audit üretmez", async () => {
    const f = harness();
    const resolution = trustedSecondTenant();
    const first = await f.service.createCustomerOrder({
        resolution,
        request: orderRequest(),
        idempotencyKey: IDEMPOTENCY_KEY
    });
    const productCalls = f.productState.calls.length;
    const auditCount = f.orderState.audits.length;
    const second = await f.service.createCustomerOrder({
        resolution,
        request: orderRequest(),
        idempotencyKey: IDEMPOTENCY_KEY
    });
    assert.deepEqual(second, first);
    assert.equal(f.productState.calls.length, productCalls);
    assert.equal(f.orderState.audits.length, auditCount);
    assert.equal(f.orderState.records.size, 1);
});

test("same idempotency key farklı request ile fail-closed conflict olur", async () => {
    const f = harness();
    const resolution = trustedSecondTenant();
    await f.service.createCustomerOrder({
        resolution,
        request: orderRequest(),
        idempotencyKey: IDEMPOTENCY_KEY
    });
    await assert.rejects(
        () => f.service.createCustomerOrder({
            resolution,
            request: orderRequest({ note: "Different safe test note" }),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "ORDER_IDEMPOTENCY_CONFLICT"
    );
    assert.equal(f.orderState.records.size, 1);
    assert.equal(f.orderState.audits.length, 1);
});

test("caller stale price canonical product fiyatını override edemez", async () => {
    const f = harness();
    await assert.rejects(
        () => f.service.createCustomerOrder({
            resolution: trustedSecondTenant(),
            request: orderRequest({
                items: [{ productId: "product-1", quantity: 1, clientPrice: 119 }]
            }),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "ORDER_PRICE_CHANGED"
    );
    assert.equal(f.orderState.records.size, 0);
    assert.equal(f.orderState.audits.length, 0);
});

test("missing unavailable archived product ve inactive tenant order create'i kapatır", async () => {
    const missing = harness();
    await assert.rejects(
        () => missing.service.createCustomerOrder({
            resolution: trustedSecondTenant(),
            request: orderRequest({
                items: [{ productId: "missing-product", quantity: 1 }]
            }),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "ORDER_PRODUCT_UNAVAILABLE"
    );

    const unavailable = harness({ productOverrides: { available: false } });
    await assert.rejects(
        () => unavailable.service.createCustomerOrder({
            resolution: trustedSecondTenant(),
            request: orderRequest({
                items: [{ productId: "product-1", quantity: 1 }]
            }),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "ORDER_PRODUCT_UNAVAILABLE"
    );

    const inactive = harness({ secondStatus: "suspended" });
    await assert.rejects(
        () => inactive.service.createCustomerOrder({
            resolution: trustedSecondTenant(),
            request: orderRequest(),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "TENANT_NOT_ACTIVE"
    );
});

test("unknown plan default policy orders izin verse bile fail-closed olur", async () => {
    const f = harness({ secondPlan: "ghost-plan" });
    await assert.rejects(
        () => f.service.createCustomerOrder({
            resolution: trustedSecondTenant(),
            request: orderRequest(),
            idempotencyKey: IDEMPOTENCY_KEY
        }),
        error => error?.code === "ENTITLEMENT_PLAN_UNRESOLVED"
    );
    assert.equal(f.orderState.records.size, 0);
});

test("cross-tenant tenant owner admin order path repository erişiminden önce reddedilir", async () => {
    const f = harness();
    const context = Object.freeze({
        tenantId: "first-tenant",
        actorId: "first-owner",
        role: "tenant_owner"
    });
    await assert.rejects(
        () => f.service.listAdmin({
            context,
            tenantId: "second-tenant"
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.deepEqual(f.tenantCalls, []);
    assert.deepEqual(f.orderState.calls, []);
});

test("admin list/read/status controlled graph ile çalışır; terminal ve repeated state güvenli", async () => {
    const f = harness();
    const customer = await f.service.createCustomerOrder({
        resolution: trustedSecondTenant(),
        request: orderRequest(),
        idempotencyKey: IDEMPOTENCY_KEY
    });
    const context = platformAdmin();
    const list = await f.service.listAdmin({ context, tenantId: "second-tenant" });
    assert.equal(list.length, 1);
    assert.equal(list[0].customer.name, "Test Customer");
    assert.equal("requestHash" in list[0], false);

    const read = await f.service.getAdmin({
        context,
        tenantId: "second-tenant",
        orderId: customer.orderId
    });
    assert.equal(read.orderId, customer.orderId);

    for (const status of ["preparing", "ready", "completed"]) {
        const updated = await f.service.updateStatus({
            context,
            tenantId: "second-tenant",
            orderId: customer.orderId,
            status,
            requestId: `req-${status}`
        });
        assert.equal(updated.status, status);
    }
    const auditCount = f.orderState.audits.length;
    const repeated = await f.service.updateStatus({
        context,
        tenantId: "second-tenant",
        orderId: customer.orderId,
        status: "completed"
    });
    assert.equal(repeated.status, "completed");
    assert.equal(f.orderState.audits.length, auditCount);

    await assert.rejects(
        () => f.service.updateStatus({
            context,
            tenantId: "second-tenant",
            orderId: customer.orderId,
            status: "cancelled"
        }),
        error => error?.code === "ORDER_STATUS_INVALID_TRANSITION"
    );
    const statusAudits = f.orderState.audits.filter(event => event.action === "order.status.updated");
    assert.equal(statusAudits.length, 3);
    for (const event of statusAudits) {
        assert.deepEqual(Object.keys(event.metadata).sort(), ["fromStatus", "orderId", "toStatus"]);
        const text = JSON.stringify(event);
        assert.equal(text.includes("Test Customer"), false);
        assert.equal(text.includes("Test Address"), false);
    }
});

function fakeFirestore() {
    const docs = new Map();
    const writes = [];

    function snapshot(path) {
        return docs.has(path)
            ? {
                exists: true,
                id: path.split("/").at(-1),
                data: () => ({ ...docs.get(path) })
            }
            : {
                exists: false,
                id: path.split("/").at(-1),
                data: () => undefined
            };
    }

    const db = Object.freeze({
        doc(path) {
            return Object.freeze({
                path,
                async get() { return snapshot(path); }
            });
        },
        collection(path) {
            return Object.freeze({
                orderBy(field, direction) {
                    assert.equal(field, "createdAt");
                    assert.equal(direction, "desc");
                    return Object.freeze({
                        limit(limit) {
                            return Object.freeze({
                                async get() {
                                    const prefix = `${path}/`;
                                    const rows = [...docs.entries()]
                                        .filter(([key]) => key.startsWith(prefix) &&
                                            !key.slice(prefix.length).includes("/"))
                                        .sort(([, a], [, b]) => String(b.createdAt)
                                            .localeCompare(String(a.createdAt)))
                                        .slice(0, limit)
                                        .map(([key, data]) => ({
                                            id: key.slice(prefix.length),
                                            data: () => ({ ...data })
                                        }));
                                    return { docs: rows };
                                }
                            });
                        }
                    });
                }
            });
        },
        async runTransaction(callback) {
            const staged = [];
            const transaction = Object.freeze({
                async get(ref) { return snapshot(ref.path); },
                create(ref, data) {
                    if (docs.has(ref.path) || staged.some(row => row.path === ref.path)) {
                        throw new Error("already exists");
                    }
                    staged.push({ type: "create", path: ref.path, data: { ...data } });
                },
                update(ref, data) {
                    if (!docs.has(ref.path)) throw new Error("missing");
                    staged.push({ type: "update", path: ref.path, data: { ...data } });
                }
            });
            const result = await callback(transaction);
            for (const row of staged) {
                docs.set(row.path, row.type === "update"
                    ? { ...docs.get(row.path), ...row.data }
                    : { ...row.data });
                writes.push(row);
            }
            return result;
        }
    });
    return { db, docs, writes };
}

function canonicalOrderFixture() {
    const normalized = normalizeOrderRequest(orderRequest());
    const requestHash = createCanonicalRequestHash(normalized);
    const priced = priceOrderItems({
        tenantId: "second-tenant",
        requestedItems: normalized.items,
        productsById: new Map([["product-1", product("second-tenant")]])
    });
    const orderId = createTenantBoundOrderId("second-tenant", IDEMPOTENCY_KEY);
    const order = createOrderRecord({
        tenantId: "second-tenant",
        orderId,
        requestHash,
        normalizedRequest: normalized,
        priced,
        now: new Date(NOW)
    });
    return { order, orderId };
}

test("Firestore order repository exact tenant order/audit paths ile atomic idempotent create yapar", async () => {
    const state = fakeFirestore();
    const repository = createFirestoreOrderRepository({ db: state.db });
    const { order, orderId } = canonicalOrderFixture();
    const audit = createAuditEvent({
        tenantId: "second-tenant",
        action: "order.created",
        requestId: "req-create",
        metadata: { orderId },
        now: new Date(NOW)
    });
    const first = await repository.commitCreate({ order, auditEvent: audit });
    assert.equal(first.created, true);
    assert.equal(state.docs.has(`tenants/second-tenant/orders/${orderId}`), true);
    assert.equal(state.docs.has(`tenants/second-tenant/audit/${audit.eventId}`), true);
    const writeCount = state.writes.length;

    const repeatAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "order.created",
        requestId: "req-repeat",
        metadata: { orderId },
        now: new Date(NOW)
    });
    const repeated = await repository.commitCreate({ order, auditEvent: repeatAudit });
    assert.equal(repeated.created, false);
    assert.equal(state.writes.length, writeCount);
    assert.equal(state.docs.has(`tenants/second-tenant/audit/${repeatAudit.eventId}`), false);
    assert.equal([...state.docs.keys()].some(path => path.includes("first-tenant")), false);
});

test("Firestore order repository stale status update fail-closed; safe projection unknown stored fields sızdırmaz", async () => {
    const state = fakeFirestore();
    const repository = createFirestoreOrderRepository({ db: state.db });
    const { order, orderId } = canonicalOrderFixture();
    const createAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "order.created",
        metadata: { orderId },
        now: new Date(NOW)
    });
    await repository.commitCreate({ order, auditEvent: createAudit });

    const raw = state.docs.get(`tenants/second-tenant/orders/${orderId}`);
    raw.providerBody = "raw-provider-marker";
    raw.token = "raw-token-marker";
    state.docs.set(`tenants/second-tenant/orders/${orderId}`, raw);
    const fetched = await repository.getById("second-tenant", orderId);
    const projected = projectAdminOrder(fetched);
    assert.equal(JSON.stringify(projected).includes("raw-provider-marker"), false);
    assert.equal(JSON.stringify(projected).includes("raw-token-marker"), false);

    const next = applyOrderStatus(fetched, "preparing", new Date("2026-09-09T18:31:00.000Z"));
    state.docs.set(`tenants/second-tenant/orders/${orderId}`, {
        ...state.docs.get(`tenants/second-tenant/orders/${orderId}`),
        status: "cancelled"
    });
    const statusAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "order.status.updated",
        actorId: "platform-admin-1",
        metadata: {
            orderId,
            fromStatus: "pending",
            toStatus: "preparing"
        },
        now: new Date("2026-09-09T18:31:00.000Z")
    });
    await assert.rejects(
        () => repository.commitStatusUpdate({
            expectedOrder: fetched,
            nextOrder: next,
            auditEvent: statusAudit
        }),
        error => error?.code === "ORDER_STATE_CHANGED"
    );
    assert.equal(state.docs.has(`tenants/second-tenant/audit/${statusAudit.eventId}`), false);
});
