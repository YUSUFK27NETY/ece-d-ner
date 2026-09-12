const rateLimit = require("express-rate-limit");

const PUBLIC_APPOINTMENTS_BASE = "/api/public/appointments/:tenantId";

function createAppointmentRateLimiter({ windowMs = 60_000, max = 90 } = {}) {
    const safeWindowMs = Number(windowMs);
    const safeMax = Number(max);
    if (!Number.isSafeInteger(safeWindowMs) || safeWindowMs < 1_000 || safeWindowMs > 3_600_000 ||
        !Number.isSafeInteger(safeMax) || safeMax < 1 || safeMax > 10_000) {
        throw new TypeError("Appointment public rate limit geçersiz.");
    }
    return rateLimit({
        windowMs: safeWindowMs,
        max: safeMax,
        standardHeaders: true,
        legacyHeaders: false,
        message: { success: false, message: "Çok fazla randevu isteği gönderildi." }
    });
}

function requireNoQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Randevu isteği sorgu parametresi kabul etmez.");
    }
}

function requireSlotsQuery(query) {
    if (!query || typeof query !== "object" || Array.isArray(query)) {
        throw new TypeError("Randevu saat sorgusu geçersiz.");
    }
    const keys = Reflect.ownKeys(query);
    const allowed = ["serviceId", "staffId", "date"];
    if (keys.length !== allowed.length || keys.some(key => typeof key !== "string" || !allowed.includes(key))) {
        throw new TypeError("Randevu saat sorgusu geçersiz.");
    }
    for (const key of allowed) {
        const descriptor = Object.getOwnPropertyDescriptor(query, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") {
            throw new TypeError("Randevu saat sorgusu geçersiz.");
        }
    }
    return query;
}

function requireIdempotencyKey(req) {
    const value = req.get("idempotency-key");
    if (typeof value !== "string" || !value) {
        throw new TypeError("Idempotency-Key başlığı gerekli.");
    }
    return value;
}

function sendPublicAppointmentError(res, error) {
    if (new Set([
        "APPOINTMENT_NOT_AVAILABLE",
        "APPOINTMENT_RESOURCE_UNAVAILABLE",
        "TENANT_NOT_FOUND",
        "ENTITLEMENT_DENIED",
        "ENTITLEMENT_PLAN_UNRESOLVED"
    ]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "Randevu hizmeti kullanılamıyor." });
    }
    if (new Set([
        "APPOINTMENT_SLOT_UNAVAILABLE",
        "APPOINTMENT_SLOT_TAKEN",
        "APPOINTMENT_IDEMPOTENCY_CONFLICT"
    ]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: error?.code === "APPOINTMENT_IDEMPOTENCY_CONFLICT"
                ? "Bu randevu isteği daha önce farklı bilgilerle kullanılmış."
                : "Seçilen saat artık müsait değil."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({ success: false, message: "Randevu isteği geçersiz." });
    }
    console.error("Public appointment runtime hatası:", error?.code || "UNEXPECTED");
    return res.status(500).json({ success: false, message: "Randevu işlemi tamamlanamadı." });
}

function attachPublicAppointmentRuntime({ app, appointmentService, rateLimiter = null }) {
    if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
        throw new TypeError("Public appointment app geçersiz.");
    }
    const required = ["getPublicConfig", "getPublicSlots", "createPublicAppointment"];
    if (!appointmentService || required.some(method => typeof appointmentService[method] !== "function")) {
        throw new TypeError("Public appointment service geçersiz.");
    }
    const limiter = rateLimiter || createAppointmentRateLimiter();
    if (typeof limiter !== "function") throw new TypeError("Public appointment limiter geçersiz.");

    app.get(`${PUBLIC_APPOINTMENTS_BASE}/config`, limiter, async (req, res) => {
        try {
            requireNoQuery(req);
            const config = await appointmentService.getPublicConfig({ tenantId: req.params.tenantId });
            return res.json({ success: true, config });
        } catch (error) {
            return sendPublicAppointmentError(res, error);
        }
    });

    app.get(`${PUBLIC_APPOINTMENTS_BASE}/slots`, limiter, async (req, res) => {
        try {
            const query = requireSlotsQuery(req.query);
            const slots = await appointmentService.getPublicSlots({
                tenantId: req.params.tenantId,
                serviceId: query.serviceId,
                staffId: query.staffId,
                date: query.date
            });
            return res.json({ success: true, slots });
        } catch (error) {
            return sendPublicAppointmentError(res, error);
        }
    });

    app.post(`${PUBLIC_APPOINTMENTS_BASE}/bookings`, limiter, async (req, res) => {
        try {
            if (!req.is("application/json")) {
                return res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
            }
            requireNoQuery(req);
            const appointment = await appointmentService.createPublicAppointment({
                tenantId: req.params.tenantId,
                request: req.body,
                idempotencyKey: requireIdempotencyKey(req),
                requestId: req.requestId
            });
            return res.status(201).json({ success: true, appointment });
        } catch (error) {
            return sendPublicAppointmentError(res, error);
        }
    });

    return app;
}

module.exports = {
    PUBLIC_APPOINTMENTS_BASE,
    attachPublicAppointmentRuntime,
    createAppointmentRateLimiter,
    requireSlotsQuery,
    sendPublicAppointmentError
};
