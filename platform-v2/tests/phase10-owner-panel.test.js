const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    attachTenantMemberIdentityEndpoints
} = require("../src/http/attach-tenant-member-identity-endpoints");
const {
    attachTenantOwnerRuntime
} = require("../src/http/attach-tenant-owner-runtime");
const { deriveFirebaseSubjectRef } = require("../src/auth/tenant-member-subject");

function createTenant(tenantId = "ela-doner") {
    return {
        tenantId,
        displayName: tenantId === "ela-doner" ? "Ela Döner" : "Başka İşletme",
        sector: "restaurant",
        status: "provisioning",
        plan: "starter",
        features: {
            catalog: true,
            orders: true,
            appointments: false,
            reservations: false,
            whatsapp: true,
            inventory: false,
            quotes: false,
            fleet: false,
            gallery: true
        },
        profile: {
            brandName: tenantId === "ela-doner" ? "ELA DÖNER" : "Başka İşletme",
            primaryColor: "#C62828",
            timezone: "Europe/Istanbul"
        }
    };
}

async function startServer() {
    const tenants = new Map([
        ["ela-doner", createTenant("ela-doner")],
        ["baska-isletme", createTenant("baska-isletme")]
    ]);
    const calls = [];
    const ownerSubject = deriveFirebaseSubjectRef("owner-1");
    const adminSubject = deriveFirebaseSubjectRef("admin-1");
    const staffSubject = deriveFirebaseSubjectRef("staff-1");

    const auth = {
        async verifyIdToken(token) {
            const tokens = {
                "owner-token": { uid: "owner-1", platformAdmin: false },
                "admin-token": { uid: "admin-1", platformAdmin: false },
                "staff-token": { uid: "staff-1", platformAdmin: false },
                "platform-token": { uid: "platform-1", platformAdmin: true }
            };
            if (!tokens[token]) throw new Error("invalid token");
            return tokens[token];
        }
    };

    const tenantRegistry = {
        async getById(id) {
            return tenants.get(id) || null;
        },
        async list() {
            return [...tenants.values()];
        },
        async create(tenant) {
            tenants.set(tenant.tenantId, tenant);
            return tenant;
        },
        async update(id, tenant) {
            tenants.set(id, tenant);
            return tenant;
        }
    };

    const bindingReader = {
        async getBySubject({ tenantId, subjectRef }) {
            if (tenantId !== "ela-doner") return null;
            if (subjectRef === ownerSubject) {
                return { tenantId, subjectRef, role: "tenant_owner", state: "active" };
            }
            if (subjectRef === adminSubject) {
                return { tenantId, subjectRef, role: "tenant_admin", state: "active" };
            }
            if (subjectRef === staffSubject) {
                return { tenantId, subjectRef, role: "staff", state: "active" };
            }
            return null;
        }
    };

    const catalogService = {
        async list(args) {
            calls.push(["catalog.list", args]);
            return [{
                tenantId: args.tenantId,
                productId: "p1",
                name: "Dürüm Döner",
                category: "Döner",
                price: 190,
                description: "Lavaş",
                available: true,
                archived: false,
                createdAt: "2026-09-11T00:00:00.000Z",
                updatedAt: "2026-09-11T00:00:00.000Z"
            }];
        },
        async create(args) {
            calls.push(["catalog.create", args]);
            return { productId: "p2", ...args.product };
        },
        async update(args) {
            calls.push(["catalog.update", args]);
            return { productId: args.productId, ...args.patch };
        },
        async archive(args) {
            calls.push(["catalog.archive", args]);
            return { productId: args.productId, archived: true };
        }
    };

    const orderService = {
        async listAdmin(args) {
            calls.push(["orders.list", args]);
            return [{
                orderId: "idem_1111111111111111111111111111111111111111",
                status: "pending",
                customer: { name: "Test Müşteri", phone: "+905000000000" },
                fulfillment: { type: "dine_in", tableNumber: "4", address: "" },
                items: [],
                total: 190,
                note: "",
                createdAt: "2026-09-11T00:00:00.000Z",
                updatedAt: "2026-09-11T00:00:00.000Z"
            }];
        },
        async getAdmin(args) {
            calls.push(["orders.get", args]);
            return { orderId: args.orderId, status: "pending" };
        },
        async updateStatus(args) {
            calls.push(["orders.status", args]);
            return { orderId: args.orderId, status: args.status };
        }
    };

    const app = createPlatformApp({
        auth,
        tenantRegistry,
        webConfig: {
            apiKey: "owner-web-key",
            authDomain: "platform.example.firebaseapp.com",
            projectId: "platform-example",
            appId: "1:123:web:owner"
        }
    });
    attachTenantMemberIdentityEndpoints({
        app,
        auth,
        bindingReader,
        initialOwnerBootstrapService: {
            async bindInitialOwner() {
                throw new Error("not used");
            }
        },
        allowedOrigins: []
    });
    attachTenantOwnerRuntime({
        app,
        webConfig: {
            apiKey: "owner-web-key",
            authDomain: "platform.example.firebaseapp.com",
            projectId: "platform-example",
            appId: "1:123:web:owner"
        },
        tenantRegistry,
        catalogService,
        orderService
    });

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        calls,
        ownerSubject
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function authHeaders(token, extra = {}) {
    return {
        Authorization: `Bearer ${token}`,
        ...extra
    };
}

test("owner paneli ve Firebase config aynı V2 runtime'dan güvenli CSP ile sunulur", async () => {
    const fixture = await startServer();
    try {
        const panelResponse = await fetch(`${fixture.baseUrl}/owner/`);
        const panel = await panelResponse.text();
        assert.equal(panelResponse.status, 200);
        assert.match(panel, /İşletme Paneli/);
        assert.match(panelResponse.headers.get("content-security-policy"), /www\.gstatic\.com/);
        assert.match(panelResponse.headers.get("content-security-policy"), /frame-ancestors 'none'/);

        const configResponse = await fetch(`${fixture.baseUrl}/owner/config.js`);
        const config = await configResponse.text();
        assert.equal(configResponse.status, 200);
        assert.match(config, /platform-example/);
        assert.doesNotMatch(config, /password|secret/i);
    } finally {
        await closeServer(fixture.server);
    }
});

test("owner overview anonymous/platform/staff erişimini reddeder, exact owner/admin erişimini kabul eder", async () => {
    const fixture = await startServer();
    const path = `${fixture.baseUrl}/api/tenant/tenants/ela-doner/owner/overview`;
    try {
        assert.equal((await fetch(path)).status, 401);
        assert.equal((await fetch(path, { headers: authHeaders("platform-token") })).status, 403);
        assert.equal((await fetch(path, { headers: authHeaders("staff-token") })).status, 403);

        const ownerResponse = await fetch(path, { headers: authHeaders("owner-token") });
        const ownerBody = await ownerResponse.json();
        assert.equal(ownerResponse.status, 200);
        assert.equal(ownerBody.tenant.tenantId, "ela-doner");
        assert.equal(ownerBody.tenant.displayName, "Ela Döner");
        assert.equal(ownerBody.session.role, "tenant_owner");
        assert.equal(ownerBody.tenant.features.catalog, true);
        assert.equal(ownerBody.tenant.features.orders, true);
        assert.equal(Object.hasOwn(ownerBody.tenant, "createdBy"), false);

        const adminResponse = await fetch(path, { headers: authHeaders("admin-token") });
        assert.equal(adminResponse.status, 200);
    } finally {
        await closeServer(fixture.server);
    }
});

test("owner başka tenant için fallback alamaz", async () => {
    const fixture = await startServer();
    try {
        const response = await fetch(
            `${fixture.baseUrl}/api/tenant/tenants/baska-isletme/owner/overview`,
            { headers: authHeaders("owner-token") }
        );
        assert.equal(response.status, 403);
    } finally {
        await closeServer(fixture.server);
    }
});

test("owner catalog işlemleri exact tenant context ve hashed actor ile mevcut servisi yeniden kullanır", async () => {
    const fixture = await startServer();
    const base = `${fixture.baseUrl}/api/tenant/tenants/ela-doner/owner/catalog/products`;
    try {
        const list = await fetch(`${base}?limit=20`, { headers: authHeaders("owner-token") });
        assert.equal(list.status, 200);
        const listCall = fixture.calls.find(([name]) => name === "catalog.list")[1];
        assert.equal(listCall.tenantId, "ela-doner");
        assert.equal(listCall.context.tenantId, "ela-doner");
        assert.equal(listCall.context.role, "tenant_owner");
        assert.equal(listCall.context.actorId, fixture.ownerSubject);

        const create = await fetch(base, {
            method: "POST",
            headers: authHeaders("owner-token", { "Content-Type": "application/json" }),
            body: JSON.stringify({
                name: "Porsiyon Döner",
                category: "Döner",
                price: 240,
                description: "Pilav ile",
                available: true
            })
        });
        assert.equal(create.status, 201);
        const createCall = fixture.calls.find(([name]) => name === "catalog.create")[1];
        assert.equal(createCall.tenantId, "ela-doner");
        assert.equal(createCall.context.actorId, fixture.ownerSubject);
        assert.equal(typeof createCall.requestId, "string");
    } finally {
        await closeServer(fixture.server);
    }
});

test("owner sipariş listesini görür ve yalnız exact tenant sipariş durumunu servise yollar", async () => {
    const fixture = await startServer();
    const base = `${fixture.baseUrl}/api/tenant/tenants/ela-doner/owner/orders`;
    const orderId = "idem_1111111111111111111111111111111111111111";
    try {
        const list = await fetch(`${base}?limit=20`, { headers: authHeaders("owner-token") });
        assert.equal(list.status, 200);
        const listCall = fixture.calls.find(([name]) => name === "orders.list")[1];
        assert.equal(listCall.context.tenantId, "ela-doner");
        assert.equal(listCall.context.actorId, fixture.ownerSubject);

        const update = await fetch(`${base}/${orderId}/status`, {
            method: "PATCH",
            headers: authHeaders("owner-token", { "Content-Type": "application/json" }),
            body: JSON.stringify({ status: "preparing" })
        });
        const updateBody = await update.json();
        assert.equal(update.status, 200);
        assert.equal(updateBody.order.status, "preparing");
        const statusCall = fixture.calls.find(([name]) => name === "orders.status")[1];
        assert.equal(statusCall.tenantId, "ela-doner");
        assert.equal(statusCall.context.role, "tenant_owner");
        assert.equal(statusCall.context.actorId, fixture.ownerSubject);
        assert.equal(typeof statusCall.requestId, "string");
    } finally {
        await closeServer(fixture.server);
    }
});

test("owner frontend güvenli DOM projection kullanır ve parola/token saklamaz", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/owner/index.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/owner.js"), "utf8");

    assert.match(html, /id="tenant-id"/);
    assert.match(html, /id="product-list"/);
    assert.match(html, /id="order-list"/);
    assert.match(script, /signInWithEmailAndPassword/);
    assert.match(script, /getIdToken\(\)/);
    assert.match(script, /textContent/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.doesNotMatch(script, /localStorage/);
    assert.doesNotMatch(script, /setItem\([^\n]*(password|token)/i);
});
