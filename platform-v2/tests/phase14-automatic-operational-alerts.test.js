"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");

const {
    createOperationalAlertService
} = require("../src/operations/operational-alert-service");
const {
    createFirestoreOperationalAlertStore
} = require("../src/firestore/firestore-operational-alert-store");
const {
    createOperationalAlertMiddleware,
    resolveOperationalAlertScope
} = require("../src/http/operational-alert-middleware");
const {
    createPlatformSupportOverviewService
} = require("../src/operations/platform-support-overview-service");

function createMemoryAlertStore() {
    const records = new Map();
    return {
        records,
        async record(input) {
            const current = records.get(input.alertId);
            const eventCount = current ? current.eventCount + 1 : 1;
            const next = Object.freeze({
                schemaVersion: 1,
                alertId: input.alertId,
                tenantId: input.tenantId,
                type: "server_error",
                severity: eventCount >= input.criticalThreshold ? "critical" : "high",
                operation: input.operation,
                statusCode: input.statusCode,
                eventCount,
                firstSeenAt: current?.firstSeenAt || input.occurredAt,
                lastSeenAt: input.occurredAt,
                windowStartedAt: input.windowStartedAt
            });
            records.set(input.alertId, next);
            return next;
        },
        async listTenant({ context, tenantId, limit }) {
            if (context?.role !== "platform_admin") {
                const error = new Error("denied");
                error.code = "PERMISSION_DENIED";
                throw error;
            }
            return [...records.values()]
                .filter(item => item.tenantId === tenantId)
                .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
                .slice(0, limit);
        }
    };
}

test("Firestore operational alert store aynı alarmı atomik toplar ve yalnız platform admin okur", async () => {
    const docs = new Map();
    const db = {
        doc(pathname) {
            return { path: pathname };
        },
        async runTransaction(work) {
            const transaction = {
                async get(ref) {
                    return {
                        exists: docs.has(ref.path),
                        data() { return docs.get(ref.path); }
                    };
                },
                set(ref, value) {
                    docs.set(ref.path, JSON.parse(JSON.stringify(value)));
                }
            };
            return work(transaction);
        },
        collection(pathname) {
            return {
                orderBy(field, direction) {
                    assert.equal(field, "lastSeenAt");
                    assert.equal(direction, "desc");
                    return {
                        limit(limit) {
                            return {
                                async get() {
                                    const rows = [...docs.entries()]
                                        .filter(([key]) => key.startsWith(`${pathname}/`))
                                        .map(([key, value]) => ({
                                            id: key.slice(pathname.length + 1),
                                            data() { return JSON.parse(JSON.stringify(value)); }
                                        }))
                                        .sort((a, b) =>
                                            b.data().lastSeenAt.localeCompare(a.data().lastSeenAt)
                                        )
                                        .slice(0, limit);
                                    return { docs: rows };
                                }
                            };
                        }
                    };
                }
            };
        }
    };
    const store = createFirestoreOperationalAlertStore({ db });
    const service = createOperationalAlertService({
        store,
        dedupeWindowMs: 10 * 60 * 1000,
        criticalThreshold: 3
    });

    for (const occurredAt of [
        "2026-09-19T16:00:01.000Z",
        "2026-09-19T16:01:01.000Z",
        "2026-09-19T16:02:01.000Z"
    ]) {
        await service.record({
            tenantId: "ela-doner",
            operation: "http.owner.tenant",
            statusCode: 503,
            occurredAt
        });
    }

    const listed = await service.listTenant({
        context: { role: "platform_admin", actorId: "admin-1" },
        tenantId: "ela-doner",
        limit: 20
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0].eventCount, 3);
    assert.equal(listed[0].severity, "critical");
    assert.equal(listed[0].statusCode, 503);

    await assert.rejects(
        service.listTenant({
            context: { role: "tenant_owner", actorId: "owner-1", tenantId: "ela-doner" },
            tenantId: "ela-doner",
            limit: 20
        }),
        error => error.code === "PERMISSION_DENIED"
    );
});

test("operational alert service aynı 10 dakikalık 5xx grubunu toplar ve üçüncü olayda critical yapar", async () => {
    const store = createMemoryAlertStore();
    const service = createOperationalAlertService({
        store,
        dedupeWindowMs: 10 * 60 * 1000,
        criticalThreshold: 3
    });

    const times = [
        "2026-09-19T16:00:01.000Z",
        "2026-09-19T16:02:00.000Z",
        "2026-09-19T16:09:59.000Z"
    ];
    let alert;
    for (const occurredAt of times) {
        alert = await service.record({
            tenantId: "ela-doner",
            operation: "http.public.storefront",
            statusCode: 500,
            occurredAt
        });
    }

    assert.equal(store.records.size, 1);
    assert.equal(alert.eventCount, 3);
    assert.equal(alert.severity, "critical");
    assert.equal(alert.firstSeenAt, times[0]);
    assert.equal(alert.lastSeenAt, times[2]);

    const nextWindow = await service.record({
        tenantId: "ela-doner",
        operation: "http.public.storefront",
        statusCode: 500,
        occurredAt: "2026-09-19T16:10:00.000Z"
    });
    assert.equal(store.records.size, 1);
    assert.equal(nextWindow.eventCount, 1);
    assert.equal(nextWindow.severity, "high");
});

test("operational alert middleware yalnız canonical tenant-scoped route ve 5xx response izler", async () => {
    const observed = [];
    const alerts = {
        async record(value) {
            observed.push(value);
            return value;
        }
    };
    const middleware = createOperationalAlertMiddleware({
        alerts,
        clock: () => Date.parse("2026-09-19T16:30:00.000Z")
    });

    async function finish(pathname, statusCode, trustedScope = null) {
        const listeners = new Map();
        const req = { path: pathname };
        const res = {
            statusCode,
            locals: {},
            once(event, handler) {
                listeners.set(event, handler);
            }
        };
        middleware(req, res, () => {});
        if (trustedScope) {
            res.locals.platformOperationalAlertScope = trustedScope;
        }
        const handler = listeners.get("finish");
        if (handler) handler();
        await new Promise(resolve => setImmediate(resolve));
    }

    await finish("/api/public/storefront/ela-doner", 500);
    await finish("/api/tenant/tenants/ela-doner/owner/orders", 503);
    await finish("/api/public/orders", 502, {
        tenantId: "ela-doner",
        operation: "http.public.orders"
    });
    await finish("/api/public/storefront/ela-doner", 404);
    await finish("/api/public/storefront/ELA-DONER", 500);
    await finish("/api/public/deployment", 500);

    assert.deepEqual(observed, [
        {
            tenantId: "ela-doner",
            operation: "http.public.storefront",
            statusCode: 500,
            occurredAt: "2026-09-19T16:30:00.000Z"
        },
        {
            tenantId: "ela-doner",
            operation: "http.owner.tenant",
            statusCode: 503,
            occurredAt: "2026-09-19T16:30:00.000Z"
        },
        {
            tenantId: "ela-doner",
            operation: "http.public.orders",
            statusCode: 502,
            occurredAt: "2026-09-19T16:30:00.000Z"
        }
    ]);

    assert.deepEqual(resolveOperationalAlertScope("/m/ela-doner"), {
        tenantId: "ela-doner",
        operation: "http.public.storefront_page"
    });
    assert.equal(resolveOperationalAlertScope("/m/storefront.css"), null);
});

test("support overview operational high alarmı attention, critical alarmı critical yapar ve eski günü taşımaz", async () => {
    const tenants = [{
        tenantId: "ela-doner",
        displayName: "ELA DÖNER",
        sector: "restaurant",
        plan: "starter",
        status: "active"
    }];
    const base = {
        tenantRegistry: {
            async list() { return tenants; }
        },
        usageTelemetry: {
            async getAggregate() {
                return {
                    requestCount: 10,
                    errorCount: 0,
                    lastError: null,
                    updatedAt: "2026-09-19T16:00:00.000Z"
                };
            }
        },
        securitySignals: {
            async listTenant() { return []; }
        }
    };
    const context = { role: "platform_admin", actorId: "admin-1" };
    const at = new Date("2026-09-19T16:40:00.000Z");

    const attention = createPlatformSupportOverviewService({
        ...base,
        operationalAlerts: {
            async listTenant() {
                return [{
                    severity: "high",
                    eventCount: 1,
                    operation: "http.public.storefront",
                    statusCode: 500,
                    lastSeenAt: "2026-09-19T16:30:00.000Z"
                }];
            }
        }
    });
    assert.equal((await attention.getOverview({ context, at })).tenants[0].health, "attention");

    const critical = createPlatformSupportOverviewService({
        ...base,
        operationalAlerts: {
            async listTenant() {
                return [{
                    severity: "critical",
                    eventCount: 3,
                    operation: "http.public.storefront",
                    statusCode: 500,
                    lastSeenAt: "2026-09-19T16:35:00.000Z"
                }];
            }
        }
    });
    const criticalRow = (await critical.getOverview({ context, at })).tenants[0];
    assert.equal(criticalRow.health, "critical");
    assert.equal(criticalRow.operational.total, 3);
    assert.deepEqual(criticalRow.operational.latest, {
        operation: "http.public.storefront",
        statusCode: 500,
        eventCount: 3
    });

    const old = createPlatformSupportOverviewService({
        ...base,
        operationalAlerts: {
            async listTenant() {
                return [{
                    severity: "critical",
                    eventCount: 9,
                    operation: "http.public.storefront",
                    statusCode: 500,
                    lastSeenAt: "2026-09-18T23:59:59.000Z"
                }];
            }
        }
    });
    assert.equal((await old.getOverview({ context, at })).tenants[0].health, "healthy");
});

test("support dashboard operational alarm sütununu güvenli DOM ile render eder", () => {
    const root = path.join(__dirname, "../public/admin");
    const html = fs.readFileSync(path.join(root, "support-dashboard.html"), "utf8");
    const js = fs.readFileSync(path.join(root, "support-dashboard.js"), "utf8");

    assert.match(html, /Otomatik alarm/);
    assert.match(js, /operationalAlertText/);
    assert.match(js, /item\.operational/);
    assert.doesNotMatch(js, /innerHTML\s*=/);
});
