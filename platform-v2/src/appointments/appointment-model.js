const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeTurkishPhone } = require("../orders/order-model");

const APPOINTMENT_SCHEMA_VERSION = 1;
const APPOINTMENT_STATUSES = Object.freeze([
    "pending",
    "confirmed",
    "completed",
    "cancelled"
]);
const APPOINTMENT_STATUS_TRANSITIONS = Object.freeze({
    pending: Object.freeze(["confirmed", "cancelled"]),
    confirmed: Object.freeze(["completed", "cancelled"]),
    completed: Object.freeze([]),
    cancelled: Object.freeze([])
});
const SLOT_MINUTES = 15;
const MAX_SERVICE_DURATION_MINUTES = 480;
const DAY_KEYS = Object.freeze(["0", "1", "2", "3", "4", "5", "6"]);
const SERVICE_ID_PATTERN = /^svc_[0-9a-f]{32}$/;
const STAFF_ID_PATTERN = /^staff_[0-9a-f]{32}$/;
const APPOINTMENT_ID_PATTERN = /^appt_[0-9a-f]{40}$/;

function fail(label) {
    throw new TypeError(`Appointment ${label} geçersiz.`);
}

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function assertExactRecord(input, allowed, required, label) {
    if (!isPlainRecord(input)) fail(label);
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key))) fail(label);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) fail(label);
    }
    if (required.some(key => !Object.hasOwn(input, key))) fail(label);
    return input;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireText(value, label, min, max) {
    if (typeof value !== "string") fail(label);
    const normalized = value.trim();
    if (normalized.length < min || normalized.length > max || /[\u0000-\u001f]/.test(normalized)) {
        fail(label);
    }
    return normalized;
}

function optionalText(value, label, max) {
    if (value === undefined || value === null || value === "") return "";
    return requireText(String(value), label, 1, max);
}

function requireBoolean(value, label) {
    if (typeof value !== "boolean") fail(label);
    return value;
}

function requireIsoTimestamp(value, label) {
    if (typeof value !== "string" || Number.isNaN(Date.parse(value)) ||
        new Date(Date.parse(value)).toISOString() !== value) {
        fail(label);
    }
    return value;
}

function requireServiceId(value) {
    if (typeof value !== "string" || !SERVICE_ID_PATTERN.test(value)) fail("serviceId");
    return value;
}

function requireStaffId(value) {
    if (typeof value !== "string" || !STAFF_ID_PATTERN.test(value)) fail("staffId");
    return value;
}

function requireAppointmentId(value) {
    if (typeof value !== "string" || !APPOINTMENT_ID_PATTERN.test(value)) fail("appointmentId");
    return value;
}

function requirePrice(value) {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000) {
        fail("price");
    }
    return Math.round(value * 100) / 100;
}

function requireDuration(value) {
    if (!Number.isInteger(value) || value < SLOT_MINUTES || value > MAX_SERVICE_DURATION_MINUTES ||
        value % SLOT_MINUTES !== 0) {
        fail("durationMinutes");
    }
    return value;
}

function requireClock(now) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("clock");
    return now;
}

function randomHex(bytes = 16) {
    return crypto.randomBytes(bytes).toString("hex");
}

function createServiceId() {
    return `svc_${randomHex(16)}`;
}

function createStaffId() {
    return `staff_${randomHex(16)}`;
}

function normalizeServiceDraft(input) {
    const draft = assertExactRecord(
        input,
        ["name", "durationMinutes", "price", "active"],
        ["name", "durationMinutes"],
        "service draft"
    );
    return Object.freeze({
        name: requireText(ownValue(draft, "name"), "service name", 2, 120),
        durationMinutes: requireDuration(ownValue(draft, "durationMinutes")),
        price: requirePrice(ownValue(draft, "price")),
        active: ownValue(draft, "active") === undefined
            ? true
            : requireBoolean(ownValue(draft, "active"), "service active")
    });
}

function createServiceRecord({ tenantId, serviceId = createServiceId(), draft, now = new Date() }) {
    const time = requireClock(now).toISOString();
    const normalized = normalizeServiceDraft(draft);
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        serviceId: requireServiceId(serviceId),
        ...normalized,
        createdAt: time,
        updatedAt: time
    });
}

function normalizePersistedService({ tenantId, serviceId, data }) {
    if (!isPlainRecord(data)) fail("stored service");
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeServiceId = requireServiceId(serviceId);
    if (ownValue(data, "tenantId") !== safeTenantId || ownValue(data, "serviceId") !== safeServiceId ||
        ownValue(data, "schemaVersion") !== APPOINTMENT_SCHEMA_VERSION) {
        fail("stored service identity");
    }
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        serviceId: safeServiceId,
        name: requireText(ownValue(data, "name"), "stored service name", 2, 120),
        durationMinutes: requireDuration(ownValue(data, "durationMinutes")),
        price: requirePrice(ownValue(data, "price")),
        active: requireBoolean(ownValue(data, "active"), "stored service active"),
        createdAt: requireIsoTimestamp(ownValue(data, "createdAt"), "stored service createdAt"),
        updatedAt: requireIsoTimestamp(ownValue(data, "updatedAt"), "stored service updatedAt")
    });
}

function patchService(existing, patch, now = new Date()) {
    const current = normalizePersistedService({
        tenantId: existing?.tenantId,
        serviceId: existing?.serviceId,
        data: existing
    });
    const input = assertExactRecord(
        patch,
        ["name", "durationMinutes", "price", "active"],
        [],
        "service patch"
    );
    if (Reflect.ownKeys(input).length === 0) fail("service patch");
    const nextDraft = {
        name: ownValue(input, "name") === undefined ? current.name : ownValue(input, "name"),
        durationMinutes: ownValue(input, "durationMinutes") === undefined
            ? current.durationMinutes
            : ownValue(input, "durationMinutes"),
        price: ownValue(input, "price") === undefined ? current.price : ownValue(input, "price"),
        active: ownValue(input, "active") === undefined ? current.active : ownValue(input, "active")
    };
    const normalized = normalizeServiceDraft(nextDraft);
    return Object.freeze({
        ...current,
        ...normalized,
        updatedAt: requireClock(now).toISOString()
    });
}

function normalizeServiceIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) fail("staff serviceIds");
    const output = [];
    for (const item of value) {
        const id = requireServiceId(item);
        if (output.includes(id)) fail("staff serviceIds");
        output.push(id);
    }
    return Object.freeze(output.sort());
}

function normalizeStaffDraft(input) {
    const draft = assertExactRecord(
        input,
        ["name", "serviceIds", "active"],
        ["name", "serviceIds"],
        "staff draft"
    );
    return Object.freeze({
        name: requireText(ownValue(draft, "name"), "staff name", 2, 120),
        serviceIds: normalizeServiceIds(ownValue(draft, "serviceIds")),
        active: ownValue(draft, "active") === undefined
            ? true
            : requireBoolean(ownValue(draft, "active"), "staff active")
    });
}

function createStaffRecord({ tenantId, staffId = createStaffId(), draft, now = new Date() }) {
    const time = requireClock(now).toISOString();
    const normalized = normalizeStaffDraft(draft);
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        staffId: requireStaffId(staffId),
        ...normalized,
        createdAt: time,
        updatedAt: time
    });
}

function normalizePersistedStaff({ tenantId, staffId, data }) {
    if (!isPlainRecord(data)) fail("stored staff");
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeStaffId = requireStaffId(staffId);
    if (ownValue(data, "tenantId") !== safeTenantId || ownValue(data, "staffId") !== safeStaffId ||
        ownValue(data, "schemaVersion") !== APPOINTMENT_SCHEMA_VERSION) {
        fail("stored staff identity");
    }
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        staffId: safeStaffId,
        name: requireText(ownValue(data, "name"), "stored staff name", 2, 120),
        serviceIds: normalizeServiceIds(ownValue(data, "serviceIds")),
        active: requireBoolean(ownValue(data, "active"), "stored staff active"),
        createdAt: requireIsoTimestamp(ownValue(data, "createdAt"), "stored staff createdAt"),
        updatedAt: requireIsoTimestamp(ownValue(data, "updatedAt"), "stored staff updatedAt")
    });
}

function patchStaff(existing, patch, now = new Date()) {
    const current = normalizePersistedStaff({
        tenantId: existing?.tenantId,
        staffId: existing?.staffId,
        data: existing
    });
    const input = assertExactRecord(patch, ["name", "serviceIds", "active"], [], "staff patch");
    if (Reflect.ownKeys(input).length === 0) fail("staff patch");
    const normalized = normalizeStaffDraft({
        name: ownValue(input, "name") === undefined ? current.name : ownValue(input, "name"),
        serviceIds: ownValue(input, "serviceIds") === undefined ? current.serviceIds : ownValue(input, "serviceIds"),
        active: ownValue(input, "active") === undefined ? current.active : ownValue(input, "active")
    });
    return Object.freeze({
        ...current,
        ...normalized,
        updatedAt: requireClock(now).toISOString()
    });
}

function parseClockMinutes(value, label) {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail(label);
    const [hour, minute] = value.split(":").map(Number);
    const total = hour * 60 + minute;
    if (total % SLOT_MINUTES !== 0) fail(label);
    return total;
}

function normalizeWindow(value) {
    const window = assertExactRecord(value, ["start", "end"], ["start", "end"], "availability window");
    const start = ownValue(window, "start");
    const end = ownValue(window, "end");
    const startMinutes = parseClockMinutes(start, "availability start");
    const endMinutes = parseClockMinutes(end, "availability end");
    if (endMinutes <= startMinutes) fail("availability window");
    return Object.freeze({ start, end, startMinutes, endMinutes });
}

function normalizeWeeklyAvailability(value) {
    if (!isPlainRecord(value)) fail("weekly availability");
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string" || !DAY_KEYS.includes(key))) {
        fail("weekly availability");
    }
    const weekly = {};
    for (const day of DAY_KEYS) {
        const raw = ownValue(value, day) ?? [];
        if (!Array.isArray(raw) || raw.length > 4) fail("weekly availability");
        const windows = raw.map(normalizeWindow).sort((a, b) => a.startMinutes - b.startMinutes);
        for (let index = 1; index < windows.length; index += 1) {
            if (windows[index].startMinutes < windows[index - 1].endMinutes) {
                fail("overlapping availability");
            }
        }
        weekly[day] = Object.freeze(windows.map(item => Object.freeze({
            start: item.start,
            end: item.end
        })));
    }
    return Object.freeze(weekly);
}

function createAvailabilityRecord({ tenantId, staffId, weekly, now = new Date() }) {
    const time = requireClock(now).toISOString();
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: requireCanonicalTenantId(tenantId),
        staffId: requireStaffId(staffId),
        weekly: normalizeWeeklyAvailability(weekly),
        updatedAt: time
    });
}

function normalizePersistedAvailability({ tenantId, staffId, data }) {
    if (!isPlainRecord(data)) fail("stored availability");
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeStaffId = requireStaffId(staffId);
    if (ownValue(data, "tenantId") !== safeTenantId || ownValue(data, "staffId") !== safeStaffId ||
        ownValue(data, "schemaVersion") !== APPOINTMENT_SCHEMA_VERSION) {
        fail("stored availability identity");
    }
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        staffId: safeStaffId,
        weekly: normalizeWeeklyAvailability(ownValue(data, "weekly")),
        updatedAt: requireIsoTimestamp(ownValue(data, "updatedAt"), "stored availability updatedAt")
    });
}

function normalizeIdempotencyKey(value) {
    if (typeof value !== "string") fail("idempotencyKey");
    const key = value.trim();
    if (key !== value || key.length < 16 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
        fail("idempotencyKey");
    }
    return key;
}

function sha256(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function createTenantBoundAppointmentId(tenantId, idempotencyKey) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const key = normalizeIdempotencyKey(idempotencyKey);
    return `appt_${sha256(`${safeTenantId}\u0000${key}`).slice(0, 40)}`;
}

function normalizeAppointmentRequest(input) {
    const request = assertExactRecord(
        input,
        ["customerName", "phone", "serviceId", "staffId", "startAt", "note"],
        ["customerName", "phone", "serviceId", "staffId", "startAt"],
        "request"
    );
    return Object.freeze({
        customer: Object.freeze({
            name: requireText(ownValue(request, "customerName"), "customerName", 2, 100),
            phone: normalizeTurkishPhone(ownValue(request, "phone"))
        }),
        serviceId: requireServiceId(ownValue(request, "serviceId")),
        staffId: requireStaffId(ownValue(request, "staffId")),
        startAt: requireIsoTimestamp(ownValue(request, "startAt"), "startAt"),
        note: optionalText(ownValue(request, "note"), "note", 500)
    });
}

function createAppointmentRequestHash(normalizedRequest) {
    if (!normalizedRequest || typeof normalizedRequest !== "object") fail("normalized request");
    return sha256(JSON.stringify(normalizedRequest));
}

function createAppointmentRecord({
    tenantId,
    appointmentId,
    requestHash,
    normalizedRequest,
    service,
    staff,
    now = new Date()
}) {
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeAppointmentId = requireAppointmentId(appointmentId);
    const safeService = normalizePersistedService({
        tenantId: safeTenantId,
        serviceId: service?.serviceId,
        data: service
    });
    const safeStaff = normalizePersistedStaff({
        tenantId: safeTenantId,
        staffId: staff?.staffId,
        data: staff
    });
    if (!safeService.active || !safeStaff.active || !safeStaff.serviceIds.includes(safeService.serviceId)) {
        throw safeError("APPOINTMENT_RESOURCE_UNAVAILABLE", "Randevu kaynağı kullanılamıyor.");
    }
    if (normalizedRequest.serviceId !== safeService.serviceId || normalizedRequest.staffId !== safeStaff.staffId) {
        fail("resource identity");
    }
    const startMs = Date.parse(normalizedRequest.startAt);
    const endAt = new Date(startMs + safeService.durationMinutes * 60_000).toISOString();
    const timestamp = requireClock(now).toISOString();
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        appointmentId: safeAppointmentId,
        status: "pending",
        customer: normalizedRequest.customer,
        service: Object.freeze({
            serviceId: safeService.serviceId,
            name: safeService.name,
            durationMinutes: safeService.durationMinutes,
            price: safeService.price
        }),
        staff: Object.freeze({
            staffId: safeStaff.staffId,
            name: safeStaff.name
        }),
        startAt: normalizedRequest.startAt,
        endAt,
        note: normalizedRequest.note,
        requestHash: typeof requestHash === "string" && /^[0-9a-f]{64}$/.test(requestHash)
            ? requestHash
            : fail("requestHash"),
        createdAt: timestamp,
        updatedAt: timestamp
    });
}

function normalizePersistedAppointment({ tenantId, appointmentId, data }) {
    if (!isPlainRecord(data)) fail("stored appointment");
    const safeTenantId = requireCanonicalTenantId(tenantId);
    const safeAppointmentId = requireAppointmentId(appointmentId);
    if (ownValue(data, "tenantId") !== safeTenantId || ownValue(data, "appointmentId") !== safeAppointmentId ||
        ownValue(data, "schemaVersion") !== APPOINTMENT_SCHEMA_VERSION) {
        fail("stored appointment identity");
    }
    const status = ownValue(data, "status");
    if (!APPOINTMENT_STATUSES.includes(status)) fail("stored appointment status");
    const customer = assertExactRecord(
        ownValue(data, "customer"),
        ["name", "phone"],
        ["name", "phone"],
        "stored customer"
    );
    const service = assertExactRecord(
        ownValue(data, "service"),
        ["serviceId", "name", "durationMinutes", "price"],
        ["serviceId", "name", "durationMinutes", "price"],
        "stored service snapshot"
    );
    const staff = assertExactRecord(
        ownValue(data, "staff"),
        ["staffId", "name"],
        ["staffId", "name"],
        "stored staff snapshot"
    );
    const startAt = requireIsoTimestamp(ownValue(data, "startAt"), "stored startAt");
    const endAt = requireIsoTimestamp(ownValue(data, "endAt"), "stored endAt");
    if (Date.parse(endAt) <= Date.parse(startAt)) fail("stored appointment range");
    const requestHash = ownValue(data, "requestHash");
    if (typeof requestHash !== "string" || !/^[0-9a-f]{64}$/.test(requestHash)) fail("stored requestHash");
    return Object.freeze({
        schemaVersion: APPOINTMENT_SCHEMA_VERSION,
        tenantId: safeTenantId,
        appointmentId: safeAppointmentId,
        status,
        customer: Object.freeze({
            name: requireText(ownValue(customer, "name"), "stored customer name", 2, 100),
            phone: normalizeTurkishPhone(ownValue(customer, "phone"))
        }),
        service: Object.freeze({
            serviceId: requireServiceId(ownValue(service, "serviceId")),
            name: requireText(ownValue(service, "name"), "stored service name", 2, 120),
            durationMinutes: requireDuration(ownValue(service, "durationMinutes")),
            price: requirePrice(ownValue(service, "price"))
        }),
        staff: Object.freeze({
            staffId: requireStaffId(ownValue(staff, "staffId")),
            name: requireText(ownValue(staff, "name"), "stored staff name", 2, 120)
        }),
        startAt,
        endAt,
        note: optionalText(ownValue(data, "note"), "stored note", 500),
        requestHash,
        createdAt: requireIsoTimestamp(ownValue(data, "createdAt"), "stored createdAt"),
        updatedAt: requireIsoTimestamp(ownValue(data, "updatedAt"), "stored updatedAt")
    });
}

function applyAppointmentStatus(existing, nextStatus, now = new Date()) {
    const current = normalizePersistedAppointment({
        tenantId: existing?.tenantId,
        appointmentId: existing?.appointmentId,
        data: existing
    });
    if (typeof nextStatus !== "string" || !APPOINTMENT_STATUSES.includes(nextStatus)) fail("status");
    if (nextStatus === current.status) return current;
    if (!APPOINTMENT_STATUS_TRANSITIONS[current.status].includes(nextStatus)) {
        throw safeError("APPOINTMENT_STATUS_INVALID_TRANSITION", "Randevu durum geçişi geçersiz.");
    }
    return Object.freeze({
        ...current,
        status: nextStatus,
        updatedAt: requireClock(now).toISOString()
    });
}

function projectPublicService(service) {
    const current = normalizePersistedService({
        tenantId: service?.tenantId,
        serviceId: service?.serviceId,
        data: service
    });
    return Object.freeze({
        serviceId: current.serviceId,
        name: current.name,
        durationMinutes: current.durationMinutes,
        price: current.price
    });
}

function projectPublicStaff(staff) {
    const current = normalizePersistedStaff({
        tenantId: staff?.tenantId,
        staffId: staff?.staffId,
        data: staff
    });
    return Object.freeze({
        staffId: current.staffId,
        name: current.name,
        serviceIds: current.serviceIds
    });
}

function projectCustomerAppointment(appointment) {
    const current = normalizePersistedAppointment({
        tenantId: appointment?.tenantId,
        appointmentId: appointment?.appointmentId,
        data: appointment
    });
    return Object.freeze({
        appointmentId: current.appointmentId,
        status: current.status,
        service: current.service,
        staff: current.staff,
        startAt: current.startAt,
        endAt: current.endAt,
        createdAt: current.createdAt,
        updatedAt: current.updatedAt
    });
}

function projectAdminAppointment(appointment) {
    return normalizePersistedAppointment({
        tenantId: appointment?.tenantId,
        appointmentId: appointment?.appointmentId,
        data: appointment
    });
}

module.exports = {
    APPOINTMENT_SCHEMA_VERSION,
    APPOINTMENT_STATUSES,
    APPOINTMENT_STATUS_TRANSITIONS,
    DAY_KEYS,
    MAX_SERVICE_DURATION_MINUTES,
    SLOT_MINUTES,
    applyAppointmentStatus,
    createAppointmentRecord,
    createAppointmentRequestHash,
    createAvailabilityRecord,
    createServiceId,
    createServiceRecord,
    createStaffId,
    createStaffRecord,
    createTenantBoundAppointmentId,
    normalizeAppointmentRequest,
    normalizeIdempotencyKey,
    normalizePersistedAppointment,
    normalizePersistedAvailability,
    normalizePersistedService,
    normalizePersistedStaff,
    normalizeWeeklyAvailability,
    patchService,
    patchStaff,
    projectAdminAppointment,
    projectCustomerAppointment,
    projectPublicService,
    projectPublicStaff,
    requireAppointmentId,
    requireServiceId,
    requireStaffId,
    safeError
};