"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { createAuditEvent } = require("../src/audit/audit-event");
const {
    createFirestoreTenantRegistry
} = require("../src/firestore/firestore-tenant-registry");
const {
    createTenantManagementService
} = require("../src/tenant/tenant-management-service");

function record(overrides = {}) {
    return {
        tenantId: "ela-doner",
        displayName: "ELA DÖNER",
        sector: "restaurant",
        status: "active",
        plan: "starter",
        features: {},
        profile: { brandName: "ELA DÖNER", timezone: "Europe/Istanbul" },
        createdAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        updatedBy: null,
        ...overrides
    };
}

function snapshot(id, value) {
    return {
        id,
        exists: value !== undefined,
        data() {
            return value === undefined ? undefined : structuredClone(value);
        }
    };
}

function transactionalDb(initial, { failAudit = false, beforeRead = null } = {}) {
    let tenant = structuredClone(initial);
    const audits = new Map();
    const calls = [];
    let hookUsed = false;
    const collection = {
        doc(id) {
            return {
                id,
                path: `platformTenants/${id}`,
                async get() {
                    return snapshot(id, tenant);
                },
                async update(value) {
                    tenant = structuredClone(value);
                }
            };
        },
        orderBy() {
            throw new Error("list kullanılmıyor");
        }
    };
    const db = {
        collection(name) {
            assert.equal(name, "platformTenants");
            return collection;
        },
        doc(docPath) {
            return { path: docPath };
        },
        async runTransaction(handler) {
            const staged = [];
            calls.push("begin");
            const tx = {
                async get(ref) {
                    if (!hookUsed && beforeRead) {
                        hookUsed = true;
                        await beforeRead({
                            get tenant() { return tenant; },
                            setTenant(value) { tenant = structuredClone(value); }
                        });
                    }
                    calls.push(`get:${ref.path}`);
                    return snapshot(ref.id, tenant);
                },
                update(ref, value) {
                    calls.push(`update:${ref.path}`);
                    staged.push({ type: "tenant", value: structuredClone(value) });
                },
                create(ref, value) {
                    calls.push(`create:${ref.path}`);
                    if (failAudit) throw new Error("synthetic-private-provider-error");
                    staged.push({
                        type: "audit",
                        path: ref.path,
                        value: structuredClone(value)
                    });
                }
            };
            const result = await handler(tx);
            for (const item of staged) {
                if (item.type === "tenant") tenant = item.value;
                else audits.set(item.path, item.value);
            }
            calls.push("commit");
            return result;
        }
    };
    return {
        db,
        audits,
        calls,
        current() { return structuredClone(tenant); }
    };
}

test("Firestore tenant update ve audit tek transaction outcome olarak commit olur", async () => {
    const state = transactionalDb(record());
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = createTenantManagementService({ tenantRegistry: registry });

    const updated = await service.update({
        tenantId: "ela-doner",
        actorId: "owner-1",
        requestId: "req-atomic",
        now: new Date("2026-09-21T09:00:00.000Z"),
        patch: {
            displayName: "ELA DÖNER MERKEZ",
            profile: { businessHours: "Her gün 09:00–22:00" }
        }
    });

    assert.equal(updated.displayName, "ELA DÖNER MERKEZ");
    assert.equal(state.current().profile.businessHours, "Her gün 09:00–22:00");
    assert.equal(state.audits.size, 1);
    const [audit] = [...state.audits.values()];
    assert.equal(audit.action, "tenant.updated");
    assert.equal(audit.tenantId, "ela-doner");
    assert.equal(audit.requestId, "req-atomic");
    assert.deepEqual(audit.metadata.fields, ["displayName", "profile"]);
    assert.equal(JSON.stringify(audit).includes("09:00–22:00"), false);
    assert.equal(state.calls[0], "begin");
    assert.equal(state.calls.at(-1), "commit");
});

test("audit create başarısızsa tenant update commit edilmez", async () => {
    const original = record();
    const state = transactionalDb(original, { failAudit: true });
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = createTenantManagementService({ tenantRegistry: registry });

    await assert.rejects(
        service.update({
            tenantId: "ela-doner",
            actorId: "owner-1",
            patch: { displayName: "YAZILMAMALI" }
        }),
        error => error?.code === "TENANT_UPDATE_UNAVAILABLE" &&
            !error.message.includes("synthetic-private")
    );

    assert.deepEqual(state.current(), original);
    assert.equal(state.audits.size, 0);
    assert.equal(state.calls.includes("commit"), false);
});

test("eşzamanlı tenant değişikliği stale update ile overwrite edilmez", async () => {
    const state = transactionalDb(record(), {
        beforeRead(context) {
            context.setTenant({
                ...context.tenant,
                plan: "business"
            });
        }
    });
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const service = createTenantManagementService({ tenantRegistry: registry });

    await assert.rejects(
        service.update({
            tenantId: "ela-doner",
            actorId: "owner-1",
            patch: { displayName: "STALE YAZI" }
        }),
        error => error?.code === "TENANT_UPDATE_STATE_CHANGED"
    );

    assert.equal(state.current().plan, "business");
    assert.equal(state.current().displayName, "ELA DÖNER");
    assert.equal(state.audits.size, 0);
    assert.equal(state.calls.includes("commit"), false);
});

test("atomic registry forged cross-tenant update auditini transaction öncesi reddeder", async () => {
    const state = transactionalDb(record());
    const registry = createFirestoreTenantRegistry({ db: state.db });
    const expected = await registry.getById("ela-doner");
    const forged = createAuditEvent({
        tenantId: "other-tenant",
        action: "tenant.updated",
        actorId: "actor-1"
    });

    await assert.rejects(
        registry.commitTenantUpdate({
            tenantId: "ela-doner",
            expectedTenant: expected,
            nextTenant: { ...expected, displayName: "FORGED" },
            auditEvent: forged
        }),
        TypeError
    );

    assert.equal(state.calls.length, 0);
    assert.equal(state.audits.size, 0);
});

test("production smoke periyodik çalışır ve workflow action referansları SHA pinlidir", () => {
    const root = path.join(__dirname, "../..");
    const production = fs.readFileSync(
        path.join(root, ".github/workflows/platform-v2-production-smoke.yml"),
        "utf8"
    );
    const visual = fs.readFileSync(
        path.join(root, ".github/workflows/presentation-visual-smoke.yml"),
        "utf8"
    );

    assert.match(production, /schedule:\s*\n\s*- cron: "17 \* \* \* \*"/);
    for (const source of [production, visual]) {
        assert.doesNotMatch(source, /uses:\s+actions\/(?:checkout|setup-node|upload-artifact)@v\d+/);
    }
    assert.match(
        production,
        /actions\/checkout@11d5960a326750d5838078e36cf38b85af677262/
    );
    assert.match(
        production,
        /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/
    );
    assert.match(
        visual,
        /actions\/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02/
    );
});

test("HTTP sınırları concurrent tenant update'i conflict olarak projekte eder", () => {
    const platform = fs.readFileSync(
        path.join(__dirname, "../src/http/create-platform-app.js"),
        "utf8"
    );
    const ownerSettings = fs.readFileSync(
        path.join(__dirname, "../src/http/attach-owner-settings-endpoints.js"),
        "utf8"
    );
    const channels = fs.readFileSync(
        path.join(__dirname, "../src/http/attach-public-channel-owner-endpoints.js"),
        "utf8"
    );

    assert.match(platform, /TENANT_UPDATE_STATE_CHANGED/);
    assert.match(platform, /TENANT_UPDATE_UNAVAILABLE/);
    assert.match(ownerSettings, /TENANT_UPDATE_STATE_CHANGED/);
    assert.match(ownerSettings, /TENANT_UPDATE_UNAVAILABLE/);
    assert.match(channels, /TENANT_UPDATE_STATE_CHANGED/);
    assert.match(channels, /TENANT_UPDATE_UNAVAILABLE/);
});
