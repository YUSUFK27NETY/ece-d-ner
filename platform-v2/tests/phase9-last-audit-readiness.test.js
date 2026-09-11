const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
    createLastAuditReadModel
} = require("../src/audit/last-audit-read-model");
const {
    createFirestoreAuditReader
} = require("../src/firestore/firestore-audit-reader");
const {
    attachLastAuditEndpoint
} = require("../src/http/attach-last-audit-endpoint");
const { createPlatformApp } = require("../src/http/create-platform-app");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const TENANT_ID = "second-tenant";
const CREATED_AT = "2026-09-09T16:00:00.000Z";

function tenantFixture(tenantId = TENANT_ID) {
    return createTenantRecord({
        tenantId,
        displayName: "Second Tenant",
        sector: "restaurant",
        now: new Date("2026-09-09T15:00:00.000Z")
    });
}

function registryFixture() {
    const tenants = new Map([[TENANT_ID, tenantFixture()]]);
    return {
        async getById(tenantId) { return tenants.get(tenantId) || null; },
        async list() { return [...tenants.values()]; },
        async create(tenant) { tenants.set(tenant.tenantId, tenant); return tenant; },
        async update(tenantId, tenant) { tenants.set(tenantId, tenant); return tenant; }
    };
}

function eventFixture(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        action: "tenant.updated",
        createdAt: CREATED_AT,
        ...overrides
    };
}

test("last audit model fixed projection kullanır ve hostile metadata getter okumaz", async () => {
    let getterCalls = 0;
    const event = eventFixture();
    Object.defineProperty(event, "metadata", {
        enumerable: true,
        get() {
            getterCalls += 1;
            throw new Error("secret-metadata-marker");
        }
    });
    const model = createLastAuditReadModel({
        auditReader: {
            async getLatest(input) {
                assert.deepEqual(input, { tenantId: TENANT_ID });
                return event;
            }
        }
    });

    const result = await model.get({ tenantId: TENANT_ID });
    assert.deepEqual(result, {
        tenantId: TENANT_ID,
        status: "available",
        action: "tenant.updated",
        createdAt: CREATED_AT
    });
    assert.equal(getterCalls, 0);
    assert.deepEqual(Object.keys(result), [
        "tenantId", "status", "action", "createdAt"
    ]);
    assert.equal(JSON.stringify(result).includes("secret-metadata-marker"), false);
});

test("audit kaydı yoksa none, reader arızasında unavailable olur", async () => {
    const noneModel = createLastAuditReadModel({
        auditReader: { async getLatest() { return null; } }
    });
    assert.deepEqual(await noneModel.get({ tenantId: TENANT_ID }), {
        tenantId: TENANT_ID,
        status: "none",
        action: null,
        createdAt: null
    });

    const unavailableModel = createLastAuditReadModel({
        auditReader: {
            async getLatest() {
                const error = new Error("raw-audit-provider-marker");
                error.token = "raw-token-marker";
                throw error;
            }
        }
    });
    const unavailable = await unavailableModel.get({ tenantId: TENANT_ID });
    assert.deepEqual(unavailable, {
        tenantId: TENANT_ID,
        status: "unavailable",
        action: null,
        createdAt: null
    });
    assert.equal(JSON.stringify(unavailable).includes("raw-audit-provider-marker"), false);
    assert.equal(JSON.stringify(unavailable).includes("raw-token-marker"), false);
});

test("cross-tenant veya malformed audit evidence fail closed unavailable olur", async () => {
    for (const event of [
        eventFixture({ tenantId: "other-tenant" }),
        eventFixture({ action: "bad action" }),
        eventFixture({ createdAt: "not-a-time" })
    ]) {
        const model = createLastAuditReadModel({
            auditReader: { async getLatest() { return event; } }
        });
        const result = await model.get({ tenantId: TENANT_ID });
        assert.equal(result.status, "unavailable");
        assert.equal(result.action, null);
        assert.equal(result.createdAt, null);
    }
});

test("Firestore reader exact tenant audit path, createdAt desc ve limit 1 kullanır", async () => {
    const calls = [];
    let metadataGetterCalls = 0;
    const record = eventFixture();
    Object.defineProperty(record, "metadata", {
        enumerable: true,
        get() {
            metadataGetterCalls += 1;
            throw new Error("metadata getter must not run");
        }
    });
    const db = {
        collection(collectionPath) {
            calls.push(["collection", collectionPath]);
            return {
                orderBy(field, direction) {
                    calls.push(["orderBy", field, direction]);
                    return {
                        limit(value) {
                            calls.push(["limit", value]);
                            return {
                                async get() {
                                    calls.push(["get"]);
                                    return {
                                        docs: [{ data() { return record; } }]
                                    };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
    const reader = createFirestoreAuditReader({ db });
    const result = await reader.getLatest({ tenantId: TENANT_ID });

    assert.deepEqual(calls, [
        ["collection", `tenants/${TENANT_ID}/audit`],
        ["orderBy", "createdAt", "desc"],
        ["limit", 1],
        ["get"]
    ]);
    assert.deepEqual(result, eventFixture());
    assert.equal(metadataGetterCalls, 0);
});

async function startServer({ auditReader, tenantRegistry = registryFixture() }) {
    const auth = {
        async verifyIdToken(token) {
            if (token === "platform-token") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (token === "tenant-token") {
                return { uid: "tenant-user-1", platformAdmin: false };
            }
            throw new Error("invalid token");
        }
    };
    const app = createPlatformApp({ auth, tenantRegistry });
    attachLastAuditEndpoint({
        app,
        tenantRegistry,
        lastAuditReadModel: createLastAuditReadModel({ auditReader })
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
        server,
        baseUrl: `http://127.0.0.1:${server.address().port}`
    };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

function headers(token = "platform-token") {
    return { Authorization: `Bearer ${token}` };
}

test("last-audit GET mevcut Platform Admin middleware arkasında exact tenant bound kalır", async () => {
    const fixture = await startServer({
        auditReader: { async getLatest() { return eventFixture(); } }
    });
    try {
        const url = `${fixture.baseUrl}/api/platform/tenants/${TENANT_ID}/last-audit`;
        assert.equal((await fetch(url)).status, 401);
        assert.equal((await fetch(url, { headers: headers("tenant-token") })).status, 403);

        const response = await fetch(url, { headers: headers() });
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.deepEqual(body, {
            success: true,
            lastAudit: {
                tenantId: TENANT_ID,
                status: "available",
                action: "tenant.updated",
                createdAt: CREATED_AT
            }
        });

        assert.equal((await fetch(
            `${fixture.baseUrl}/api/platform/tenants/SECOND-TENANT/last-audit`,
            { headers: headers() }
        )).status, 400);
        assert.equal((await fetch(
            `${fixture.baseUrl}/api/platform/tenants/missing-tenant/last-audit`,
            { headers: headers() }
        )).status, 404);
    } finally {
        await closeServer(fixture.server);
    }
});

test("last-audit görünürlüğünde mutation methodları yoktur", async () => {
    const fixture = await startServer({
        auditReader: { async getLatest() { return null; } }
    });
    const url = `${fixture.baseUrl}/api/platform/tenants/${TENANT_ID}/last-audit`;
    try {
        for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
            const response = await fetch(url, {
                method,
                headers: headers()
            });
            assert.equal(response.status, 404, method);
        }
    } finally {
        await closeServer(fixture.server);
    }
});

test("P9-7E existing readiness response contractını değiştirmez ve UI salt okunur bağlanır", () => {
    const root = path.resolve(__dirname, "..");
    const appSource = fs.readFileSync(
        path.join(root, "src/http/create-platform-app.js"),
        "utf8"
    );
    const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
    const indexSource = fs.readFileSync(
        path.join(root, "public/admin/index.html"),
        "utf8"
    );
    const uiSource = fs.readFileSync(
        path.join(root, "public/admin/customer-readiness-audit.js"),
        "utf8"
    );

    assert.match(appSource, /return res\.json\(\{ success: true, readiness \}\);/);
    assert.match(serverSource, /attachLastAuditEndpoint\(\{[\s\S]*tenantRegistry,[\s\S]*lastAuditReadModel/);
    assert.match(indexSource, /customer-readiness-audit\.js/);
    assert.match(uiSource, /\/api\/platform\/tenants\/\$\{encodeURIComponent\(tenantId\)\}\/last-audit/);
    assert.doesNotMatch(uiSource, /method:\s*["'](?:POST|PATCH|PUT|DELETE)["']/);
    assert.doesNotMatch(uiSource, /metadata|actorId|requestId|subjectRef|password|credential|providerBody/);
});
