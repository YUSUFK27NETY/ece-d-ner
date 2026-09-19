"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createFirestoreSupportTicketRepository
} = require("../src/firestore/firestore-support-ticket-repository");
const {
    createSupportTicketService
} = require("../src/support/support-ticket-service");
const {
    SUPPORT_TICKET_TRANSITIONS,
    normalizeCreateInput,
    normalizeStatusUpdateInput
} = require("../src/support/support-ticket-model");
const {
    ROLE_PERMISSIONS
} = require("../src/auth/authorize-tenant-action");
const {
    resolveOperationalAlertScope
} = require("../src/http/operational-alert-middleware");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFakeDb() {
    const docs = new Map();

    function snapshotFor(ref) {
        const value = docs.get(ref.path);
        return {
            exists: value !== undefined,
            id: ref.path.split("/").at(-1),
            data() {
                return clone(value);
            }
        };
    }

    function collectionQuery(collectionPath, state = {}) {
        return {
            where(field, operator, value) {
                assert.equal(operator, "==");
                return collectionQuery(collectionPath, {
                    ...state,
                    where: { field, value }
                });
            },
            orderBy(field, direction) {
                assert.equal(direction, "desc");
                return collectionQuery(collectionPath, {
                    ...state,
                    orderBy: field
                });
            },
            limit(limit) {
                return collectionQuery(collectionPath, {
                    ...state,
                    limit
                });
            },
            async get() {
                const prefix = collectionPath + "/";
                let rows = [...docs.entries()]
                    .filter(([key]) => {
                        if (!key.startsWith(prefix)) return false;
                        return !key.slice(prefix.length).includes("/");
                    })
                    .map(([key, value]) => ({
                        id: key.slice(prefix.length),
                        value: clone(value)
                    }));
                if (state.where) {
                    rows = rows.filter(row =>
                        row.value?.[state.where.field] === state.where.value
                    );
                }
                if (state.orderBy) {
                    rows.sort((left, right) =>
                        String(right.value?.[state.orderBy] || "")
                            .localeCompare(String(left.value?.[state.orderBy] || ""))
                    );
                }
                if (Number.isInteger(state.limit)) rows = rows.slice(0, state.limit);
                return {
                    docs: rows.map(row => ({
                        id: row.id,
                        data() { return clone(row.value); }
                    }))
                };
            }
        };
    }

    return {
        docs,
        doc(pathname) {
            return {
                path: pathname,
                async get() {
                    return snapshotFor(this);
                }
            };
        },
        collection(pathname) {
            return collectionQuery(pathname);
        },
        async runTransaction(work) {
            const writes = [];
            const transaction = {
                async get(ref) {
                    return snapshotFor(ref);
                },
                create(ref, value) {
                    if (docs.has(ref.path)) throw new Error("already exists");
                    writes.push({ type: "create", ref, value: clone(value) });
                },
                update(ref, value) {
                    if (!docs.has(ref.path)) throw new Error("missing");
                    writes.push({ type: "update", ref, value: clone(value) });
                }
            };
            const result = await work(transaction);
            for (const write of writes) {
                docs.set(write.ref.path, write.value);
            }
            return result;
        }
    };
}

function ownerContext(tenantId = "ela-doner", role = "tenant_owner") {
    return Object.freeze({
        role,
        actorId: `firebase:${role}-1`,
        tenantId
    });
}

function platformContext() {
    return Object.freeze({
        role: "platform_admin",
        actorId: "platform-admin-1"
    });
}

test("support ticket input ve durum sözleşmesi exact alanlarla fail-closed çalışır", () => {
    assert.deepEqual(normalizeCreateInput({
        subject: "  Sipariş ekranı  ",
        description: "  Ekran açılmıyor.  "
    }), {
        subject: "Sipariş ekranı",
        description: "Ekran açılmıyor."
    });
    assert.throws(
        () => normalizeCreateInput({
            subject: "Sorun",
            description: "Açıklama",
            tenantId: "other-tenant"
        }),
        /bilinmeyen alan/
    );
    assert.deepEqual(normalizeStatusUpdateInput({
        status: "in_review",
        note: " İnceliyoruz. "
    }), {
        status: "in_review",
        note: "İnceliyoruz."
    });
    assert.throws(
        () => normalizeStatusUpdateInput({ status: "reopened" }),
        /durumu geçersiz/
    );
    assert.deepEqual(SUPPORT_TICKET_TRANSITIONS.resolved, []);
});

test("owner ve tenant admin destek izinlerine sahiptir; staff/viewer değildir", () => {
    for (const role of ["tenant_owner", "tenant_admin"]) {
        assert.equal(ROLE_PERMISSIONS[role].includes("support.create"), true);
        assert.equal(ROLE_PERMISSIONS[role].includes("support.read"), true);
    }
    for (const role of ["staff", "viewer"]) {
        assert.equal(ROLE_PERMISSIONS[role].includes("support.create"), false);
        assert.equal(ROLE_PERMISSIONS[role].includes("support.read"), false);
    }
});

test("ticket create tenant record + platform index + safe audit'i atomik yazar", async () => {
    const db = createFakeDb();
    const repository = createFirestoreSupportTicketRepository({ db });
    const times = [new Date("2026-09-19T18:00:00.000Z")];
    const service = createSupportTicketService({
        repository,
        clock: () => times.shift()
    });

    const ticket = await service.createOwnerTicket({
        context: ownerContext(),
        tenantId: "ela-doner",
        input: {
            subject: "<script>alert(1)</script> Sipariş",
            description: "Sipariş ekranında hata görüyorum."
        },
        requestId: "req-ticket-create"
    });

    assert.equal(ticket.tenantId, "ela-doner");
    assert.equal(ticket.status, "open");
    assert.equal(ticket.history.length, 1);
    assert.equal(ticket.history[0].actorRole, "tenant_owner");

    const tenantPath = `tenants/ela-doner/supportTickets/${ticket.ticketId}`;
    const indexPath = `platformSupportTickets/${ticket.ticketId}`;
    assert.equal(db.docs.has(tenantPath), true);
    assert.equal(db.docs.has(indexPath), true);
    assert.equal(db.docs.get(indexPath).description, undefined);

    const audit = [...db.docs.entries()]
        .filter(([key]) => key.startsWith("tenants/ela-doner/audit/"))
        .map(([, value]) => value);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "support.ticket.created");
    assert.deepEqual(audit[0].metadata, {
        ticketId: ticket.ticketId,
        status: "open"
    });
    assert.equal(JSON.stringify(audit[0]).includes("Sipariş ekranında hata"), false);
});

test("owner yalnız kendi tenant ticketlarını görür; staff fail-closed reddedilir", async () => {
    const db = createFakeDb();
    const repository = createFirestoreSupportTicketRepository({ db });
    const service = createSupportTicketService({
        repository,
        clock: () => new Date("2026-09-19T18:05:00.000Z")
    });

    await service.createOwnerTicket({
        context: ownerContext("ela-doner"),
        tenantId: "ela-doner",
        input: { subject: "ELA talebi", description: "ELA açıklaması" }
    });

    const own = await service.listOwnerTickets({
        context: ownerContext("ela-doner"),
        tenantId: "ela-doner"
    });
    assert.equal(own.length, 1);

    await assert.rejects(
        service.listOwnerTickets({
            context: ownerContext("other-tenant"),
            tenantId: "ela-doner"
        }),
        error => error.code === "TENANT_SCOPE_MISMATCH"
    );

    await assert.rejects(
        service.listOwnerTickets({
            context: ownerContext("ela-doner", "staff"),
            tenantId: "ela-doner"
        }),
        error => error.code === "PERMISSION_DENIED"
    );
});

test("Platform Admin ticketı open -> in_review -> resolved yapar ve geçmiş/audit korunur", async () => {
    const db = createFakeDb();
    const repository = createFirestoreSupportTicketRepository({ db });
    const times = [
        new Date("2026-09-19T18:10:00.000Z"),
        new Date("2026-09-19T18:11:00.000Z"),
        new Date("2026-09-19T18:12:00.000Z")
    ];
    const service = createSupportTicketService({
        repository,
        clock: () => times.shift()
    });

    const created = await service.createOwnerTicket({
        context: ownerContext(),
        tenantId: "ela-doner",
        input: {
            subject: "Durum alınamıyor",
            description: "Müşteri ekranında durum alınamıyor."
        }
    });

    const reviewing = await service.updatePlatformTicketStatus({
        context: platformContext(),
        tenantId: "ela-doner",
        ticketId: created.ticketId,
        input: {
            status: "in_review",
            note: "Loglar inceleniyor."
        },
        requestId: "req-review"
    });
    assert.equal(reviewing.status, "in_review");
    assert.equal(reviewing.history.length, 2);
    assert.equal(reviewing.history[1].note, "Loglar inceleniyor.");
    assert.equal(reviewing.history[1].actorRole, "platform_admin");

    const resolved = await service.updatePlatformTicketStatus({
        context: platformContext(),
        tenantId: "ela-doner",
        ticketId: created.ticketId,
        input: {
            status: "resolved",
            note: "Sorun giderildi."
        },
        requestId: "req-resolve"
    });
    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.history.length, 3);
    assert.equal(
        db.docs.get(`platformSupportTickets/${created.ticketId}`).status,
        "resolved"
    );

    await assert.rejects(
        service.updatePlatformTicketStatus({
            context: platformContext(),
            tenantId: "ela-doner",
            ticketId: created.ticketId,
            input: { status: "in_review", note: null }
        }),
        error => error.code === "SUPPORT_TICKET_STATUS_TRANSITION_INVALID"
    );

    const audits = [...db.docs.entries()]
        .filter(([key]) => key.startsWith("tenants/ela-doner/audit/"))
        .map(([, value]) => value);
    assert.deepEqual(
        audits.map(item => item.action).sort(),
        [
            "support.ticket.created",
            "support.ticket.status_changed",
            "support.ticket.status_changed"
        ].sort()
    );
});

test("Platform Admin tenant ve status filtreleriyle merkezi ticket kuyruğunu okur", async () => {
    const db = createFakeDb();
    const repository = createFirestoreSupportTicketRepository({ db });
    const times = [
        new Date("2026-09-19T18:20:00.000Z"),
        new Date("2026-09-19T18:21:00.000Z")
    ];
    const service = createSupportTicketService({
        repository,
        clock: () => times.shift()
    });

    await service.createOwnerTicket({
        context: ownerContext("ela-doner"),
        tenantId: "ela-doner",
        input: { subject: "ELA destek", description: "ELA açıklama" }
    });
    await service.createOwnerTicket({
        context: ownerContext("other-tenant"),
        tenantId: "other-tenant",
        input: { subject: "Diğer destek", description: "Diğer açıklama" }
    });

    const all = await service.listPlatformTickets({
        context: platformContext(),
        limit: 200
    });
    assert.equal(all.length, 2);

    const ela = await service.listPlatformTickets({
        context: platformContext(),
        tenantId: "ela-doner",
        status: "open",
        limit: 200
    });
    assert.equal(ela.length, 1);
    assert.equal(ela[0].tenantId, "ela-doner");

    await assert.rejects(
        service.listPlatformTickets({
            context: ownerContext(),
            limit: 200
        }),
        error => error.code === "PERMISSION_DENIED"
    );
});

test("admin ticket 5xx yolu tenant operational alarm scope'una bağlanır", () => {
    assert.deepEqual(
        resolveOperationalAlertScope(
            "/api/platform/support/tickets/ela-doner/123e4567-e89b-12d3-a456-426614174000/status"
        ),
        {
            tenantId: "ela-doner",
            operation: "http.platform.support_ticket"
        }
    );
    assert.equal(
        resolveOperationalAlertScope("/api/platform/support/tickets"),
        null
    );
});

test("ticket UI server-resolved owner session ve ayrı admin auth kullanır; innerHTML yoktur", () => {
    const ownerRoot = path.join(__dirname, "../public/owner");
    const adminRoot = path.join(__dirname, "../public/admin");
    const ownerHtml = fs.readFileSync(path.join(ownerRoot, "support.html"), "utf8");
    const ownerJs = fs.readFileSync(path.join(ownerRoot, "support.js"), "utf8");
    const panelHtml = fs.readFileSync(path.join(ownerRoot, "panel.html"), "utf8");
    const adminHtml = fs.readFileSync(path.join(adminRoot, "support-tickets.html"), "utf8");
    const adminJs = fs.readFileSync(path.join(adminRoot, "support-tickets.js"), "utf8");
    const adminIndex = fs.readFileSync(path.join(adminRoot, "index.html"), "utf8");
    const supportDashboard = fs.readFileSync(
        path.join(adminRoot, "support-dashboard.js"),
        "utf8"
    );

    assert.match(ownerHtml, /session-resolver\.js/);
    assert.match(ownerJs, /OWNER_SESSION_RESOLVER\.resolve/);
    assert.match(ownerJs, /\/owner\/support\/tickets/);
    assert.match(panelHtml, /\/owner\/support\.html/);

    assert.match(adminHtml, /auth-isolation\.js/);
    assert.match(adminJs, /PLATFORM_ADMIN_AUTH/);
    assert.match(adminJs, /\/api\/platform\/support\/tickets/);
    assert.match(adminIndex, /\/admin\/support-tickets\.html/);
    assert.match(supportDashboard, /support-tickets\.html\?tenantId=/);

    assert.doesNotMatch(ownerJs, /innerHTML\s*=/);
    assert.doesNotMatch(adminJs, /innerHTML\s*=/);
    assert.doesNotMatch(ownerJs, /localStorage/);
    assert.doesNotMatch(adminJs, /localStorage/);
});

test("server runtime support ticket repository, service ve iki endpoint grubunu bağlar", () => {
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    assert.match(server, /createFirestoreSupportTicketRepository/);
    assert.match(server, /createSupportTicketService/);
    assert.match(server, /attachSupportTicketOwnerEndpoints/);
    assert.match(server, /attachSupportTicketAdminEndpoints/);
});
