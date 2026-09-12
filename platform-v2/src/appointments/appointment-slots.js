const crypto = require("node:crypto");
const {
    APPOINTMENT_STATUSES,
    SLOT_MINUTES,
    normalizePersistedAvailability,
    normalizePersistedAppointment,
    requireStaffId
} = require("./appointment-model");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PUBLIC_BOOKING_DAYS = 90;

function fail(label) {
    throw new TypeError(`Appointment slot ${label} geçersiz.`);
}

function requireTimezone(value) {
    if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 64) {
        fail("timezone");
    }
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
    } catch {
        fail("timezone");
    }
    return value;
}

function parseDate(value) {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) fail("date");
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        fail("date");
    }
    return { year, month, day };
}

function parseTime(value) {
    if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) fail("time");
    const [hour, minute] = value.split(":").map(Number);
    return { hour, minute };
}

function zonedParts(timestamp, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    });
    const parts = Object.fromEntries(
        formatter.formatToParts(new Date(timestamp))
            .filter(part => part.type !== "literal")
            .map(part => [part.type, Number(part.value)])
    );
    return {
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        minute: parts.minute,
        second: parts.second
    };
}

function localDateTimeToIso(date, time, rawTimeZone) {
    const timeZone = requireTimezone(rawTimeZone);
    const { year, month, day } = parseDate(date);
    const { hour, minute } = parseTime(time);
    const desired = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
    let candidate = desired;

    for (let attempt = 0; attempt < 4; attempt += 1) {
        const parts = zonedParts(candidate, timeZone);
        const represented = Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            parts.hour,
            parts.minute,
            parts.second || 0,
            0
        );
        const delta = desired - represented;
        candidate += delta;
        if (delta === 0) break;
    }

    const exact = zonedParts(candidate, timeZone);
    if (exact.year !== year || exact.month !== month || exact.day !== day ||
        exact.hour !== hour || exact.minute !== minute) {
        fail("local date/time");
    }
    return new Date(candidate).toISOString();
}

function localDateForIso(iso, rawTimeZone) {
    const timeZone = requireTimezone(rawTimeZone);
    const timestamp = Date.parse(iso);
    if (Number.isNaN(timestamp)) fail("timestamp");
    const parts = zonedParts(timestamp, timeZone);
    return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function weekdayForDate(date) {
    const { year, month, day } = parseDate(date);
    return String(new Date(Date.UTC(year, month - 1, day)).getUTCDay());
}

function overlaps(startAt, endAt, appointment) {
    return Date.parse(startAt) < Date.parse(appointment.endAt) &&
        Date.parse(endAt) > Date.parse(appointment.startAt);
}

function normalizeExistingAppointments(tenantId, staffId, records) {
    if (!Array.isArray(records)) fail("appointments");
    const safeStaffId = requireStaffId(staffId);
    return records.map(record => normalizePersistedAppointment({
        tenantId,
        appointmentId: record?.appointmentId,
        data: record
    })).filter(appointment =>
        appointment.staff.staffId === safeStaffId &&
        appointment.status !== "cancelled"
    );
}

function generateAvailableSlots({
    tenantId,
    staffId,
    date,
    timeZone,
    availability,
    durationMinutes,
    appointments = [],
    now = new Date()
}) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("clock");
    if (!Number.isInteger(durationMinutes) || durationMinutes < SLOT_MINUTES ||
        durationMinutes % SLOT_MINUTES !== 0) {
        fail("duration");
    }
    const safeAvailability = normalizePersistedAvailability({
        tenantId,
        staffId,
        data: availability
    });
    const existing = normalizeExistingAppointments(tenantId, staffId, appointments);
    const windows = safeAvailability.weekly[weekdayForDate(date)] || [];
    const slots = [];
    const durationMs = durationMinutes * 60_000;
    const stepMs = SLOT_MINUTES * 60_000;

    for (const window of windows) {
        const windowStart = Date.parse(localDateTimeToIso(date, window.start, timeZone));
        const windowEnd = Date.parse(localDateTimeToIso(date, window.end, timeZone));
        for (let cursor = windowStart; cursor + durationMs <= windowEnd; cursor += stepMs) {
            const startAt = new Date(cursor).toISOString();
            const endAt = new Date(cursor + durationMs).toISOString();
            if (cursor <= now.getTime()) continue;
            if (existing.some(appointment => overlaps(startAt, endAt, appointment))) continue;
            slots.push(Object.freeze({ startAt, endAt }));
        }
    }
    return Object.freeze(slots);
}

function assertBookableDate(date, rawTimeZone, now = new Date()) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail("clock");
    const timeZone = requireTimezone(rawTimeZone);
    parseDate(date);
    const today = localDateForIso(now.toISOString(), timeZone);
    const todayUtc = Date.parse(`${today}T00:00:00.000Z`);
    const targetUtc = Date.parse(`${date}T00:00:00.000Z`);
    const days = Math.floor((targetUtc - todayUtc) / 86_400_000);
    if (!Number.isInteger(days) || days < 0 || days > MAX_PUBLIC_BOOKING_DAYS) {
        const error = new Error("Randevu tarihi rezervasyon aralığı dışında.");
        error.code = "APPOINTMENT_DATE_UNAVAILABLE";
        throw error;
    }
    return date;
}

function createSlotLockIds(staffId, startAt, endAt) {
    const safeStaffId = requireStaffId(staffId);
    const start = Date.parse(startAt);
    const end = Date.parse(endAt);
    const stepMs = SLOT_MINUTES * 60_000;
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start ||
        start % stepMs !== 0 || end % stepMs !== 0 || (end - start) % stepMs !== 0) {
        fail("lock range");
    }
    const ids = [];
    for (let cursor = start; cursor < end; cursor += stepMs) {
        const key = `${safeStaffId}\u0000${new Date(cursor).toISOString()}`;
        ids.push(`slot_${crypto.createHash("sha256").update(key, "utf8").digest("hex").slice(0, 40)}`);
    }
    return Object.freeze(ids);
}

module.exports = {
    MAX_PUBLIC_BOOKING_DAYS,
    assertBookableDate,
    createSlotLockIds,
    generateAvailableSlots,
    localDateForIso,
    localDateTimeToIso,
    requireTimezone,
    weekdayForDate
};