const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createAuditEvent } = require("../src/audit/audit-event");
const { hasPermission } = require("../src/auth/authorize-tenant-action");
const {
    applyOrderStatus,
    createOrderRecord
} = require("../src/orders/order-model");
const {
    createFirestoreOrderRepository
} = require("../src/firestore/firestore-order-repository");
const {
    TENANT_COLLECTIONS,
    tenantDocument
} = require("../src/firestore/tenant-paths");
const {
    createInventoryRecord,
    createFulfillmentRecord,
    defaultFulfillmentConfig,
    stockStatus
} = require("../src/inventory/inventory-delivery-model");
const {
    createInventoryDeliveryService
} = require("../src/inventory/inventory-delivery-service");

const TENANT_ID = "ela-doner";
const PRODUCT_ID = "doner-1";
const ORDER_ID = `idem_${"1".repeat(40)}`;
const NOW = new Date("2026-09-12T12:00:00.000Z");

function tenant(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        displayName: "Ela Döner",
        status: "active",
        plan: "starter",
        features: {
            catalog: true,
            orders: true,
            appointments: false,
            reservations: false,
            whatsapp: true,
            inventory: true,
            quotes: false,
            fleet: false,
            gallery: true
        },
        ...overrides
    };
}

function inventoryRecord(quantity, lowStockThreshold = 2, trackingEnabled = true) {
    return createInventoryRecord({
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        input: { trackingEnabled, quantity, lowStockThreshold },
        now: NOW
    });
}

function fulfillment(overrides = {}) {
    return createFulfillmentRecord({
        tenantId: TENANT_ID,
        input: {
            deliveryEnabled: true,
            pickupEnabled: true,
            takeawayEnabled: true,
            dineInEnabled: true,
            ...overrides
        },
        now: NOW
    });
}

function createServiceHarness({ currentTenant = tenant(), stock = inventoryRecord(5), config = fulfillment() } = {}) {
    const repository = {
        async listInventory() { return stock ? [stock] : []; },
        async getInventory(tenantId, productId) {
            assert.equal(tenantId, TENANT_ID);
            assert.equal(productId, PRODUCT_ID);
            return stock;
        },
        async commitInventory({ record }) { return record; },
        async getFulfillment(tenantId) {
            assert.equal(tenantId, TENANT_ID);
            return config;
        },
        async commitFulfillment({ record }) { return record; }
    };
    const product = {
        tenantId: TENANT_ID,
        productId: PRODUCT_ID,
        name: "Dürüm Döner",
        category: "Döner",
        price: 190,
        description: "",
        available: true,
        archived: false
    };
    const entitlementService = {
        evaluate({ tenant: value, feature }) {
            return {
                tenantId: value.tenantId,
                feature,
                featureEnabled: value.features?.[feature] === true,
                usedDefaultPlanPolicy: false
            };
        },
        assertFeatureAccess({ tenant: value, feature }) {
            const result = this.evaluate({ tenant: value, feature });
            if (!result.featureEnabled) {
                const error = new Error("disabled");
                error.code = "ENTITLEMENT_DENIED";
                throw error;
            }
            return result;
        }
    };
    const service = createInventoryDeliveryService({
        tenantRegistry: {
            async getById(id) { return id === TENANT_ID ? currentTenant : null; }
        },
        productRepository: {
            async getById(id, productId) {
                return id === TENANT_ID && productId === PRODUCT_ID ? product : null;
            },
            async listByTenant() { return [product]; }
        },
        repository,
        entitlementService,
        clock: () => new Date(NOW)
    });
    return { service, repository };
}

function normalizedRequest(type = "pickup", quantity = 1) {
    return {
        customer: { name: "Yusuf Kaya", phone: "+905321234567" },
        fulfillment: { type, address: type === "delivery" ? "Mersin" : "", tableNumber: "" },
        note: "",
        items: [{ productId: PRODUCT_ID, quantity }]
    };
}

test("stok durumları tükendi, düşük stok, stokta ve takipsiz olarak hesaplanır", () => {
    assert.equal(stockStatus(inventoryRecord(0)), "out_of_stock");
    assert.equal(stockStatus(inventoryRecord(2)), "low_stock");
    assert.equal(stockStatus(inventoryRecord(3)), "in_stock");
    assert.equal(stockStatus(inventoryRecord(3, 2, false)), "untracked");
});

test("fulfillment en az bir açık kanal ister ve varsayılan geriye uyumludur", () => {
    const defaults = defaultFulfillmentConfig(TENANT_ID);
    assert.equal(defaults.deliveryEnabled, true);
    assert.equal(defaults.pickupEnabled, true);
    assert.throws(() => createFulfillmentRecord({
        tenantId: TENANT_ID,
        input: {
            deliveryEnabled: false,
            pickupEnabled: false,
            takeawayEnabled: false,
            dineInEnabled: false
        },
        now: NOW
    }), TypeError);
});

test("kapalı teslimat türü ve yetersiz stok siparişi fail-closed reddeder", async () => {
    const disabled = createServiceHarness({
        config: fulfillment({ deliveryEnabled: false })
    });
    await assert.rejects(
        () => disabled.service.prepareCustomerOrder({
            tenant: tenant(),
            tenantId: TENANT_ID,
            normalizedRequest: normalizedRequest("delivery", 1)
        }),
        error => error?.code === "ORDER_FULFILLMENT_DISABLED"
    );

    const insufficient = createServiceHarness({ stock: inventoryRecord(1) });
    await assert.rejects(
        () => insufficient.service.prepareCustomerOrder({
            tenant: tenant(),
            tenantId: TENANT_ID,
            normalizedRequest: normalizedRequest("pickup", 2)
        }),
        error => error?.code === "ORDER_OUT_OF_STOCK"
    );
});

test("inventory modülü kapalı tenant mevcut sipariş akışını stok rezervasyonu olmadan sürdürür", async () => {
    const currentTenant = tenant({
        features: { ...tenant().features, inventory: false }
    });
    const { service } = createServiceHarness({ currentTenant });
    const result = await service.prepareCustomerOrder({
        tenant: currentTenant,
        tenantId: TENANT_ID,
        normalizedRequest: normalizedRequest("pickup", 99)
    });
    assert.deepEqual(result.stockAdjustments, []);
});

test("owner/admin settings.manage ile stok yönetir; staff/viewer yükseltilmez", () => {
    assert.equal(hasPermission("tenant_owner", "settings.manage"), true);
    assert.equal(hasPermission("tenant_admin", "settings.manage"), true);
    assert.equal(hasPermission("staff", "settings.manage"), false);
    assert.equal(hasPermission("viewer", "settings.manage"), false);
});

test("stok ve rezervasyon yolları tenant sınırında kalır", () => {
    assert.equal(TENANT_COLLECTIONS.inventory, "inventory");
    assert.equal(TENANT_COLLECTIONS.orderInventoryReservations, "orderInventoryReservations");
    assert.equal(
        tenantDocument(TENANT_ID, TENANT_COLLECTIONS.inventory, PRODUCT_ID),
        `tenants/${TENANT_ID}/inventory/${PRODUCT_ID}`
    );
    assert.notEqual(
        tenantDocument("second-tenant", TENANT_COLLECTIONS.inventory, PRODUCT_ID),
        tenantDocument(TENANT_ID, TENANT_COLLECTIONS.inventory, PRODUCT_ID)
    );
});

function createTransactionalDb(initial = {}) {
    const state = new Map(Object.entries(initial).map(([key, value]) => [key, structuredClone(value)]));

    function snapshotFor(ref, source = state) {
        const value = source.get(ref.path);
        return {
            exists: value !== undefined,
            data() { return value === undefined ? undefined : structuredClone(value); }
        };
    }

    const db = {
        state,
        doc(path) {
            return {
                path,
                async get() { return snapshotFor(this); }
            };
        },
        collection(path) {
            return { path };
        },
        async runTransaction(callback) {
            const staged = [];
            const transaction = {
                async get(ref) { return snapshotFor(ref); },
                create(ref, value) {
                    if (state.has(ref.path) || staged.some(item => item.ref.path === ref.path && item.type === "create")) {
                        throw new Error("already exists");
                    }
                    staged.push({ type: "create", ref, value: structuredClone(value) });
                },
                update(ref, patch) {
                    if (!state.has(ref.path)) throw new Error("missing update target");
                    staged.push({ type: "update", ref, value: structuredClone(patch) });
                }
            };
            const result = await callback(transaction);
            for (const item of staged) {
                if (item.type === "create") state.set(item.ref.path, item.value);
                else state.set(item.ref.path, { ...state.get(item.ref.path), ...item.value });
            }
            return result;
        }
    };
    return db;
}

function orderRecord(orderId = ORDER_ID, now = NOW) {
    return createOrderRecord({
        tenantId: TENANT_ID,
        orderId,
        requestHash: "a".repeat(64),
        normalizedRequest: {
            customer: { name: "Yusuf Kaya", phone: "+905321234567" },
            fulfillment: { type: "pickup", address: "", tableNumber: "" },
            note: "",
            items: [{ productId: PRODUCT_ID, quantity: 2 }]
        },
        priced: {
            items: [{ productId: PRODUCT_ID, name: "Dürüm Döner", price: 190, quantity: 2, lineTotal: 380 }],
            total: 380
        },
        now
    });
}

function orderAudit(orderId, action, metadata, now = NOW, actorId = null) {
    return createAuditEvent({
        tenantId: TENANT_ID,
        action,
        actorId,
        requestId: null,
        metadata: { orderId, ...metadata },
        now
    });
}

test("sipariş ve stok düşümü atomiktir; idempotent tekrar çift düşmez ve iptal stok iade eder", async () => {
    const stockPath = `tenants/${TENANT_ID}/inventory/${PRODUCT_ID}`;
    const db = createTransactionalDb({ [stockPath]: inventoryRecord(5) });
    const repository = createFirestoreOrderRepository({ db });
    const order = orderRecord();

    const first = await repository.commitCreate({
        order,
        auditEvent: orderAudit(ORDER_ID, "order.created", {}),
        stockAdjustments: [{ productId: PRODUCT_ID, quantity: 2 }]
    });
    assert.equal(first.created, true);
    assert.equal(db.state.get(stockPath).quantity, 3);

    const second = await repository.commitCreate({
        order,
        auditEvent: orderAudit(ORDER_ID, "order.created", {}),
        stockAdjustments: [{ productId: PRODUCT_ID, quantity: 2 }]
    });
    assert.equal(second.created, false);
    assert.equal(db.state.get(stockPath).quantity, 3);

    const cancelledAt = new Date("2026-09-12T12:10:00.000Z");
    const cancelled = applyOrderStatus(order, "cancelled", cancelledAt);
    await repository.commitStatusUpdate({
        expectedOrder: order,
        nextOrder: cancelled,
        auditEvent: orderAudit(
            ORDER_ID,
            "order.status.updated",
            { fromStatus: "pending", toStatus: "cancelled" },
            cancelledAt,
            "owner-1"
        ),
        restoreInventory: true
    });
    assert.equal(db.state.get(stockPath).quantity, 5);
    const reservationPath = `tenants/${TENANT_ID}/orderInventoryReservations/${ORDER_ID}`;
    assert.equal(db.state.get(reservationPath).restoredAt, cancelledAt.toISOString());
});

test("transaction anındaki stok yetersizse yarış fail-closed kalır ve sipariş yazılmaz", async () => {
    const stockPath = `tenants/${TENANT_ID}/inventory/${PRODUCT_ID}`;
    const db = createTransactionalDb({ [stockPath]: inventoryRecord(1) });
    const repository = createFirestoreOrderRepository({ db });
    const orderId = `idem_${"2".repeat(40)}`;
    const order = orderRecord(orderId);

    await assert.rejects(
        () => repository.commitCreate({
            order,
            auditEvent: orderAudit(orderId, "order.created", {}),
            stockAdjustments: [{ productId: PRODUCT_ID, quantity: 2 }]
        }),
        error => error?.code === "ORDER_OUT_OF_STOCK"
    );
    assert.equal(db.state.has(`tenants/${TENANT_ID}/orders/${orderId}`), false);
    assert.equal(db.state.get(stockPath).quantity, 1);
});

test("owner inventory UI güvenli DOM kullanır ve credential storage yapmaz", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/owner/inventory.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/inventory.js"), "utf8");
    assert.match(html, /Stok & Teslimat/);
    assert.match(script, /textContent/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage/);
    assert.match(script, /platformOwnerTenantId/);
    assert.doesNotMatch(script, /sessionStorage\.setItem\([^,]+,\s*(?:token|password)/i);
});

test("production server inventory repository, service ve owner/public endpointleri wire eder", () => {
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    assert.match(server, /createFirestoreInventoryDeliveryRepository/);
    assert.match(server, /createInventoryDeliveryService/);
    assert.match(server, /inventoryDeliveryService/);
    assert.match(server, /attachInventoryOwnerEndpoints/);
    assert.match(server, /attachPublicFulfillmentRuntime/);
});
