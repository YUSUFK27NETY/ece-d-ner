const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { once } = require("node:events");

const {
    createAppointmentService
} = require("../src/appointments/appointment-service");
const {
    createAvailabilityRecord,
    createServiceRecord,
    createStaffRecord
} = require("../src/appointments/appointment-model");
const {
    createSlotLockIds,
    generateAvailableSlots,
    localDateForIso,
    localDateTimeToIso
} = require("../src/appointments/appointment-slots");
const {
    attachPublicAppointmentRuntime
} = require("../src/http/attach-public-appointment-runtime");
const { hasPermission } = require("../src/auth/authorize-tenant-action");
const { TENANT_COLLECTIONS } = require("../src/firestore/tenant-paths");

const SERVICE_ID = `svc_${"a".repeat(32)}`;
const STAFF_ID = `staff_${"b".repeat(32)}`;
const FIXED_NOW = new Date("2026-09-12T10:00:00.000Z");

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function createMemoryRepository({ hideAppointmentsFromLists = false } = {}) {
    const services = new Map();
    const staff = new Map();
    const availability = new Map();
    const appointments = new Map();
    const locks = new Map();

    return {
        services,
        staff,
        availability,
        appointments,
        locks,
        async listServicesByTenant() { return [...services.values()]; },
        async getServiceById(tenantId, id) { return services.get(`${tenantId}:${id}`) || null; },
        async commitServiceUpsert({ nextService }) {
            services.set(`${nextService.tenantId}:${nextService.serviceId}`, nextService);
            return nextService;
        },
        async listStaffByTenant() { return [...staff.values()]; },
        async getStaffById(tenantId, id) { return staff.get(`${tenantId}:${id}`) || null; },
        async commitStaffUpsert({ nextStaff }) {
            staff.set(`${nextStaff.tenantId}:${nextStaff.staffId}`, nextStaff);
            return nextStaff;
        },
        async getAvailability(tenantId, id) { return availability.get(`${tenantId}:${id}`) || null; },
        async commitAvailabilityUpsert({ nextAvailability }) {
            availability.set(`${nextAvailability.tenantId}:${nextAvailability.staffId}`, nextAvailability);
            return nextAvailability;
        },
        async listAppointmentsByTenant(tenantId) {
            if (hideAppointmentsFromLists) return [];
            return [...appointments.values()].filter(item => item.tenantId === tenantId);
        },
        async getAppointmentById(tenantId, id) { return appointments.get(`${tenantId}:${id}`) || null; },
        async commitAppointmentCreate({ appointment, slotLockIds }) {
            for (const lockId of slotLockIds) {
                if (locks.has(`${appointment.tenantId}:${lockId}`)) {
                    throw safeError("APPOINTMENT_SLOT_TAKEN", "slot taken");
                }
            }
            appointments.set(`${appointment.tenantId}:${appointment.appointmentId}`, appointment);
            for (const lockId of slotLockIds) {
                locks.set(`${appointment.tenantId}:${lockId}`, appointment.appointmentId);
            }
            return { created: true, appointment };
        },
        async commitStatusUpdate({ nextAppointment, slotLockIds }) {
            appointments.set(`${nextAppointment.tenantId}:${nextAppointment.appointmentId}`, nextAppointment);
            if (nextAppointment.status === "cancelled") {
                for (const lockId of slotLockIds) locks.delete(`${nextAppointment.tenantId}:${lockId}`);
            }
            return nextAppointment;
        }
    };
}

function createEntitlements() {
    return {
        evaluate({ feature }) {
            return { feature, featureEnabled: true, usedDefaultPlanPolicy: false };
        },
        assertFeatureAccess({ feature }) {
            return { feature, featureEnabled: true, usedDefaultPlanPolicy: false };
        }
    };
}

function createTenant(tenantId = "randevu-demo") {
    return {
        tenantId,
        displayName: "Randevu Demo",
        status: "active",
        plan: "starter",
        profile: { timezone: "Europe/Istanbul" },
        features: { appointments: true }
    };
}

async function seedAppointmentService({ hideAppointmentsFromLists = false } = {}) {
    const tenant = createTenant();
    const repository = createMemoryRepository({ hideAppointmentsFromLists });
    const service = createAppointmentService({
        tenantRegistry: { async getById(id) { return id === tenant.tenantId ? tenant : null; } },
        appointmentRepository: repository,
        entitlementService: createEntitlements(),
        clock: () => new Date(FIXED_NOW),
        serviceIdFactory: () => SERVICE_ID,
        staffIdFactory: () => STAFF_ID
    });
    const context = { role: "tenant_owner", actorId: "owner-1", tenantId: tenant.tenantId };
    await service.createServiceAdmin({
        context,
        tenantId: tenant.tenantId,
        service: { name: "Saç Kesimi", durationMinutes: 30, price: 350, active: true }
    });
    await service.createStaffAdmin({
        context,
        tenantId: tenant.tenantId,
        staff: { name: "Ayşe", serviceIds: [SERVICE_ID], active: true }
    });
    await service.setAvailabilityAdmin({
        context,
        tenantId: tenant.tenantId,
        staffId: STAFF_ID,
        weekly: {
            "0": [{ start: "09:00", end: "12:00" }],
            "1": [], "2": [], "3": [], "4": [], "5": [], "6": []
        }
    });
    return { tenant, repository, service, context };
}

test("appointment slot motoru Europe/Istanbul zaman diliminde 15 dakikalık slot üretir", () => {
    assert.equal(localDateTimeToIso("2026-09-13", "09:00", "Europe/Istanbul"), "2026-09-13T06:00:00.000Z");
    assert.equal(localDateForIso("2026-09-13T06:00:00.000Z", "Europe/Istanbul"), "2026-09-13");

    const availability = createAvailabilityRecord({
        tenantId: "randevu-demo",
        staffId: STAFF_ID,
        weekly: {
            "0": [{ start: "09:00", end: "10:00" }],
            "1": [], "2": [], "3": [], "4": [], "5": [], "6": []
        },
        now: FIXED_NOW
    });
    const slots = generateAvailableSlots({
        tenantId: "randevu-demo",
        staffId: STAFF_ID,
        date: "2026-09-13",
        timeZone: "Europe/Istanbul",
        availability,
        durationMinutes: 30,
        appointments: [],
        now: FIXED_NOW
    });
    assert.deepEqual(slots.map(item => item.startAt), [
        "2026-09-13T06:00:00.000Z",
        "2026-09-13T06:15:00.000Z",
        "2026-09-13T06:30:00.000Z"
    ]);
});

test("appointment slot lock aynı personel/saat için yarışan ikinci booking'i fail-closed reddeder", async () => {
    const fixture = await seedAppointmentService({ hideAppointmentsFromLists: true });
    const request = {
        customerName: "Test Müşteri",
        phone: "05000000000",
        serviceId: SERVICE_ID,
        staffId: STAFF_ID,
        startAt: "2026-09-13T06:00:00.000Z",
        note: ""
    };
    const first = await fixture.service.createPublicAppointment({
        tenantId: fixture.tenant.tenantId,
        request,
        idempotencyKey: "appointment-key-0001"
    });
    assert.equal(first.status, "pending");
    assert.equal(first.startAt, request.startAt);
    assert.equal(fixture.repository.locks.size, 2);

    await assert.rejects(
        fixture.service.createPublicAppointment({
            tenantId: fixture.tenant.tenantId,
            request: { ...request, customerName: "Başka Müşteri" },
            idempotencyKey: "appointment-key-0002"
        }),
        error => error.code === "APPOINTMENT_SLOT_TAKEN"
    );

    await fixture.service.updateAppointmentStatusAdmin({
        context: fixture.context,
        tenantId: fixture.tenant.tenantId,
        appointmentId: first.appointmentId,
        status: "cancelled"
    });
    assert.equal(fixture.repository.locks.size, 0);

    const replacement = await fixture.service.createPublicAppointment({
        tenantId: fixture.tenant.tenantId,
        request: { ...request, customerName: "Yeni Müşteri" },
        idempotencyKey: "appointment-key-0003"
    });
    assert.equal(replacement.status, "pending");
});

test("appointment owner exact tenant sınırını ve appointments.manage RBAC'ını korur", async () => {
    assert.equal(hasPermission("tenant_owner", "appointments.manage"), true);
    assert.equal(hasPermission("tenant_admin", "appointments.manage"), true);
    assert.equal(hasPermission("staff", "appointments.manage"), false);
    assert.equal(hasPermission("viewer", "appointments.manage"), false);

    const fixture = await seedAppointmentService();
    await assert.rejects(
        fixture.service.listServicesAdmin({
            context: { role: "tenant_owner", actorId: "owner-1", tenantId: "baska-isletme" },
            tenantId: fixture.tenant.tenantId
        }),
        error => error.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("tenant Firestore yolları appointment kayıtlarını tenant kökü altında ayrı koleksiyonlarda tutar", () => {
    assert.equal(TENANT_COLLECTIONS.appointmentServices, "appointmentServices");
    assert.equal(TENANT_COLLECTIONS.appointmentStaff, "appointmentStaff");
    assert.equal(TENANT_COLLECTIONS.appointmentAvailability, "appointmentAvailability");
    assert.equal(TENANT_COLLECTIONS.appointments, "appointments");
    assert.equal(TENANT_COLLECTIONS.appointmentLocks, "appointmentLocks");
});

test("public appointment HTTP runtime query ve idempotency kontratını fail-closed uygular", async () => {
    const calls = [];
    const app = express();
    app.use(express.json());
    const appointmentService = {
        async getPublicConfig(args) {
            calls.push(["config", args]);
            return { tenantId: args.tenantId, timezone: "Europe/Istanbul", services: [], staff: [] };
        },
        async getPublicSlots(args) {
            calls.push(["slots", args]);
            if (args.date === "2099-01-01") throw safeError("APPOINTMENT_DATE_UNAVAILABLE", "date");
            return [];
        },
        async createPublicAppointment(args) {
            calls.push(["create", args]);
            return {
                appointmentId: `appt_${"c".repeat(40)}`,
                status: "pending",
                service: { name: "Hizmet" },
                staff: { name: "Personel" },
                startAt: "2026-09-13T06:00:00.000Z"
            };
        }
    };
    attachPublicAppointmentRuntime({
        app,
        appointmentService,
        rateLimiter: (req, res, next) => next()
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}/api/public/appointments/randevu-demo`;
    try {
        assert.equal((await fetch(`${base}/config?extra=1`)).status, 400);
        assert.equal((await fetch(`${base}/slots?serviceId=${SERVICE_ID}&staffId=${STAFF_ID}`)).status, 400);
        assert.equal((await fetch(`${base}/slots?serviceId=${SERVICE_ID}&staffId=${STAFF_ID}&date=2099-01-01`)).status, 400);

        const missingKey = await fetch(`${base}/bookings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({})
        });
        assert.equal(missingKey.status, 400);

        const created = await fetch(`${base}/bookings`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": "appointment-http-key-0001"
            },
            body: JSON.stringify({ customerName: "Test" })
        });
        assert.equal(created.status, 201);
        const createCall = calls.find(([name]) => name === "create")[1];
        assert.equal(createCall.tenantId, "randevu-demo");
        assert.equal(createCall.idempotencyKey, "appointment-http-key-0001");
    } finally {
        server.close();
        await once(server, "close");
    }
});

test("appointment owner/public UI güvenli DOM kullanır ve browser storage'a credential yazmaz", () => {
    const ownerHtml = fs.readFileSync(path.join(__dirname, "../public/owner/appointments.html"), "utf8");
    const ownerJs = fs.readFileSync(path.join(__dirname, "../public/owner/appointments.js"), "utf8");
    const publicHtml = fs.readFileSync(path.join(__dirname, "../public/storefront/appointments.html"), "utf8");
    const publicJs = fs.readFileSync(path.join(__dirname, "../public/storefront/appointments.js"), "utf8");
    const storefrontHtml = fs.readFileSync(path.join(__dirname, "../public/storefront/index.html"), "utf8");
    const linkJs = fs.readFileSync(path.join(__dirname, "../public/storefront/appointments-link.js"), "utf8");
    const serverSource = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");

    assert.match(ownerHtml, /id="availability-days"/);
    assert.match(ownerHtml, /id="booking-list"/);
    assert.match(ownerJs, /getIdToken\(\)/);
    assert.doesNotMatch(ownerJs, /innerHTML\s*=/);
    assert.doesNotMatch(ownerJs, /localStorage/);
    assert.doesNotMatch(ownerJs, /setItem\([^\n]*(password|token)/i);

    assert.match(publicHtml, /id="slot-grid"/);
    assert.match(publicJs, /Idempotency-Key/);
    assert.doesNotMatch(publicJs, /innerHTML\s*=/);
    assert.doesNotMatch(publicJs, /localStorage|sessionStorage/);
    assert.match(storefrontHtml, /appointments-link\.js/);
    assert.match(linkJs, /\/appointments/);

    assert.match(serverSource, /createFirestoreAppointmentRepository/);
    assert.match(serverSource, /createAppointmentService/);
    assert.match(serverSource, /attachAppointmentOwnerEndpoints/);
    assert.match(serverSource, /attachPublicAppointmentRuntime/);
});

test("slot lock kimliği hizmet süresindeki her 15 dakikayı ayrı kilitler", () => {
    const locks = createSlotLockIds(
        STAFF_ID,
        "2026-09-13T06:00:00.000Z",
        "2026-09-13T07:00:00.000Z"
    );
    assert.equal(locks.length, 4);
    assert.equal(new Set(locks).size, 4);
});
