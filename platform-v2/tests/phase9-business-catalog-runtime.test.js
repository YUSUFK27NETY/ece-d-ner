const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");

const { createAuditEvent } = require("../src/audit/audit-event");
const { createEntitlementService } = require("../src/entitlements/entitlement-service");
const { createFirestoreProductRepository } = require("../src/firestore/firestore-product-repository");
const { createCatalogService } = require("../src/catalog/catalog-service");
const {
    createProductRecord,
    projectProduct
} = require("../src/catalog/product-model");

const BASE_TIME = new Date("2026-09-09T17:30:00.000Z");

function guardrailsConfig() {
    return Object.freeze({
        plans: Object.freeze({
            default: Object.freeze({
                allowedFeatures: "*",
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }),
            starter: Object.freeze({
                allowedFeatures: Object.freeze(["catalog"]),
                softRequestLimit: null,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            })
        }),
        tenantOverrides: Object.freeze({}),
        finops: Object.freeze({ defaultMonthlyRevenue: 2000 })
    });
}

function tenant(tenantId, { plan = "starter", status = "provisioning" } = {}) {
    return Object.freeze({
        tenantId,
        displayName: tenantId === "first-tenant" ? "First Tenant" : "Second Tenant",
        sector: "restaurant",
        plan,
        status,
        features: Object.freeze({ catalog: true })
    });
}

function ownerContext(tenantId) {
    return Object.freeze({
        tenantId,
        actorId: `${tenantId}-owner`,
        role: "tenant_owner"
    });
}

function adminContext(tenantId) {
    return Object.freeze({
        tenantId,
        actorId: `${tenantId}-admin`,
        role: "tenant_admin"
    });
}

function memoryTenantRegistry(records) {
    const calls = [];
    return {
        calls,
        registry: Object.freeze({
            async getById(tenantId) {
                calls.push(tenantId);
                return records.get(tenantId) || null;
            }
        })
    };
}

function memoryProductRepository(seed = []) {
    const records = new Map();
    const calls = [];
    const audits = [];
    for (const product of seed) {
        records.set(`${product.tenantId}/${product.productId}`, product);
    }
    function key(tenantId, productId) {
        return `${tenantId}/${productId}`;
    }
    return {
        records,
        calls,
        audits,
        repository: Object.freeze({
            async listByTenant(tenantId, { limit = 100 } = {}) {
                calls.push(["list", tenantId, limit]);
                return [...records.values()]
                    .filter(product => product.tenantId === tenantId)
                    .slice(0, limit);
            },
            async getById(tenantId, productId) {
                calls.push(["get", tenantId, productId]);
                return records.get(key(tenantId, productId)) || null;
            },
            async commitCreate({ product, auditEvent }) {
                calls.push(["create", product.tenantId, product.productId]);
                records.set(key(product.tenantId, product.productId), product);
                audits.push(auditEvent);
                return product;
            },
            async commitUpdate({ expectedProduct, nextProduct, auditEvent }) {
                calls.push(["update", nextProduct.tenantId, nextProduct.productId]);
                const current = records.get(key(nextProduct.tenantId, nextProduct.productId));
                assert.equal(isDeepStrictEqual(current, expectedProduct), true);
                records.set(key(nextProduct.tenantId, nextProduct.productId), nextProduct);
                audits.push(auditEvent);
                return nextProduct;
            }
        })
    };
}

function createServiceHarness({ secondPlan = "starter" } = {}) {
    const tenants = new Map([
        ["first-tenant", tenant("first-tenant")],
        ["second-tenant", tenant("second-tenant", { plan: secondPlan })]
    ]);
    const firstProduct = createProductRecord({
        tenantId: "first-tenant",
        productId: "first-product",
        draft: {
            name: "First Product",
            category: "Main",
            price: 100,
            description: "first",
            available: true
        },
        now: new Date(BASE_TIME)
    });
    const tenantState = memoryTenantRegistry(tenants);
    const productState = memoryProductRepository([firstProduct]);
    const entitlementService = createEntitlementService({
        config: guardrailsConfig()
    });
    let tick = 0;
    const service = createCatalogService({
        tenantRegistry: tenantState.registry,
        productRepository: productState.repository,
        entitlementService,
        clock: () => new Date(BASE_TIME.getTime() + (++tick * 1000)),
        idFactory: () => "second-product"
    });
    return { service, tenants, tenantState, productState, firstProduct };
}

test("second tenant gerçek catalog create/list/update/archive akışı first tenantı değiştirmez", async () => {
    const { service, productState, firstProduct } = createServiceHarness();
    const context = ownerContext("second-tenant");

    const created = await service.create({
        context,
        tenantId: "second-tenant",
        product: {
            name: "Second Döner",
            category: "Döner",
            price: 220,
            description: "Second tenant product",
            available: true
        },
        requestId: "req-create-1"
    });
    assert.equal(created.tenantId, "second-tenant");
    assert.equal(created.productId, "second-product");
    assert.equal(created.archived, false);

    const listed = await service.list({
        context: adminContext("second-tenant"),
        tenantId: "second-tenant"
    });
    assert.deepEqual(listed.map(item => item.productId), ["second-product"]);

    const updated = await service.update({
        context,
        tenantId: "second-tenant",
        productId: "second-product",
        patch: { price: 240, description: "catalog-private-description-marker" },
        requestId: "req-update-1"
    });
    assert.equal(updated.price, 240);
    assert.equal(updated.description, "catalog-private-description-marker");

    const archived = await service.archive({
        context,
        tenantId: "second-tenant",
        productId: "second-product",
        requestId: "req-archive-1"
    });
    assert.equal(archived.archived, true);
    assert.equal(archived.available, false);

    const visible = await service.list({ context, tenantId: "second-tenant" });
    assert.deepEqual(visible, []);
    const all = await service.list({
        context,
        tenantId: "second-tenant",
        includeArchived: true
    });
    assert.equal(all.length, 1);
    assert.equal(all[0].archived, true);

    assert.equal(productState.records.get("first-tenant/first-product"), firstProduct);
    assert.equal(productState.audits.length, 3);
    assert.deepEqual(productState.audits.map(event => event.action), [
        "catalog.product.created",
        "catalog.product.updated",
        "catalog.product.archived"
    ]);
    for (const event of productState.audits) {
        assert.equal(event.tenantId, "second-tenant");
        assert.equal(event.actorId, "second-tenant-owner");
        assert.deepEqual(event.metadata, { productId: "second-product" });
        const serialized = JSON.stringify(event);
        assert.equal(serialized.includes("Second Döner"), false);
        assert.equal(serialized.includes("catalog-private-description-marker"), false);
    }
});

test("cross-tenant owner repository veya tenant registry erişiminden önce fail-closed olur", async () => {
    const { service, tenantState, productState } = createServiceHarness();

    await assert.rejects(
        () => service.create({
            context: ownerContext("first-tenant"),
            tenantId: "second-tenant",
            product: { name: "Blocked", category: "Main", price: 10 }
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.deepEqual(tenantState.calls, []);
    assert.deepEqual(productState.calls, []);
    assert.equal(productState.records.has("second-tenant/second-product"), false);
});

test("staff ve viewer catalog management path kullanamaz", async () => {
    for (const role of ["staff", "viewer"]) {
        const { service, tenantState, productState } = createServiceHarness();
        const context = Object.freeze({
            tenantId: "second-tenant",
            actorId: `${role}-1`,
            role
        });
        await assert.rejects(
            () => service.list({ context, tenantId: "second-tenant" }),
            error => error?.code === "PERMISSION_DENIED"
        );
        assert.deepEqual(tenantState.calls, [], role);
        assert.deepEqual(productState.calls, [], role);
    }
});

test("unknown tenant plan default policy catalogu izin verse bile fail-closed olur", async () => {
    const { service, productState } = createServiceHarness({ secondPlan: "ghost-plan" });

    await assert.rejects(
        () => service.create({
            context: ownerContext("second-tenant"),
            tenantId: "second-tenant",
            product: { name: "Blocked", category: "Main", price: 10 }
        }),
        error => error?.code === "ENTITLEMENT_PLAN_UNRESOLVED"
    );
    assert.equal(productState.records.has("second-tenant/second-product"), false);
    assert.equal(productState.audits.length, 0);
});

test("archived product normal update yolundan değiştirilemez ve tekrar archive audit üretmez", async () => {
    const { service, productState } = createServiceHarness();
    const context = ownerContext("second-tenant");
    await service.create({
        context,
        tenantId: "second-tenant",
        product: { name: "Archive Me", category: "Main", price: 20 }
    });
    await service.archive({
        context,
        tenantId: "second-tenant",
        productId: "second-product"
    });
    const auditsBefore = productState.audits.length;

    await assert.rejects(
        () => service.update({
            context,
            tenantId: "second-tenant",
            productId: "second-product",
            patch: { price: 30 }
        }),
        error => error?.code === "PRODUCT_ARCHIVED"
    );
    const repeated = await service.archive({
        context,
        tenantId: "second-tenant",
        productId: "second-product"
    });
    assert.equal(repeated.archived, true);
    assert.equal(productState.audits.length, auditsBefore);
});

test("caller productId veya provider benzeri draft alanı enjekte edemez", async () => {
    const { service, productState } = createServiceHarness();
    for (const field of ["productId", "tenantId", "token", "providerBody", "credential"]) {
        await assert.rejects(
            () => service.create({
                context: ownerContext("second-tenant"),
                tenantId: "second-tenant",
                product: {
                    name: "Safe Product",
                    category: "Main",
                    price: 10,
                    [field]: "hostile-marker"
                }
            }),
            TypeError
        );
    }
    assert.equal(productState.records.has("second-tenant/second-product"), false);
});

function fakeFirestore() {
    const docs = new Map();
    const transactionWrites = [];

    function snapshotFor(path) {
        return docs.has(path)
            ? {
                exists: true,
                id: path.split("/").at(-1),
                data: () => ({ ...docs.get(path) })
            }
            : { exists: false, id: path.split("/").at(-1), data: () => undefined };
    }

    function ref(path) {
        return Object.freeze({
            path,
            async get() { return snapshotFor(path); }
        });
    }

    const db = Object.freeze({
        doc(path) {
            return ref(path);
        },
        collection(path) {
            return Object.freeze({
                orderBy(field, direction) {
                    assert.equal(field, "createdAt");
                    assert.equal(direction, "asc");
                    return Object.freeze({
                        limit(limit) {
                            return Object.freeze({
                                async get() {
                                    const prefix = `${path}/`;
                                    const matching = [...docs.entries()]
                                        .filter(([key]) => key.startsWith(prefix) &&
                                            !key.slice(prefix.length).includes("/"))
                                        .sort(([, a], [, b]) => String(a.createdAt)
                                            .localeCompare(String(b.createdAt)))
                                        .slice(0, limit)
                                        .map(([key, data]) => ({
                                            id: key.slice(prefix.length),
                                            data: () => ({ ...data })
                                        }));
                                    return { docs: matching };
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
                async get(documentRef) {
                    return snapshotFor(documentRef.path);
                },
                create(documentRef, data) {
                    if (docs.has(documentRef.path) ||
                        staged.some(item => item.path === documentRef.path)) {
                        throw new Error("already exists");
                    }
                    staged.push({ type: "create", path: documentRef.path, data: { ...data } });
                },
                update(documentRef, data) {
                    if (!docs.has(documentRef.path)) {
                        throw new Error("missing");
                    }
                    staged.push({ type: "update", path: documentRef.path, data: { ...data } });
                }
            });
            const result = await callback(transaction);
            for (const write of staged) {
                docs.set(write.path, write.type === "update"
                    ? { ...docs.get(write.path), ...write.data }
                    : { ...write.data });
                transactionWrites.push(write);
            }
            return result;
        }
    });

    return { db, docs, transactionWrites };
}

test("Firestore product repository exact tenant product/audit yollarında atomic create+update yapar", async () => {
    const state = fakeFirestore();
    const repository = createFirestoreProductRepository({ db: state.db });
    const product = createProductRecord({
        tenantId: "second-tenant",
        productId: "product-1",
        draft: { name: "Döner", category: "Main", price: 200 },
        now: new Date(BASE_TIME)
    });
    const createAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "catalog.product.created",
        actorId: "owner-1",
        requestId: "req-1",
        metadata: { productId: "product-1" },
        now: new Date(BASE_TIME)
    });

    await repository.commitCreate({ product, auditEvent: createAudit });
    assert.equal(state.docs.has("tenants/second-tenant/products/product-1"), true);
    assert.equal(state.docs.has(`tenants/second-tenant/audit/${createAudit.eventId}`), true);
    assert.equal([...state.docs.keys()].some(path => path.includes("first-tenant")), false);

    const stored = state.docs.get("tenants/second-tenant/products/product-1");
    stored.providerBody = "raw-provider-marker";
    stored.token = "raw-token-marker";
    state.docs.set("tenants/second-tenant/products/product-1", stored);

    const fetched = await repository.getById("second-tenant", "product-1");
    assert.deepEqual(Object.keys(projectProduct(fetched)), [
        "schemaVersion", "tenantId", "productId", "name", "category", "price",
        "description", "imageUrl", "available", "archived", "createdAt", "updatedAt"
    ]);
    assert.equal(JSON.stringify(fetched).includes("raw-provider-marker"), false);
    assert.equal(JSON.stringify(fetched).includes("raw-token-marker"), false);

    const next = Object.freeze({
        ...fetched,
        price: 210,
        updatedAt: "2026-09-09T17:31:00.000Z"
    });
    const updateAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "catalog.product.updated",
        actorId: "owner-1",
        requestId: "req-2",
        metadata: { productId: "product-1" },
        now: new Date("2026-09-09T17:31:00.000Z")
    });
    await repository.commitUpdate({
        expectedProduct: fetched,
        nextProduct: next,
        auditEvent: updateAudit
    });
    assert.equal(state.docs.get("tenants/second-tenant/products/product-1").price, 210);
    assert.equal(state.docs.has(`tenants/second-tenant/audit/${updateAudit.eventId}`), true);
    assert.equal(state.transactionWrites.filter(write => write.path.includes("/products/")).length, 2);
    assert.equal(state.transactionWrites.filter(write => write.path.includes("/audit/")).length, 2);
});

test("Firestore repository stale expected state ve cross-tenant stored tenant markerında fail-closed olur", async () => {
    const state = fakeFirestore();
    const repository = createFirestoreProductRepository({ db: state.db });
    const product = createProductRecord({
        tenantId: "second-tenant",
        productId: "product-1",
        draft: { name: "Döner", category: "Main", price: 200 },
        now: new Date(BASE_TIME)
    });
    const audit = createAuditEvent({
        tenantId: "second-tenant",
        action: "catalog.product.created",
        actorId: "owner-1",
        metadata: { productId: "product-1" },
        now: new Date(BASE_TIME)
    });
    await repository.commitCreate({ product, auditEvent: audit });

    const expected = await repository.getById("second-tenant", "product-1");
    state.docs.set("tenants/second-tenant/products/product-1", {
        ...state.docs.get("tenants/second-tenant/products/product-1"),
        price: 205
    });
    const next = Object.freeze({ ...expected, price: 210, updatedAt: "2026-09-09T17:31:00.000Z" });
    const updateAudit = createAuditEvent({
        tenantId: "second-tenant",
        action: "catalog.product.updated",
        actorId: "owner-1",
        metadata: { productId: "product-1" },
        now: new Date("2026-09-09T17:31:00.000Z")
    });
    await assert.rejects(
        () => repository.commitUpdate({ expectedProduct: expected, nextProduct: next, auditEvent: updateAudit }),
        error => error?.code === "CATALOG_PRODUCT_STATE_CHANGED"
    );

    state.docs.set("tenants/second-tenant/products/product-2", {
        ...product,
        productId: "product-2",
        tenantId: "first-tenant"
    });
    await assert.rejects(
        () => repository.getById("second-tenant", "product-2"),
        TypeError
    );
});