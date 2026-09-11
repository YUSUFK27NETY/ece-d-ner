const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const { createProductRecord } = require("../src/catalog/product-model");
const { createOrderService } = require("../src/orders/order-service");
const {
    issueTrustedTenantResolution
} = require("../src/orders/trusted-tenant-resolution");

const NOW = new Date("2026-09-09T21:00:00.000Z");

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

function context(role) {
    return Object.freeze({
        tenantId: "second-tenant",
        actorId: role === "tenant_owner" ? "owner-second" : "admin-second",
        role
    });
}

test("same-tenant owner ve admin gerçek order list/read/status yönetimini mevcut RBAC ile yapar", async () => {
    const tenant = Object.freeze({
        tenantId: "second-tenant",
        displayName: "Second Tenant",
        sector: "restaurant",
        plan: "starter",
        status: "active",
        features: Object.freeze({ catalog: true, orders: true })
    });
    const product = createProductRecord({
        tenantId: "second-tenant",
        productId: "product-1",
        draft: {
            name: "Second Döner",
            category: "Döner",
            price: 125
        },
        now: new Date(NOW)
    });
    const records = new Map();
    const audits = [];
    const orderRepository = Object.freeze({
        async getById(tenantId, orderId) {
            return records.get(`${tenantId}/${orderId}`) || null;
        },
        async listByTenant(tenantId, { limit }) {
            return [...records.values()]
                .filter(order => order.tenantId === tenantId)
                .slice(0, limit);
        },
        async commitCreate({ order, auditEvent }) {
            const key = `${order.tenantId}/${order.orderId}`;
            const existing = records.get(key);
            if (existing) return Object.freeze({ created: false, order: existing });
            records.set(key, order);
            audits.push(auditEvent);
            return Object.freeze({ created: true, order });
        },
        async commitStatusUpdate({ expectedOrder, nextOrder, auditEvent }) {
            const key = `${expectedOrder.tenantId}/${expectedOrder.orderId}`;
            assert.deepEqual(records.get(key), expectedOrder);
            records.set(key, nextOrder);
            audits.push(auditEvent);
            return nextOrder;
        }
    });
    let tick = 0;
    const service = createOrderService({
        tenantRegistry: {
            async getById(tenantId) {
                return tenantId === "second-tenant" ? tenant : null;
            }
        },
        productRepository: {
            async getById(tenantId, productId) {
                return tenantId === "second-tenant" && productId === "product-1"
                    ? product
                    : null;
            }
        },
        orderRepository,
        entitlementService: createEntitlementService({ config: config() }),
        clock: () => new Date(NOW.getTime() + (++tick * 1000))
    });

    const created = await service.createCustomerOrder({
        resolution: issueTrustedTenantResolution({
            tenantId: "second-tenant",
            source: "internal_test",
            observedAt: new Date(NOW)
        }),
        request: {
            customerName: "Second Customer",
            phone: "05551234567",
            orderType: "dine_in",
            tableNumber: "T3",
            items: [{ productId: "product-1", quantity: 1, clientPrice: 125 }]
        },
        idempotencyKey: "owner-admin-order-00000001"
    });

    const owner = context("tenant_owner");
    const ownerList = await service.listAdmin({
        context: owner,
        tenantId: "second-tenant"
    });
    assert.equal(ownerList.length, 1);
    assert.equal(ownerList[0].orderId, created.orderId);

    const ownerUpdated = await service.updateStatus({
        context: owner,
        tenantId: "second-tenant",
        orderId: created.orderId,
        status: "preparing",
        requestId: "owner-status-request"
    });
    assert.equal(ownerUpdated.status, "preparing");

    const admin = context("tenant_admin");
    const adminRead = await service.getAdmin({
        context: admin,
        tenantId: "second-tenant",
        orderId: created.orderId
    });
    assert.equal(adminRead.status, "preparing");

    const adminUpdated = await service.updateStatus({
        context: admin,
        tenantId: "second-tenant",
        orderId: created.orderId,
        status: "ready",
        requestId: "admin-status-request"
    });
    assert.equal(adminUpdated.status, "ready");

    const statusAudits = audits.filter(event => event.action === "order.status.updated");
    assert.equal(statusAudits.length, 2);
    assert.deepEqual(statusAudits.map(event => event.actorId), [
        "owner-second",
        "admin-second"
    ]);
    assert.equal(statusAudits.every(event => event.tenantId === "second-tenant"), true);
    assert.equal(JSON.stringify(statusAudits).includes("05551234567"), false);
});
