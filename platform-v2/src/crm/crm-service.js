const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    createRecord,
    normalizeContactInput,
    normalizeRequestInput,
    normalizeTaskInput,
    normalizeStored,
    project,
    requireContactId,
    requireRequestId,
    requireTaskId
} = require("./crm-model");

const CRM_FEATURE = "crm";
const CRM_PERMISSION = "settings.manage";

const REQUEST_TRANSITIONS = Object.freeze({
    new: Object.freeze(["new", "in_progress", "converted", "closed"]),
    in_progress: Object.freeze(["in_progress", "converted", "closed"]),
    converted: Object.freeze(["converted"]),
    closed: Object.freeze(["closed"])
});

const TASK_TRANSITIONS = Object.freeze({
    open: Object.freeze(["open", "done", "cancelled"]),
    done: Object.freeze(["done"]),
    cancelled: Object.freeze(["cancelled"])
});

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function canonicalTenant(value) {
    if (typeof value !== "string") throw new TypeError("CRM tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("CRM tenantId geçersiz.");
    return tenantId;
}

function nowFrom(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("CRM clock geçersiz.");
    return now;
}

function requireActor(context) {
    if (typeof context?.actorId !== "string" || !context.actorId.trim()) {
        throw new TypeError("CRM actorId geçersiz.");
    }
    return context.actorId;
}

function assertTransition(table, from, to, code) {
    if (!table[from]?.includes(to)) throw safeError(code, "CRM durum geçişi geçersiz.");
}

function createCrmService({ tenantRegistry, repository, entitlementService, clock = () => new Date() }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") throw new TypeError("CRM tenant registry geçersiz.");
    if (!repository || typeof repository.listContacts !== "function" || typeof repository.getContact !== "function" ||
        typeof repository.listRequests !== "function" || typeof repository.getRequest !== "function" ||
        typeof repository.listTasks !== "function" || typeof repository.getTask !== "function" ||
        typeof repository.loadReportData !== "function" || typeof repository.commitCreate !== "function" ||
        typeof repository.commitUpdate !== "function") {
        throw new TypeError("CRM repository geçersiz.");
    }
    if (!entitlementService || typeof entitlementService.assertFeatureAccess !== "function") {
        throw new TypeError("CRM entitlement service geçersiz.");
    }
    if (typeof clock !== "function") throw new TypeError("CRM clock geçersiz.");

    async function loadTenant(tenantId) {
        const tenant = await tenantRegistry.getById(tenantId);
        if (!tenant || tenant.tenantId !== tenantId || requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        }
        return tenant;
    }

    async function authorize(context, rawTenantId) {
        if (!isPlainRecord(context)) throw new TypeError("CRM context geçersiz.");
        const tenantId = canonicalTenant(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: CRM_PERMISSION });
        const tenant = await loadTenant(tenantId);
        const result = entitlementService.assertFeatureAccess({
            context,
            tenant,
            permission: CRM_PERMISSION,
            feature: CRM_FEATURE
        });
        if (!result || result.feature !== CRM_FEATURE || result.featureEnabled !== true || result.usedDefaultPlanPolicy === true) {
            throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "CRM modülü erişimi doğrulanamadı.");
        }
        return { context, tenantId, tenant };
    }

    function assertMutable(tenant) {
        if (tenant.status === "archived") throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant CRM değiştiremez.");
    }

    function audit({ tenantId, context, kind, action, entityId, metadata = {}, requestId = null, now }) {
        return createAuditEvent({
            tenantId,
            action: `crm.${kind}.${action}`,
            actorId: requireActor(context),
            requestId,
            metadata: {
                entityType: kind,
                entityId,
                ...metadata
            },
            now
        });
    }

    async function ensureContact(tenantId, contactId) {
        const safeId = requireContactId(contactId);
        const contact = await repository.getContact(tenantId, safeId);
        if (!contact) throw safeError("CRM_CONTACT_NOT_FOUND", "CRM müşterisi bulunamadı.");
        return contact;
    }

    async function ensureRelation(tenantId, type, relatedId) {
        if (type === null || type === undefined) return;
        if (type === "contact") {
            await ensureContact(tenantId, relatedId);
            return;
        }
        if (type === "request") {
            const safeId = requireRequestId(relatedId);
            const request = await repository.getRequest(tenantId, safeId);
            if (!request) throw safeError("CRM_REQUEST_NOT_FOUND", "CRM talebi bulunamadı.");
            return;
        }
        throw new TypeError("CRM görev ilişkisi geçersiz.");
    }

    return Object.freeze({
        async listContacts({ context, tenantId, status = null, limit = 100 } = {}) {
            const authorized = await authorize(context, tenantId);
            return Object.freeze((await repository.listContacts(authorized.tenantId, { status, limit })).map(project));
        },

        async createContact({ context, tenantId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const now = nowFrom(clock);
            const record = createRecord({ tenantId: authorized.tenantId, kind: "contact", input, now });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "contact",
                action: "created",
                entityId: record.contactId,
                metadata: { status: record.status },
                requestId,
                now
            });
            return project(await repository.commitCreate({ kind: "contact", record, auditEvent: event }));
        },

        async updateContact({ context, tenantId, contactId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const safeId = requireContactId(contactId);
            const current = await repository.getContact(authorized.tenantId, safeId);
            if (!current) throw safeError("CRM_CONTACT_NOT_FOUND", "CRM müşterisi bulunamadı.");
            const patch = normalizeContactInput(input, { partial: true });
            const now = nowFrom(clock);
            const next = normalizeStored({
                tenantId: authorized.tenantId,
                kind: "contact",
                entityId: safeId,
                data: { ...current, ...patch, updatedAt: now.toISOString() }
            });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "contact",
                action: "updated",
                entityId: safeId,
                metadata: { fromStatus: current.status, toStatus: next.status },
                requestId,
                now
            });
            return project(await repository.commitUpdate({ kind: "contact", expectedRecord: current, nextRecord: next, auditEvent: event }));
        },

        async listRequests({ context, tenantId, status = null, limit = 100 } = {}) {
            const authorized = await authorize(context, tenantId);
            return Object.freeze((await repository.listRequests(authorized.tenantId, { status, limit })).map(project));
        },

        async createRequest({ context, tenantId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const normalized = normalizeRequestInput(input);
            await ensureContact(authorized.tenantId, normalized.contactId);
            const now = nowFrom(clock);
            const record = createRecord({ tenantId: authorized.tenantId, kind: "request", input: normalized, now });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "request",
                action: "created",
                entityId: record.requestId,
                metadata: { status: record.status, source: record.source, hasValue: record.valueMinor !== null },
                requestId,
                now
            });
            return project(await repository.commitCreate({ kind: "request", record, auditEvent: event }));
        },

        async updateRequest({ context, tenantId, crmRequestId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const safeId = requireRequestId(crmRequestId);
            const current = await repository.getRequest(authorized.tenantId, safeId);
            if (!current) throw safeError("CRM_REQUEST_NOT_FOUND", "CRM talebi bulunamadı.");
            const patch = normalizeRequestInput(input, { partial: true });
            if (patch.contactId !== undefined) await ensureContact(authorized.tenantId, patch.contactId);
            const nextStatus = patch.status ?? current.status;
            assertTransition(REQUEST_TRANSITIONS, current.status, nextStatus, "CRM_REQUEST_STATUS_TRANSITION_INVALID");
            const now = nowFrom(clock);
            const next = normalizeStored({
                tenantId: authorized.tenantId,
                kind: "request",
                entityId: safeId,
                data: { ...current, ...patch, status: nextStatus, updatedAt: now.toISOString() }
            });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "request",
                action: "updated",
                entityId: safeId,
                metadata: { fromStatus: current.status, toStatus: next.status, source: next.source, hasValue: next.valueMinor !== null },
                requestId,
                now
            });
            return project(await repository.commitUpdate({ kind: "request", expectedRecord: current, nextRecord: next, auditEvent: event }));
        },

        async listTasks({ context, tenantId, status = null, limit = 100 } = {}) {
            const authorized = await authorize(context, tenantId);
            return Object.freeze((await repository.listTasks(authorized.tenantId, { status, limit })).map(project));
        },

        async createTask({ context, tenantId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const normalized = normalizeTaskInput(input);
            await ensureRelation(authorized.tenantId, normalized.relatedType, normalized.relatedId);
            const now = nowFrom(clock);
            const record = createRecord({ tenantId: authorized.tenantId, kind: "task", input: normalized, now });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "task",
                action: "created",
                entityId: record.taskId,
                metadata: { status: record.status, priority: record.priority, relatedType: record.relatedType },
                requestId,
                now
            });
            return project(await repository.commitCreate({ kind: "task", record, auditEvent: event }));
        },

        async updateTask({ context, tenantId, taskId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            assertMutable(authorized.tenant);
            const safeId = requireTaskId(taskId);
            const current = await repository.getTask(authorized.tenantId, safeId);
            if (!current) throw safeError("CRM_TASK_NOT_FOUND", "CRM görevi bulunamadı.");
            const patch = normalizeTaskInput(input, { partial: true });
            const relatedType = patch.relatedType !== undefined ? patch.relatedType : current.relatedType;
            const relatedId = patch.relatedId !== undefined ? patch.relatedId : current.relatedId;
            await ensureRelation(authorized.tenantId, relatedType, relatedId);
            const nextStatus = patch.status ?? current.status;
            assertTransition(TASK_TRANSITIONS, current.status, nextStatus, "CRM_TASK_STATUS_TRANSITION_INVALID");
            const now = nowFrom(clock);
            const next = normalizeStored({
                tenantId: authorized.tenantId,
                kind: "task",
                entityId: safeId,
                data: {
                    ...current,
                    ...patch,
                    status: nextStatus,
                    relatedType,
                    relatedId,
                    completedAt: nextStatus === "done" ? (current.completedAt || now.toISOString()) : null,
                    updatedAt: now.toISOString()
                }
            });
            const event = audit({
                tenantId: authorized.tenantId,
                context: authorized.context,
                kind: "task",
                action: "updated",
                entityId: safeId,
                metadata: { fromStatus: current.status, toStatus: next.status, priority: next.priority, relatedType: next.relatedType },
                requestId,
                now
            });
            return project(await repository.commitUpdate({ kind: "task", expectedRecord: current, nextRecord: next, auditEvent: event }));
        },

        async report({ context, tenantId } = {}) {
            const authorized = await authorize(context, tenantId);
            const data = await repository.loadReportData(authorized.tenantId);
            if (!data || !Array.isArray(data.contacts) || !Array.isArray(data.requests) || !Array.isArray(data.tasks)) {
                throw safeError("CRM_UNAVAILABLE", "CRM raporu alınamadı.");
            }
            const now = nowFrom(clock);
            const requestCounts = { new: 0, in_progress: 0, converted: 0, closed: 0 };
            const sourceCounts = {};
            const pipelineValueByCurrency = {};
            for (const request of data.requests) {
                requestCounts[request.status] = (requestCounts[request.status] || 0) + 1;
                sourceCounts[request.source] = (sourceCounts[request.source] || 0) + 1;
                if (["new", "in_progress"].includes(request.status) && request.valueMinor !== null && request.currency) {
                    pipelineValueByCurrency[request.currency] = (pipelineValueByCurrency[request.currency] || 0) + request.valueMinor;
                }
            }
            const taskCounts = { open: 0, done: 0, cancelled: 0 };
            let overdueTasks = 0;
            for (const task of data.tasks) {
                taskCounts[task.status] = (taskCounts[task.status] || 0) + 1;
                if (task.status === "open" && task.dueAt && task.dueAt < now.toISOString()) overdueTasks += 1;
            }
            const converted = requestCounts.converted || 0;
            const totalRequests = data.requests.length;
            return Object.freeze({
                generatedAt: now.toISOString(),
                contacts: Object.freeze({
                    total: data.contacts.length,
                    active: data.contacts.filter(item => item.status === "active").length
                }),
                requests: Object.freeze({
                    total: totalRequests,
                    byStatus: Object.freeze(requestCounts),
                    conversionRate: totalRequests === 0 ? 0 : Number((converted / totalRequests).toFixed(4)),
                    bySource: Object.freeze(sourceCounts),
                    pipelineValueByCurrency: Object.freeze(pipelineValueByCurrency)
                }),
                tasks: Object.freeze({
                    total: data.tasks.length,
                    byStatus: Object.freeze(taskCounts),
                    overdue: overdueTasks
                })
            });
        }
    });
}

module.exports = {
    CRM_FEATURE,
    CRM_PERMISSION,
    REQUEST_TRANSITIONS,
    TASK_TRANSITIONS,
    createCrmService
};
