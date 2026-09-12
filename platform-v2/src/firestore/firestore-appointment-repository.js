const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    TENANT_COLLECTIONS,
    tenantCollection,
    tenantDocument
} = require("./tenant-paths");
const {
    APPOINTMENT_STATUSES,
    normalizePersistedAppointment,
    normalizePersistedAvailability,
    normalizePersistedService,
    normalizePersistedStaff,
    requireAppointmentId,
    requireServiceId,
    requireStaffId
} = require("../appointments/appointment-model");

const AUDIT_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLOT_LOCK_PATTERN = /^slot_[0-9a-f]{40}$/;
const APPOINTMENT_AUDIT_ACTIONS = Object.freeze([
    "appointment.service.created",
    "appointment.service.updated",
    "appointment.staff.created",
    "appointment.staff.updated",
    "appointment.availability.updated",
    "appointment.created",
    "appointment.status.updated"
]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") throw new TypeError("Appointment repository tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Appointment repository tenantId geçersiz.");
    return tenantId;
}

function normalizeLimit(value = 100) {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new TypeError("Appointment repository list limit 1-500 arasında olmalı.");
    }
    return limit;
}

function ownValue(record, key) {
    const descriptor = record && typeof record === "object"
        ? Object.getOwnPropertyDescriptor(record, key)
        : null;
    return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function requireAuditEvent(event, tenantId, action, metadata) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId || requireTenantId(event.tenantId) !== tenantId ||
        typeof event.eventId !== "string" || !AUDIT_EVENT_ID_PATTERN.test(event.eventId) ||
        event.action !== action || !APPOINTMENT_AUDIT_ACTIONS.includes(action)) {
        throw new TypeError("Appointment audit event geçersiz.");
    }
    if (!event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(event.metadata))) {
        throw new TypeError("Appointment audit metadata geçersiz.");
    }
    const actualKeys = Reflect.ownKeys(event.metadata);
    const expectedKeys = Object.keys(metadata);
    if (actualKeys.length !== expectedKeys.length ||
        actualKeys.some(key => typeof key !== "string" || !expectedKeys.includes(key))) {
        throw new TypeError("Appointment audit metadata geçersiz.");
    }
    for (const [key, value] of Object.entries(metadata)) {
        if (ownValue(event.metadata, key) !== value) {
            throw new TypeError("Appointment audit metadata geçersiz.");
        }
    }
    return event;
}

function requireSlotLockIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
        throw new TypeError("Appointment slot locks geçersiz.");
    }
    const output = [];
    for (const item of value) {
        if (typeof item !== "string" || !SLOT_LOCK_PATTERN.test(item) || output.includes(item)) {
            throw new TypeError("Appointment slot locks geçersiz.");
        }
        output.push(item);
    }
    return Object.freeze(output);
}

function createFirestoreAppointmentRepository({ db }) {
    if (!db || typeof db.collection !== "function" || typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore appointment repository için db gerekli.");
    }

    function ref(tenantId, collection, documentId) {
        return db.doc(tenantDocument(tenantId, collection, documentId));
    }

    function auditRef(tenantId, eventId) {
        return ref(tenantId, TENANT_COLLECTIONS.audit, eventId);
    }

    function lockRef(tenantId, lockId) {
        return ref(tenantId, TENANT_COLLECTIONS.appointmentLocks, lockId);
    }

    async function getCollection(tenantId, collectionName) {
        const collection = db.collection(tenantCollection(tenantId, collectionName));
        if (!collection || typeof collection.get !== "function") {
            throw new TypeError("Appointment collection geçersiz.");
        }
        const snapshot = await collection.get();
        if (!snapshot || !Array.isArray(snapshot.docs)) {
            throw new TypeError("Appointment collection snapshot geçersiz.");
        }
        return snapshot.docs;
    }

    async function transactionalUpsert({
        tenantId,
        targetRef,
        eventRef,
        expected,
        next,
        auditEvent,
        normalize,
        conflictCode,
        conflictMessage
    }) {
        return db.runTransaction(async transaction => {
            if (!transaction || typeof transaction.get !== "function" ||
                typeof transaction.create !== "function" || typeof transaction.update !== "function") {
                throw new TypeError("Appointment upsert transaction geçersiz.");
            }
            const snapshot = await transaction.get(targetRef);
            const exists = snapshot && snapshot.exists === true;
            if (expected === null) {
                if (exists) throw safeError(conflictCode, conflictMessage);
                transaction.create(targetRef, { ...next });
            } else {
                if (!exists || typeof snapshot.data !== "function") {
                    throw safeError(conflictCode, conflictMessage);
                }
                const persisted = normalize(snapshot.data());
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw safeError(conflictCode, conflictMessage);
                }
                transaction.update(targetRef, { ...next });
            }
            transaction.create(eventRef, { ...auditEvent });
            return next;
        });
    }

    return Object.freeze({
        async listServicesByTenant(rawTenantId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const docs = await getCollection(tenantId, TENANT_COLLECTIONS.appointmentServices);
            return Object.freeze(docs.map(document => {
                if (!document || typeof document.id !== "string" || typeof document.data !== "function") {
                    throw new TypeError("Appointment service document geçersiz.");
                }
                return normalizePersistedService({
                    tenantId,
                    serviceId: requireServiceId(document.id),
                    data: document.data()
                });
            }).sort((a, b) => a.name.localeCompare(b.name, "tr")));
        },

        async getServiceById(rawTenantId, rawServiceId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const serviceId = requireServiceId(rawServiceId);
            const snapshot = await ref(tenantId, TENANT_COLLECTIONS.appointmentServices, serviceId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (typeof snapshot.data !== "function") throw new TypeError("Appointment service document geçersiz.");
            return normalizePersistedService({ tenantId, serviceId, data: snapshot.data() });
        },

        async commitServiceUpsert({ expectedService = null, nextService, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(nextService?.tenantId);
            const next = normalizePersistedService({
                tenantId,
                serviceId: nextService?.serviceId,
                data: nextService
            });
            const expected = expectedService === null ? null : normalizePersistedService({
                tenantId,
                serviceId: expectedService?.serviceId,
                data: expectedService
            });
            if (expected && expected.serviceId !== next.serviceId) throw new TypeError("Appointment service identity değiştirilemez.");
            const action = expected ? "appointment.service.updated" : "appointment.service.created";
            const audit = requireAuditEvent(auditEvent, tenantId, action, { serviceId: next.serviceId });
            return transactionalUpsert({
                tenantId,
                targetRef: ref(tenantId, TENANT_COLLECTIONS.appointmentServices, next.serviceId),
                eventRef: auditRef(tenantId, audit.eventId),
                expected,
                next,
                auditEvent: audit,
                normalize: data => normalizePersistedService({ tenantId, serviceId: next.serviceId, data }),
                conflictCode: "APPOINTMENT_SERVICE_STATE_CHANGED",
                conflictMessage: "Hizmet kaydı değişti; işlem yeniden değerlendirilmelidir."
            });
        },

        async listStaffByTenant(rawTenantId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const docs = await getCollection(tenantId, TENANT_COLLECTIONS.appointmentStaff);
            return Object.freeze(docs.map(document => {
                if (!document || typeof document.id !== "string" || typeof document.data !== "function") {
                    throw new TypeError("Appointment staff document geçersiz.");
                }
                return normalizePersistedStaff({
                    tenantId,
                    staffId: requireStaffId(document.id),
                    data: document.data()
                });
            }).sort((a, b) => a.name.localeCompare(b.name, "tr")));
        },

        async getStaffById(rawTenantId, rawStaffId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const staffId = requireStaffId(rawStaffId);
            const snapshot = await ref(tenantId, TENANT_COLLECTIONS.appointmentStaff, staffId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (typeof snapshot.data !== "function") throw new TypeError("Appointment staff document geçersiz.");
            return normalizePersistedStaff({ tenantId, staffId, data: snapshot.data() });
        },

        async commitStaffUpsert({ expectedStaff = null, nextStaff, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(nextStaff?.tenantId);
            const next = normalizePersistedStaff({
                tenantId,
                staffId: nextStaff?.staffId,
                data: nextStaff
            });
            const expected = expectedStaff === null ? null : normalizePersistedStaff({
                tenantId,
                staffId: expectedStaff?.staffId,
                data: expectedStaff
            });
            if (expected && expected.staffId !== next.staffId) throw new TypeError("Appointment staff identity değiştirilemez.");
            const action = expected ? "appointment.staff.updated" : "appointment.staff.created";
            const audit = requireAuditEvent(auditEvent, tenantId, action, { staffId: next.staffId });
            return transactionalUpsert({
                tenantId,
                targetRef: ref(tenantId, TENANT_COLLECTIONS.appointmentStaff, next.staffId),
                eventRef: auditRef(tenantId, audit.eventId),
                expected,
                next,
                auditEvent: audit,
                normalize: data => normalizePersistedStaff({ tenantId, staffId: next.staffId, data }),
                conflictCode: "APPOINTMENT_STAFF_STATE_CHANGED",
                conflictMessage: "Personel kaydı değişti; işlem yeniden değerlendirilmelidir."
            });
        },

        async getAvailability(rawTenantId, rawStaffId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const staffId = requireStaffId(rawStaffId);
            const snapshot = await ref(
                tenantId,
                TENANT_COLLECTIONS.appointmentAvailability,
                staffId
            ).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (typeof snapshot.data !== "function") throw new TypeError("Appointment availability document geçersiz.");
            return normalizePersistedAvailability({ tenantId, staffId, data: snapshot.data() });
        },

        async commitAvailabilityUpsert({ expectedAvailability = null, nextAvailability, auditEvent } = {}) {
            const tenantId = requireCanonicalTenantId(nextAvailability?.tenantId);
            const next = normalizePersistedAvailability({
                tenantId,
                staffId: nextAvailability?.staffId,
                data: nextAvailability
            });
            const expected = expectedAvailability === null ? null : normalizePersistedAvailability({
                tenantId,
                staffId: expectedAvailability?.staffId,
                data: expectedAvailability
            });
            if (expected && expected.staffId !== next.staffId) throw new TypeError("Appointment availability identity değiştirilemez.");
            const audit = requireAuditEvent(
                auditEvent,
                tenantId,
                "appointment.availability.updated",
                { staffId: next.staffId }
            );
            return transactionalUpsert({
                tenantId,
                targetRef: ref(tenantId, TENANT_COLLECTIONS.appointmentAvailability, next.staffId),
                eventRef: auditRef(tenantId, audit.eventId),
                expected,
                next,
                auditEvent: audit,
                normalize: data => normalizePersistedAvailability({ tenantId, staffId: next.staffId, data }),
                conflictCode: "APPOINTMENT_AVAILABILITY_STATE_CHANGED",
                conflictMessage: "Müsaitlik kaydı değişti; işlem yeniden değerlendirilmelidir."
            });
        },

        async listAppointmentsByTenant(rawTenantId, { limit = 200 } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const safeLimit = normalizeLimit(limit);
            const collection = db.collection(tenantCollection(tenantId, TENANT_COLLECTIONS.appointments));
            if (!collection || typeof collection.orderBy !== "function") throw new TypeError("Appointment collection geçersiz.");
            const ordered = collection.orderBy("createdAt", "desc");
            if (!ordered || typeof ordered.limit !== "function") throw new TypeError("Appointment query geçersiz.");
            const limited = ordered.limit(safeLimit);
            if (!limited || typeof limited.get !== "function") throw new TypeError("Appointment query geçersiz.");
            const snapshot = await limited.get();
            if (!snapshot || !Array.isArray(snapshot.docs)) throw new TypeError("Appointment snapshot geçersiz.");
            return Object.freeze(snapshot.docs.map(document => {
                if (!document || typeof document.id !== "string" || typeof document.data !== "function") {
                    throw new TypeError("Appointment document geçersiz.");
                }
                return normalizePersistedAppointment({
                    tenantId,
                    appointmentId: requireAppointmentId(document.id),
                    data: document.data()
                });
            }));
        },

        async getAppointmentById(rawTenantId, rawAppointmentId) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const appointmentId = requireAppointmentId(rawAppointmentId);
            const snapshot = await ref(tenantId, TENANT_COLLECTIONS.appointments, appointmentId).get();
            if (!snapshot || snapshot.exists !== true) return null;
            if (typeof snapshot.data !== "function") throw new TypeError("Appointment document geçersiz.");
            return normalizePersistedAppointment({ tenantId, appointmentId, data: snapshot.data() });
        },

        async commitAppointmentCreate({ appointment, auditEvent, slotLockIds } = {}) {
            const tenantId = requireCanonicalTenantId(appointment?.tenantId);
            const safeAppointment = normalizePersistedAppointment({
                tenantId,
                appointmentId: appointment?.appointmentId,
                data: appointment
            });
            const lockIds = requireSlotLockIds(slotLockIds);
            const audit = requireAuditEvent(
                auditEvent,
                tenantId,
                "appointment.created",
                { appointmentId: safeAppointment.appointmentId }
            );
            const targetRef = ref(tenantId, TENANT_COLLECTIONS.appointments, safeAppointment.appointmentId);
            const eventRef = auditRef(tenantId, audit.eventId);
            const lockRefs = lockIds.map(lockId => lockRef(tenantId, lockId));

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function") {
                    throw new TypeError("Appointment create transaction geçersiz.");
                }
                const existingSnapshot = await transaction.get(targetRef);
                if (existingSnapshot && existingSnapshot.exists === true) {
                    if (typeof existingSnapshot.data !== "function") throw new TypeError("Appointment document geçersiz.");
                    const existing = normalizePersistedAppointment({
                        tenantId,
                        appointmentId: safeAppointment.appointmentId,
                        data: existingSnapshot.data()
                    });
                    if (existing.requestHash !== safeAppointment.requestHash) {
                        throw safeError("APPOINTMENT_IDEMPOTENCY_CONFLICT", "Randevu isteği önceki istekle uyuşmuyor.");
                    }
                    return Object.freeze({ created: false, appointment: existing });
                }
                for (const item of lockRefs) {
                    const snapshot = await transaction.get(item);
                    if (snapshot && snapshot.exists === true) {
                        throw safeError("APPOINTMENT_SLOT_TAKEN", "Seçilen saat artık müsait değil.");
                    }
                }
                transaction.create(targetRef, { ...safeAppointment });
                for (let index = 0; index < lockRefs.length; index += 1) {
                    transaction.create(lockRefs[index], {
                        tenantId,
                        appointmentId: safeAppointment.appointmentId,
                        staffId: safeAppointment.staff.staffId,
                        startAt: safeAppointment.startAt,
                        endAt: safeAppointment.endAt,
                        slotIndex: index
                    });
                }
                transaction.create(eventRef, { ...audit });
                return Object.freeze({ created: true, appointment: safeAppointment });
            });
        },

        async commitStatusUpdate({ expectedAppointment, nextAppointment, auditEvent, slotLockIds } = {}) {
            const tenantId = requireCanonicalTenantId(expectedAppointment?.tenantId);
            const expected = normalizePersistedAppointment({
                tenantId,
                appointmentId: expectedAppointment?.appointmentId,
                data: expectedAppointment
            });
            const next = normalizePersistedAppointment({
                tenantId,
                appointmentId: nextAppointment?.appointmentId,
                data: nextAppointment
            });
            if (expected.appointmentId !== next.appointmentId || expected.requestHash !== next.requestHash ||
                expected.createdAt !== next.createdAt || expected.startAt !== next.startAt || expected.endAt !== next.endAt) {
                throw new TypeError("Appointment immutable alanları değiştirilemez.");
            }
            const audit = requireAuditEvent(
                auditEvent,
                tenantId,
                "appointment.status.updated",
                {
                    appointmentId: expected.appointmentId,
                    fromStatus: expected.status,
                    toStatus: next.status
                }
            );
            if (!APPOINTMENT_STATUSES.includes(expected.status) || !APPOINTMENT_STATUSES.includes(next.status) ||
                expected.status === next.status) {
                throw new TypeError("Appointment status audit geçersiz.");
            }
            const lockIds = requireSlotLockIds(slotLockIds);
            const targetRef = ref(tenantId, TENANT_COLLECTIONS.appointments, expected.appointmentId);
            const eventRef = auditRef(tenantId, audit.eventId);

            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" || typeof transaction.create !== "function" ||
                    typeof transaction.delete !== "function") {
                    throw new TypeError("Appointment update transaction geçersiz.");
                }
                const snapshot = await transaction.get(targetRef);
                if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== "function") {
                    throw safeError("APPOINTMENT_STATE_CHANGED", "Randevu durumu değişti; işlem yeniden değerlendirilmelidir.");
                }
                const persisted = normalizePersistedAppointment({
                    tenantId,
                    appointmentId: expected.appointmentId,
                    data: snapshot.data()
                });
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw safeError("APPOINTMENT_STATE_CHANGED", "Randevu durumu değişti; işlem yeniden değerlendirilmelidir.");
                }
                transaction.update(targetRef, { ...next });
                if (next.status === "cancelled") {
                    for (const lockId of lockIds) transaction.delete(lockRef(tenantId, lockId));
                }
                transaction.create(eventRef, { ...audit });
                return next;
            });
        }
    });
}

module.exports = {
    APPOINTMENT_AUDIT_ACTIONS,
    createFirestoreAppointmentRepository,
    normalizeLimit,
    requireSlotLockIds
};