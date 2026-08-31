const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");

const { createPlatformApp } = require("../src/http/create-platform-app");

async function startTestServer({ allowedOrigins = [], webConfig = null } = {}) {
    const tenants = new Map();
    const auditEvents = [];

    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return {
                    uid: "platform-admin-1",
                    platformAdmin: true
                };
            }

            if (token === "tenant-token") {
                return {
                    uid: "tenant-user-1",
                    platformAdmin: false
                };
            }

            throw new Error("invalid token");
        }
    };

    const tenantRegistry = {
        async getById(id) {
            return tenants.get(id) || null;
        },
        async list({ limit }) {
            return [...tenants.values()].slice(0, limit);
        },
        async create(tenant) {
            if (tenants.has(tenant.tenantId)) {
                throw new Error("already exists");
            }
            tenants.set(tenant.tenantId, tenant);
            return tenant;
        },
        async update(id, tenant) {
            if (!tenants.has(id)) {
                const error = new Error("missing");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }
            tenants.set(id, tenant);
            return tenant;
        }
    };

    const auditWriter = {
        async write(event) {
            auditEvents.push(event);
            return event;
        }
    };

    const app = createPlatformApp({
        auth,
        tenantRegistry,
        auditWriter,
        allowedOrigins,
        webConfig
    });

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();

    return {
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        tenants,
        auditEvents
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function adminHeaders(extra = {}) {
    return {
        Authorization: "Bearer platform-token",
        ...extra
    };
}

async function createTenant(fixture, overrides = {}) {
    return fetch(`${fixture.baseUrl}/api/platform/tenants`, {
        method: "POST",
        headers: adminHeaders({
            "Content-Type": "application/json"
        }),
        body: JSON.stringify({
            tenantId: "ece-doner",
            displayName: "Ece Döner",
            sector: "restaurant",
            plan: "starter",
            features: {
                orders: true,
                whatsapp: true
            },
            ...overrides
        })
    });
}

test("health endpoint public ve güvenlik headerları aktif", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(`${fixture.baseUrl}/health`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.service, "platform-v2-admin-api");
        assert.ok(response.headers.get("x-request-id"));
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    } finally {
        await closeServer(fixture.server);
    }
});

test("merkezi admin paneli ve Firebase bootstrap config aynı V2 serverdan sunulur", async () => {
    const fixture = await startTestServer({
        webConfig: {
            apiKey: "web-api-key",
            authDomain: "platform.example.firebaseapp.com",
            projectId: "platform-example",
            appId: "1:123:web:abc"
        }
    });

    try {
        const panelResponse = await fetch(`${fixture.baseUrl}/admin/`);
        const panel = await panelResponse.text();
        assert.equal(panelResponse.status, 200);
        assert.match(panel, /Merkezi Yönetim/);
        assert.match(panelResponse.headers.get("content-security-policy"), /www\.gstatic\.com/);

        const configResponse = await fetch(`${fixture.baseUrl}/admin/config.js`);
        const config = await configResponse.text();
        assert.equal(configResponse.status, 200);
        assert.match(config, /platform-example/);
        assert.match(configResponse.headers.get("content-type"), /javascript/);
    } finally {
        await closeServer(fixture.server);
    }
});

test("platform endpoint token olmadan 401 döner", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(`${fixture.baseUrl}/api/platform/tenants`);
        assert.equal(response.status, 401);
    } finally {
        await closeServer(fixture.server);
    }
});

test("normal tenant kullanıcısı platform admin endpointine giremez", async () => {
    const fixture = await startTestServer();

    try {
        const response = await fetch(`${fixture.baseUrl}/api/platform/tenants`, {
            headers: {
                Authorization: "Bearer tenant-token"
            }
        });
        assert.equal(response.status, 403);
    } finally {
        await closeServer(fixture.server);
    }
});

test("platform admin tenant oluşturur, listeler ve audit üretir", async () => {
    const fixture = await startTestServer();

    try {
        const createResponse = await createTenant(fixture, {
            createdBy: "body-degeri-kullanilmamali"
        });
        const created = await createResponse.json();

        assert.equal(createResponse.status, 201);
        assert.equal(created.tenant.tenantId, "ece-doner");
        assert.equal(created.tenant.createdBy, "platform-admin-1");
        assert.equal(fixture.auditEvents.length, 1);
        assert.equal(fixture.auditEvents[0].action, "tenant.created");

        const listResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants?limit=50`, {
            headers: adminHeaders()
        });
        const listed = await listResponse.json();

        assert.equal(listResponse.status, 200);
        assert.equal(listed.tenants.length, 1);
        assert.equal(listed.tenants[0].tenantId, "ece-doner");

        const getResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants/ece-doner`, {
            headers: adminHeaders()
        });
        const fetched = await getResponse.json();

        assert.equal(getResponse.status, 200);
        assert.equal(fetched.tenant.displayName, "Ece Döner");
    } finally {
        await closeServer(fixture.server);
    }
});

test("platform admin tenant durum, paket, feature ve marka ayarlarını merkezi günceller", async () => {
    const fixture = await startTestServer();

    try {
        assert.equal((await createTenant(fixture)).status, 201);

        const updateResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants/ece-doner`, {
            method: "PATCH",
            headers: adminHeaders({
                "Content-Type": "application/json"
            }),
            body: JSON.stringify({
                status: "active",
                plan: "business",
                features: {
                    reservations: true
                },
                profile: {
                    brandName: "Ece Döner",
                    customDomain: "menu.ece-doner.example.com",
                    primaryColor: "#112233"
                }
            })
        });
        const updated = await updateResponse.json();

        assert.equal(updateResponse.status, 200);
        assert.equal(updated.tenant.status, "active");
        assert.equal(updated.tenant.plan, "business");
        assert.equal(updated.tenant.features.orders, true);
        assert.equal(updated.tenant.features.reservations, true);
        assert.equal(updated.tenant.profile.customDomain, "menu.ece-doner.example.com");
        assert.equal(updated.tenant.profile.primaryColor, "#112233");
        assert.equal(updated.tenant.updatedBy, "platform-admin-1");
        assert.equal(fixture.auditEvents.length, 2);
        assert.equal(fixture.auditEvents[1].action, "tenant.updated");
    } finally {
        await closeServer(fixture.server);
    }
});

test("duplicate onboarding 409 döner", async () => {
    const fixture = await startTestServer();

    try {
        assert.equal((await createTenant(fixture)).status, 201);
        assert.equal((await createTenant(fixture)).status, 409);
    } finally {
        await closeServer(fixture.server);
    }
});

test("geçersiz limit, tenantId ve update alanı 400 döner", async () => {
    const fixture = await startTestServer();

    try {
        const limitResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants?limit=999`, {
            headers: adminHeaders()
        });
        assert.equal(limitResponse.status, 400);

        const tenantResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants/a%2Fb`, {
            headers: adminHeaders()
        });
        assert.equal(tenantResponse.status, 400);

        assert.equal((await createTenant(fixture)).status, 201);
        const updateResponse = await fetch(`${fixture.baseUrl}/api/platform/tenants/ece-doner`, {
            method: "PATCH",
            headers: adminHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ sector: "barber" })
        });
        assert.equal(updateResponse.status, 400);
    } finally {
        await closeServer(fixture.server);
    }
});

test("CORS allowlist dışı browser origin fail-closed reddedilir", async () => {
    const fixture = await startTestServer({
        allowedOrigins: ["https://admin.example.com"]
    });

    try {
        const blocked = await fetch(`${fixture.baseUrl}/api/platform/tenants`, {
            headers: {
                ...adminHeaders(),
                Origin: "https://evil.example.com"
            }
        });
        assert.equal(blocked.status, 403);

        const allowed = await fetch(`${fixture.baseUrl}/api/platform/tenants`, {
            headers: {
                ...adminHeaders(),
                Origin: "https://admin.example.com"
            }
        });
        assert.equal(allowed.status, 200);
        assert.equal(allowed.headers.get("access-control-allow-origin"), "https://admin.example.com");
    } finally {
        await closeServer(fixture.server);
    }
});
