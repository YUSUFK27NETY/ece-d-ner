const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const { FEATURE_CATALOG } = require("../src/tenant/feature-catalog");
const {
    SECTOR_TEMPLATE_CATALOG,
    createSectorTemplate,
    getSectorTemplateCatalog
} = require("../src/tenant/sector-template-catalog");
const { createPlatformApp } = require("../src/http/create-platform-app");
const {
    attachSectorTemplateEndpoints
} = require("../src/http/attach-sector-template-endpoints");

function createRegistry() {
    return {
        async getById() {
            return null;
        },
        async list() {
            return [];
        },
        async create(tenant) {
            return tenant;
        },
        async update(id, tenant) {
            return tenant;
        }
    };
}

function createAuth() {
    return {
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
}

async function startServer() {
    const app = createPlatformApp({
        auth: createAuth(),
        tenantRegistry: createRegistry()
    });
    attachSectorTemplateEndpoints({ app });
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

test("sektör şablon kataloğu mevcut feature kataloğuna tam ve immutable bağlanır", () => {
    const catalog = getSectorTemplateCatalog();
    const featureKeys = Object.keys(FEATURE_CATALOG).sort();

    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.templates, SECTOR_TEMPLATE_CATALOG);
    assert.equal(Object.isFrozen(catalog), true);
    assert.equal(Object.isFrozen(SECTOR_TEMPLATE_CATALOG), true);
    assert.ok(SECTOR_TEMPLATE_CATALOG.length >= 10);

    const ids = new Set();
    for (const template of SECTOR_TEMPLATE_CATALOG) {
        assert.equal(Object.isFrozen(template), true);
        assert.equal(Object.isFrozen(template.features), true);
        assert.deepEqual(Object.keys(template.features).sort(), featureKeys);
        assert.match(template.id, /^[a-z0-9][a-z0-9_-]{1,63}$/);
        assert.match(template.sector, /^[a-z0-9][a-z0-9_-]{1,63}$/);
        assert.equal(ids.has(template.id), false);
        ids.add(template.id);
        for (const value of Object.values(template.features)) {
            assert.equal(typeof value, "boolean");
        }
    }

    assert.equal(ids.has("restaurant"), true);
    assert.equal(ids.has("market"), true);
    assert.equal(ids.has("barber"), true);
    assert.equal(ids.has("manufacturing-b2b"), true);
});

test("şablon bilinmeyen feature kabul etmez", () => {
    assert.throws(
        () => createSectorTemplate({
            id: "invalid-template",
            label: "Invalid Template",
            sector: "general",
            description: "Geçersiz feature testi.",
            enabledFeatures: ["catalog", "not-a-feature"]
        }),
        /Bilinmeyen sektör şablonu feature'ı/
    );
});

test("sektör şablon endpointi yalnız Platform Admin oturumundan okunur", async () => {
    const fixture = await startServer();

    try {
        const anonymous = await fetch(`${fixture.baseUrl}/api/platform/sector-templates`);
        assert.equal(anonymous.status, 401);

        const tenantUser = await fetch(`${fixture.baseUrl}/api/platform/sector-templates`, {
            headers: { Authorization: "Bearer tenant-token" }
        });
        assert.equal(tenantUser.status, 403);

        const response = await fetch(`${fixture.baseUrl}/api/platform/sector-templates`, {
            headers: { Authorization: "Bearer platform-token" }
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.catalog.schemaVersion, 1);
        assert.equal(Array.isArray(body.catalog.templates), true);
        assert.ok(body.catalog.templates.some(item => item.id === "restaurant"));
        assert.ok(body.catalog.templates.some(item => item.id === "professional-services"));
    } finally {
        await closeServer(fixture.server);
    }
});

test("Platform Admin sektör şablonunu creation-only yardımcı olarak sunar", () => {
    const html = fs.readFileSync(
        path.join(__dirname, "../public/admin/index.html"),
        "utf8"
    );
    const script = fs.readFileSync(
        path.join(__dirname, "../public/admin/sector-templates.js"),
        "utf8"
    );

    assert.match(html, /id="sector-template"/);
    assert.match(html, /\/admin\/sector-templates\.js/);
    assert.match(script, /\/api\/platform\/sector-templates/);
    assert.match(script, /sectorInput\.disabled/);
    assert.match(script, /input\[data-feature\]/);
    assert.match(script, /getIdToken\(\)/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
});
