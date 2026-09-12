const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
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
    patchService,
    patchStaff,
    projectAdminAppointment,
    projectCustomerAppointment,
    projectPublicService,
    projectPublicStaff,
    requireAppointmentId,
    requireServiceId,
    requireStaffId
} = require("./appointment-model");
const {
    assertBookableDate,
    createSlotLockIds,
    generateAvailableSlots,
    localDateForIso,
    requireTimezone
} = require("./appointment-slots");

const APPOINTMENTS_FEATURE = "appointments";
const APPOINTMENTS_PERMISSION = "appointments.manage";

function failDependency(label) {
    throw new TypeError(`Appointment service ${label} geçersiz.`);
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

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Appointment tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Appointment tenantId geçersiz.");
    return tenantId;
}

function requireClockNow(clock) {
    let now;
    try {
        now = clock();
    } catch {
        throw new TypeError("Appointment clock geçersiz.");
    }
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Appointment clock geçersiz.");
    }
    return now;
}

function requireOpaqueIdentifier(value, label, { optional = false } = {}) {
    if ((value === undefined || value === null) && optional) return null;
    if (typeof value !== "string" || value !== value.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || /^\d{7,15}$/.test(value)) {
        throw new TypeError(`Appointment ${label} geçersiz.`);
    }
    return value;
}

function assertRepository(value) {
    const methods = [
        "listServicesByTenant", "getServiceById", "commitServiceUpsert",
        "listStaffByTenant", "getStaffById", "commitStaffUpsert",
        "getAvailability", "commitAvailabilityUpsert",
        "listAppointmentsByTenant", "getAppointmentById",
        "commitAppointmentCreate", "commitStatusUpdate"
    ];
    if (!value || methods.some(method => typeof value[method] !== "function")) {
        failDependency("repository");
    }
    return value;
}

function assertTenantRegistry(value) {
    if (!value || typeof value.getById !== "function") failDependency("tenant registry");
    return value;
}

function assertEntitlementService(value) {
    if (!value || typeof value.evaluate !== "function" || typeof value.assertFeatureAccess !== "function") {
        failDependency("entitlement service");
    }
    return value;
}

function requireTenantRecord(tenant, tenantId) {
    if (!isPlainRecord(tenant) || tenant.tenantId !== tenantId || requireTenantId(tenant.tenantId) !== tenantId) {
        throw safeError("TENANT_RECORD_INVALID", "Tenant kaydı doğrulanamadı.");
    }
    return tenant;
}

function assertKnownAppointmentEntitlement(result) {
    if (!result || typeof result !== "object" || result.feature !== APPOINTMENTS_FEATURE ||
        result.featureEnabled !== true) {
        throw safeError("ENTITLEMENT_DENIED", "Randevu erişimi kullanılamıyor.");
    }
    if (result.usedDefaultPlanPolicy === true) {
        throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "Tenant planı randevu erişimi için doğrulanamadı.");
    }
    return result;
}

function createAppointmentService({
    tenantRegistry,
    appointmentRepository,
    entitlementService,
    clock = () => new Date(),
    serviceIdFactory = createServiceId,
    staffIdFactory = createStaffId
}) {
    const tenants = assertTenantRegistry(tenantRegistry);
    const repository = assertRepository(appointmentRepository);
    const entitlements = assertEntitlementService(entitlementService);
    if (typeof clock !== "function" || typeof serviceIdFactory !== "function" || typeof staffIdFactory !== "function") {
        failDependency("factory/clock");
    }

    async function loadTenant(rawTenantId) {
        const tenantId = requireCanonicalTenantId(rawTenantId);
        const tenant = await tenants.getById(tenantId);
        if (!tenant) throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        return requireTenantRecord(tenant, tenantId);
    }

    function assertPublicEntitlement(tenant) {
        return assertKnownAppointmentEntitlement(entitlements.evaluate({
            tenant,
            feature: APPOINTMENTS_FEATURE
        }));
    }

    async function authorizeAdmin(context, rawTenantId) {
        if (!isPlainRecord(context)) throw new TypeError("Appointment context geçersiz.");
        const tenantId = requireCanonicalTenantId(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: APPOINTMENTS_PERMISSION });
        const tenant = await loadTenant(tenantId);
        const entitlement = entitlements.assertFeatureAccess({
            context,
            tenant,
            permission: APPOINTMENTS_PERMISSION,
            feature: APPOINTMENTS_FEATURE
        });
        assertKnownAppointmentEntitlement(entitlement);
        return { context, tenantId, tenant };
    }

    function actorId(context) {
        return requireOpaqueIdentifier(context.actorId, "actorId");
    }

    function requestId(value) {
        return requireOpaqueIdentifier(value, "requestId", { optional: true });
    }

    function timezoneForTenant(tenant) {
        return requireTimezone(tenant.profile?.timezone || "Europe/Istanbul");
    }

    async function ensureStaffServices(tenantId, serviceIds) {
        for (const serviceId of serviceIds) {
            const service = await repository.getServiceById(tenantId, serviceId);
            if (!service) throw safeError("APPOINTMENT_SERVICE_NOT_FOUND", "Hizmet bulunamadı.");
        }
    }

    async function publicResources(rawTenantId) {
        const tenant = await loadTenant(rawTenantId);
        if (tenant.status !== "active") {
            throw safeError("APPOINTMENT_NOT_AVAILABLE", "İşletme randevu almaya açık değil.");
        }
        assertPublicEntitlement(tenant);
        const [services, staff] = await Promise.all([
            repository.listServicesByTenant(tenant.tenantId),
            repository.listStaffByTenant(tenant.tenantId)
        ]);
        return {
            tenant,
            services: services.filter(item => item.active),
            staff: staff.filter(item => item.active)
        };
    }

    return Object.freeze({
        async getPublicConfig({ tenantId } = {}) {
            const resources = await publicResources(tenantId);
            const services = resources.services.map(projectPublicService);
            const activeServiceIds = new Set(services.map(item => item.serviceId));
            const staff = resources.staff
                .map(projectPublicStaff)
                .map(item => Object.freeze({
                    ...item,
                    serviceIds: Object.freeze(item.serviceIds.filter(serviceId => activeServiceIds.has(serviceId)))
                }))
                .filter(item => item.serviceIds.length > 0);
            return Object.freeze({
                tenantId: resources.tenant.tenantId,
                brandName: resources.tenant.profile?.brandName || resources.tenant.displayName,
                timezone: timezoneForTenant(resources.tenant),
                services: Object.freeze(services),
                staff: Object.freeze(staff)
            });
        },

        async getPublicSlots({ tenantId, serviceId, staffId, date } = {}) {
            const resources = await publicResources(tenantId);
            const safeServiceId = requireServiceId(serviceId);
            const safeStaffId = requireStaffId(staffId);
            const service = resources.services.find(item => item.serviceId === safeServiceId);
            const staff = resources.staff.find(item => item.staffId === safeStaffId);
            if (!service || !staff || !staff.serviceIds.includes(service.serviceId)) {
                throw safeError("APPOINTMENT_RESOURCE_UNAVAILABLE", "Hizmet veya personel kullanılamıyor.");
            }
            const timeZone = timezoneForTenant(resources.tenant);
            assertBookableDate(date, timeZone, requireClockNow(clock));
            const availability = await repository.getAvailability(resources.tenant.tenantId, staff.staffId);
            if (!availability) return Object.freeze([]);
            const appointments = await repository.listAppointmentsByTenant(resources.tenant.tenantId, { limit: 500 });
            return generateAvailableSlots({
                tenantId: resources.tenant.tenantId,
                staffId: staff.staffId,
                date,
                timeZone,
                availability,
                durationMinutes: service.durationMinutes,
                appointments,
                now: requireClockNow(clock)
            });
        },

        async createPublicAppointment({ tenantId, request, idempotencyKey, requestId: rawRequestId = null } = {}) {
            const resources = await publicResources(tenantId);
            const normalized = normalizeAppointmentRequest(request);
            const service = resources.services.find(item => item.serviceId === normalized.serviceId);
            const staff = resources.staff.find(item => item.staffId === normalized.staffId);
            if (!service || !staff || !staff.serviceIds.includes(service.serviceId)) {
                throw safeError("APPOINTMENT_RESOURCE_UNAVAILABLE", "Hizmet veya personel kullanılamıyor.");
            }
            const safeIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
            const appointmentId = createTenantBoundAppointmentId(resources.tenant.tenantId, safeIdempotencyKey);
            const requestHash = createAppointmentRequestHash(normalized);
            const existing = await repository.getAppointmentById(resources.tenant.tenantId, appointmentId);
            if (existing) {
                if (existing.requestHash !== requestHash) {
                    throw safeError("APPOINTMENT_IDEMPOTENCY_CONFLICT", "Randevu isteği önceki istekle uyuşmuyor.");
                }
                return projectCustomerAppointment(existing);
            }

            const timeZone = timezoneForTenant(resources.tenant);
            const date = localDateForIso(normalized.startAt, timeZone);
            assertBookableDate(date, timeZone, requireClockNow(clock));
            const availability = await repository.getAvailability(resources.tenant.tenantId, staff.staffId);
            if (!availability) throw safeError("APPOINTMENT_SLOT_UNAVAILABLE", "Seçilen saat müsait değil.");
            const appointments = await repository.listAppointmentsByTenant(resources.tenant.tenantId, { limit: 500 });
            const slots = generateAvailableSlots({
                tenantId: resources.tenant.tenantId,
                staffId: staff.staffId,
                date,
                timeZone,
                availability,
                durationMinutes: service.durationMinutes,
                appointments,
                now: requireClockNow(clock)
            });
            if (!slots.some(slot => slot.startAt === normalized.startAt)) {
                throw safeError("APPOINTMENT_SLOT_UNAVAILABLE", "Seçilen saat müsait değil.");
            }

            const now = requireClockNow(clock);
            const appointment = createAppointmentRecord({
                tenantId: resources.tenant.tenantId,
                appointmentId,
                requestHash,
                normalizedRequest: normalized,
                service,
                staff,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: resources.tenant.tenantId,
                action: "appointment.created",
                actorId: null,
                requestId: requestId(rawRequestId),
                metadata: { appointmentId },
                now
            });
            const committed = await repository.commitAppointmentCreate({
                appointment,
                auditEvent,
                slotLockIds: createSlotLockIds(staff.staffId, appointment.startAt, appointment.endAt)
            });
            if (!committed || !committed.appointment) {
                throw safeError("APPOINTMENT_UNAVAILABLE", "Randevu oluşturulamadı.");
            }
            return projectCustomerAppointment(committed.appointment);
        },

        async listServicesAdmin({ context, tenantId } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            return repository.listServicesByTenant(authorized.tenantId);
        },

        async createServiceAdmin({ context, tenantId, service, requestId: rawRequestId = null } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            const now = requireClockNow(clock);
            const next = createServiceRecord({
                tenantId: authorized.tenantId,
                serviceId: serviceIdFactory(),
                draft: service,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.service.created",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: { serviceId: next.serviceId },
                now
            });
            return repository.commitServiceUpsert({ nextService: next, auditEvent });
        },

        async updateServiceAdmin({ context, tenantId, serviceId, patch, requestId: rawRequestId = null } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            const safeServiceId = requireServiceId(serviceId);
            const current = await repository.getServiceById(authorized.tenantId, safeServiceId);
            if (!current) throw safeError("APPOINTMENT_SERVICE_NOT_FOUND", "Hizmet bulunamadı.");
            const now = requireClockNow(clock);
            const next = patchService(current, patch, now);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.service.updated",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: { serviceId: safeServiceId },
                now
            });
            return repository.commitServiceUpsert({ expectedService: current, nextService: next, auditEvent });
        },

        async listStaffAdmin({ context, tenantId } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            return repository.listStaffByTenant(authorized.tenantId);
        },

        async createStaffAdmin({ context, tenantId, staff, requestId: rawRequestId = null } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            await ensureStaffServices(authorized.tenantId, staff?.serviceIds || []);
            const now = requireClockNow(clock);
            const next = createStaffRecord({
                tenantId: authorized.tenantId,
                staffId: staffIdFactory(),
                draft: staff,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.staff.created",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: { staffId: next.staffId },
                now
            });
            return repository.commitStaffUpsert({ nextStaff: next, auditEvent });
        },

        async updateStaffAdmin({ context, tenantId, staffId, patch, requestId: rawRequestId = null } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            const safeStaffId = requireStaffId(staffId);
            const current = await repository.getStaffById(authorized.tenantId, safeStaffId);
            if (!current) throw safeError("APPOINTMENT_STAFF_NOT_FOUND", "Personel bulunamadı.");
            const serviceIds = patch?.serviceIds === undefined ? current.serviceIds : patch.serviceIds;
            await ensureStaffServices(authorized.tenantId, serviceIds);
            const now = requireClockNow(clock);
            const next = patchStaff(current, patch, now);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.staff.updated",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: { staffId: safeStaffId },
                now
            });
            return repository.commitStaffUpsert({ expectedStaff: current, nextStaff: next, auditEvent });
        },

        async getAvailabilityAdmin({ context, tenantId, staffId } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            const safeStaffId = requireStaffId(staffId);
            const staff = await repository.getStaffById(authorized.tenantId, safeStaffId);
            if (!staff) throw safeError("APPOINTMENT_STAFF_NOT_FOUND", "Personel bulunamadı.");
            return repository.getAvailability(authorized.tenantId, safeStaffId);
        },

        async setAvailabilityAdmin({ context, tenantId, staffId, weekly, requestId: rawRequestId = null } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            const safeStaffId = requireStaffId(staffId);
            const staff = await repository.getStaffById(authorized.tenantId, safeStaffId);
            if (!staff) throw safeError("APPOINTMENT_STAFF_NOT_FOUND", "Personel bulunamadı.");
            const expected = await repository.getAvailability(authorized.tenantId, safeStaffId);
            const now = requireClockNow(clock);
            const next = createAvailabilityRecord({
                tenantId: authorized.tenantId,
                staffId: safeStaffId,
                weekly,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.availability.updated",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: { staffId: safeStaffId },
                now
            });
            return repository.commitAvailabilityUpsert({
                expectedAvailability: expected,
                nextAvailability: next,
                auditEvent
            });
        },

        async listAppointmentsAdmin({ context, tenantId, limit = 200 } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            const records = await repository.listAppointmentsByTenant(authorized.tenantId, { limit });
            return Object.freeze(records.map(projectAdminAppointment));
        },

        async updateAppointmentStatusAdmin({
            context,
            tenantId,
            appointmentId,
            status,
            requestId: rawRequestId = null
        } = {}) {
            const authorized = await authorizeAdmin(context, tenantId);
            if (authorized.tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant değiştirilemez.");
            const safeAppointmentId = requireAppointmentId(appointmentId);
            const current = await repository.getAppointmentById(authorized.tenantId, safeAppointmentId);
            if (!current) throw safeError("APPOINTMENT_NOT_FOUND", "Randevu bulunamadı.");
            if (status === current.status) return projectAdminAppointment(current);
            const now = requireClockNow(clock);
            const next = applyAppointmentStatus(current, status, now);
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "appointment.status.updated",
                actorId: actorId(authorized.context),
                requestId: requestId(rawRequestId),
                metadata: {
                    appointmentId: safeAppointmentId,
                    fromStatus: current.status,
                    toStatus: next.status
                },
                now
            });
            await repository.commitStatusUpdate({
                expectedAppointment: current,
                nextAppointment: next,
                auditEvent,
                slotLockIds: createSlotLockIds(current.staff.staffId, current.startAt, current.endAt)
            });
            return projectAdminAppointment(next);
        }
    });
}

module.exports = {
    APPOINTMENTS_FEATURE,
    APPOINTMENTS_PERMISSION,
    createAppointmentService
};