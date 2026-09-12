const { sendPlatformError } = require("./create-platform-app");

const OWNER_APPOINTMENTS_BASE = "/api/tenant/tenants/:tenantId/owner/appointments";

function actorContext(req) {
    return Object.freeze({
        role: req.tenantActor.role,
        actorId: req.tenantActor.actorId,
        tenantId: req.tenantActor.tenantId
    });
}

function requireJson(req, res) {
    if (!req.is("application/json")) {
        res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
        return false;
    }
    return true;
}

function requireNoQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Randevu yönetim isteği sorgu parametresi kabul etmez.");
    }
}

function requireSingleFieldBody(body, field, label) {
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Object.getPrototypeOf(body) !== Object.prototype) {
        throw new TypeError(`${label} geçersiz.`);
    }
    const keys = Reflect.ownKeys(body);
    if (keys.length !== 1 || keys[0] !== field) throw new TypeError(`${label} geçersiz.`);
    const descriptor = Object.getOwnPropertyDescriptor(body, field);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new TypeError(`${label} geçersiz.`);
    return descriptor.value;
}

function normalizeLimit(value = 200) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || String(limit) !== String(value) || limit < 1 || limit > 500) {
        throw new TypeError("Randevu liste limiti geçersiz.");
    }
    return limit;
}

function sendAppointmentOwnerError(res, error) {
    if (new Set([
        "APPOINTMENT_SERVICE_NOT_FOUND",
        "APPOINTMENT_STAFF_NOT_FOUND",
        "APPOINTMENT_NOT_FOUND",
        "TENANT_NOT_FOUND"
    ]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Kayıt bulunamadı." });
    }
    if (new Set([
        "APPOINTMENT_SERVICE_STATE_CHANGED",
        "APPOINTMENT_STAFF_STATE_CHANGED",
        "APPOINTMENT_AVAILABILITY_STATE_CHANGED",
        "APPOINTMENT_STATE_CHANGED",
        "APPOINTMENT_STATUS_INVALID_TRANSITION",
        "TENANT_ARCHIVED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: "İşlem mevcut işletme/randevu durumuyla uyumlu değil."
        });
    }
    if (error?.code === "APPOINTMENT_UNAVAILABLE") {
        return res.status(503).json({ success: false, message: "Randevu verileri şu anda kullanılamıyor." });
    }
    return sendPlatformError(res, error);
}

function attachAppointmentOwnerEndpoints({ app, appointmentService }) {
    if (!app || typeof app.get !== "function" || typeof app.post !== "function" ||
        typeof app.patch !== "function") {
        throw new TypeError("Appointment owner endpoint app geçersiz.");
    }
    const requiredMethods = [
        "listServicesAdmin", "createServiceAdmin", "updateServiceAdmin",
        "listStaffAdmin", "createStaffAdmin", "updateStaffAdmin",
        "getAvailabilityAdmin", "setAvailabilityAdmin",
        "listAppointmentsAdmin", "updateAppointmentStatusAdmin"
    ];
    if (!appointmentService || requiredMethods.some(method => typeof appointmentService[method] !== "function")) {
        throw new TypeError("Appointment owner service geçersiz.");
    }

    app.get(`${OWNER_APPOINTMENTS_BASE}/services`, async (req, res) => {
        try {
            requireNoQuery(req);
            const services = await appointmentService.listServicesAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, services });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.post(`${OWNER_APPOINTMENTS_BASE}/services`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const service = await appointmentService.createServiceAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                service: req.body,
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, service });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.patch(`${OWNER_APPOINTMENTS_BASE}/services/:serviceId`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const service = await appointmentService.updateServiceAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                serviceId: req.params.serviceId,
                patch: req.body,
                requestId: req.requestId
            });
            return res.json({ success: true, service });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.get(`${OWNER_APPOINTMENTS_BASE}/staff`, async (req, res) => {
        try {
            requireNoQuery(req);
            const staff = await appointmentService.listStaffAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, staff });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.post(`${OWNER_APPOINTMENTS_BASE}/staff`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const staff = await appointmentService.createStaffAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                staff: req.body,
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, staff });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.patch(`${OWNER_APPOINTMENTS_BASE}/staff/:staffId`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const staff = await appointmentService.updateStaffAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                staffId: req.params.staffId,
                patch: req.body,
                requestId: req.requestId
            });
            return res.json({ success: true, staff });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.get(`${OWNER_APPOINTMENTS_BASE}/staff/:staffId/availability`, async (req, res) => {
        try {
            requireNoQuery(req);
            const availability = await appointmentService.getAvailabilityAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                staffId: req.params.staffId
            });
            return res.json({ success: true, availability });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.patch(`${OWNER_APPOINTMENTS_BASE}/staff/:staffId/availability`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const weekly = requireSingleFieldBody(req.body, "weekly", "Müsaitlik isteği");
            const availability = await appointmentService.setAvailabilityAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                staffId: req.params.staffId,
                weekly,
                requestId: req.requestId
            });
            return res.json({ success: true, availability });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.get(`${OWNER_APPOINTMENTS_BASE}/bookings`, async (req, res) => {
        try {
            const keys = Reflect.ownKeys(req.query);
            if (keys.some(key => key !== "limit") || keys.length > 1) {
                throw new TypeError("Randevu liste sorgusu geçersiz.");
            }
            const appointments = await appointmentService.listAppointmentsAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                limit: req.query.limit === undefined ? 200 : normalizeLimit(req.query.limit)
            });
            return res.json({ success: true, appointments });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    app.patch(`${OWNER_APPOINTMENTS_BASE}/bookings/:appointmentId/status`, async (req, res) => {
        try {
            if (!requireJson(req, res)) return undefined;
            requireNoQuery(req);
            const status = requireSingleFieldBody(req.body, "status", "Randevu durum isteği");
            if (typeof status !== "string") throw new TypeError("Randevu durum isteği geçersiz.");
            const appointment = await appointmentService.updateAppointmentStatusAdmin({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                appointmentId: req.params.appointmentId,
                status,
                requestId: req.requestId
            });
            return res.json({ success: true, appointment });
        } catch (error) {
            return sendAppointmentOwnerError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_APPOINTMENTS_BASE,
    attachAppointmentOwnerEndpoints,
    normalizeLimit,
    sendAppointmentOwnerError
};