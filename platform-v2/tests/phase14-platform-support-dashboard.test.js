"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
    createPlatformSupportOverviewService
} = require("../src/operations/platform-support-overview-service");
const { createPlatformApp } = require("../src/http/create-platform-app");

function tenant(tenantId, displayName, status = "active") {
    return {
        tenantId,
        displayName,
        sector: "restaurant",
        plan: "starter",
        status,
        features: {},
        profile: {}
    };
}

function createFixture() {
    const tenants = [
        tenant("tenant-healthy", "Healthy Tenant"),
        tenant("tenant-attention", "Attention Tenant"),
        tenant("tenant-critical", "Critical Tenant"),
        tenant("tenant-unknown", "Unknown Tenant")
    ];
    const tenantRegistry = {
        async getById(id) {
            return tenants.find(item => item.tenantId === id) || null;
        },
        async list({ limit }) {
            return tenants.slice(0, limit);
        },
        async create(value) { return value; },
        async update(_id, value) { return value; }
    };
    const usageTelemetry = {
        async getAggregate({ tenantId }) {
            if (tenantId === "tenant-unknown") {
                throw new Error("telemetry unavailable");
            }
            if (tenantId === "tenant-attention") {
                return {
                    requestCount: 12,
                    errorCount: 1,
                    updatedAt: "2026-09-19T10:00:00.000Z",
                    lastError: {
                        occurredAt: "2026-09-19T09:59:00.000Z",
                        operation: "orders.list",
                        statusCode: 500
                    }
                };
            }
            return {
                requestCount: 8,
                errorCount: 0,
                updatedAt: "2026-09-19T10:00:00.000Z",
                lastError: null
            };
        }
    };
    const securitySignals = {
        async listTenant({ tenantId }) {
            if (tenantId === "tenant-attention") {
                return [{
                    severity: "warning",
                    count: 2,
                    createdAt: "2026-09-19T09:58:00.000Z"
                }];
            }
            if (tenantId === "tenant-critical") {
                return [{
                    severity: "critical",
                    count: 1,
                    createdAt: "2026-09-19T09:57:00.000Z"
                }];
            }
            return [];
        }
    };
    const supportOverview = createPlatformSupportOverviewService({
        tenantRegistry,
        usageTelemetry,
        securitySignals,
        concurrency: 2
    });
    return { tenantRegistry, supportOverview };
}

test("support overview tenantları merkezi destek durumuna göre özetler", async () => {
    const fixture = createFixture();
    const support = await fixture.supportOverview.getOverview({
        context: { role: "platform_admin", actorId: "admin-1" },
        at: new Date("2026-09-19T10:00:00.000Z")
    });

    assert.equal(support.schemaVersion, 1);
    assert.deepEqual(support.totals, {
        total: 4,
        healthy: 1,
        attention: 1,
        critical: 1,
        unknown: 1
    });
    assert.deepEqual(
        support.tenants.map(item => [item.tenantId, item.health]),
        [
            ["tenant-critical", "critical"],
            ["tenant-attention", "attention"],
            ["tenant-unknown", "unknown"],
            ["tenant-healthy", "healthy"]
        ]
    );

    const attention = support.tenants.find(item => item.tenantId === "tenant-attention");
    assert.equal(attention.errorsToday, 1);
    assert.equal(attention.security.total, 2);
    assert.equal(attention.security.highestSeverity, "warning");
    assert.deepEqual(attention.lastError, {
        occurredAt: "2026-09-19T09:59:00.000Z",
        operation: "orders.list",
        statusCode: 500
    });

    const unknown = support.tenants.find(item => item.tenantId === "tenant-unknown");
    assert.equal(unknown.health, "unknown");
    assert.equal(unknown.sources.usage, false);
    assert.equal(unknown.sources.security, true);
});

test("support overview yalnız platform admin context kabul eder", async () => {
    const fixture = createFixture();
    await assert.rejects(
        fixture.supportOverview.getOverview({
            context: { role: "tenant_owner", actorId: "owner-1" }
        }),
        error => error.code === "PERMISSION_DENIED"
    );
});

test("support overview API platform admin için tek merkezi response döndürür", async () => {
    const fixture = createFixture();
    const app = createPlatformApp({
        auth: {
            async verifyIdToken(token) {
                if (token === "admin-token") {
                    return { uid: "admin-1", platformAdmin: true };
                }
                if (token === "owner-token") {
                    return { uid: "owner-1", platformAdmin: false };
                }
                throw new Error("invalid");
            }
        },
        tenantRegistry: fixture.tenantRegistry,
        supportOverview: fixture.supportOverview
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    try {
        const denied = await fetch(`${baseUrl}/api/platform/support-overview?limit=200`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(denied.status, 403);
        assert.equal("support" in await denied.json(), false);

        const response = await fetch(`${baseUrl}/api/platform/support-overview?limit=200`, {
            headers: { Authorization: "Bearer admin-token" }
        });
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.support.totals.total, 4);
        assert.equal(body.support.tenants[0].tenantId, "tenant-critical");
        assert.doesNotMatch(JSON.stringify(body), /profile|phone|email|admin-token|owner-token/i);
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("support dashboard admin auth izolasyonu ve güvenli DOM render kullanır", () => {
    const root = path.join(__dirname, "../public/admin");
    const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const html = fs.readFileSync(path.join(root, "support-dashboard.html"), "utf8");
    const js = fs.readFileSync(path.join(root, "support-dashboard.js"), "utf8");

    assert.match(index, /\/admin\/support-dashboard\.html/);
    assert.match(html, /Destek Merkezi/);
    assert.match(html, /support-dashboard\.css/);
    assert.match(html, /auth-isolation\.js/);
    assert.match(js, /PLATFORM_ADMIN_AUTH/);
    assert.match(js, /\/api\/platform\/support-overview\?limit=200/);
    assert.match(js, /requestVersion/);
    assert.match(js, /replaceChildren\(\)/);
    assert.doesNotMatch(js, /innerHTML\s*=/);
});
