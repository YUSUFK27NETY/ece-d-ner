const { isDeepStrictEqual } = require("node:util");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    CONTACT_STATUSES,
    REQUEST_STATUSES,
    TASK_STATUSES,
    normalizeStored,
    requireContactId,
    requireRequestId,
    requireTaskId
} = require("../crm/crm-model");
const { TENANT_COLLECTIONS, tenantCollection, tenantDocument } = require("./tenant-paths");

const AUDIT_ID = /^[0-9a-f-]{36}$/i;
const KINDS = Object.freeze({
    contact: Object.freeze({ collection: "crmContacts", statuses: CONTACT_STATUSES, id: requireContactId }),
    request: Object.freeze({ collection: "crmRequests", statuses: REQUEST_STATUSES, id: requireRequestId }),
    task: Object.freeze({ collection: "crmTasks", statuses: TASK_STATUSES, id: requireTaskId })
});

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function canonicalTenant(value) {
    if (typeof value !== "string") throw new TypeError("CRM repository tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("CRM repository tenantId geçersiz.");
    return tenantId;
}

function kindConfig(kind) {
    const config = KINDS[kind];
    if (!config) throw new TypeError("CRM repository kayıt türü geçersiz.");
    return config;
}

function normalizeLimit(value, fallback = 100) {
    if (value === undefined || value === null || value === "") return fallback;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError("CRM limit geçersiz.");
    return limit;
}

function normalizeStatus(value, kind) {
    if (value === undefined || value === null || value === "") return null;
    const status = String(value).trim();
    if (!kindConfig(kind).statuses.includes(status)) throw new TypeError("CRM status filtresi geçersiz.");
    return status;
}

function requireAudit(event, tenantId, kind, action, entityId) {
    const expectedAction = `crm.${kind}.${action}`;
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId || event.action !== expectedAction ||
        typeof event.eventId !== "string" || !AUDIT_ID.test(event.eventId) ||
        event.metadata?.entityType !== kind || event.metadata?.entityId !== entityId) {
        throw new TypeError("CRM audit event geçersiz.");
    }
    return event;
}

function createFirestoreCrmRepository({ db }) {
    if (!db || typeof db.collection !== "function" || typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        throw new TypeError("Firestore CRM repository için db gerekli.");
    }

    function recordRef(tenantId, kind, entityId) {
        const config = kindConfig(kind);
        return db.doc(tenantDocument(tenantId, TENANT_COLLECTIONS[config.collection], config.id(entityId)));
    }

    function auditRef(tenantId, eventId) {
        return db.doc(`${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${eventId}`);
    }

    async function list(rawTenantId, kind, { status = null, limit = 100 } = {}) {
        const tenantId = canonicalTenant(rawTenantId);
        const config = kindConfig(kind);
        const safeStatus = normalizeStatus(status, kind);
        const safeLimit = normalizeLimit(limit);
        const snapshot = await db.collection(tenantCollection(tenantId, TENANT_COLLECTIONS[config.collection])).get();
        if (!snapshot || !Array.isArray(snapshot.docs)) throw new TypeError("CRM snapshot geçersiz.");
        return snapshot.docs
            .map(doc => normalizeStored({
                tenantId,
                kind,
                entityId: config.id(doc.id),
                data: doc.data()
            }))
            .filter(record => safeStatus === null || record.status === safeStatus)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, safeLimit);
    }

    async function get(rawTenantId, kind, rawEntityId) {
        const tenantId = canonicalTenant(rawTenantId);
        const config = kindConfig(kind);
        const entityId = config.id(rawEntityId);
        const snapshot = await recordRef(tenantId, kind, entityId).get();
        if (!snapshot || snapshot.exists !== true) return null;
        return normalizeStored({ tenantId, kind, entityId, data: snapshot.data() });
    }

    async function all(rawTenantId, kind) {
        const tenantId = canonicalTenant(rawTenantId);
        const config = kindConfig(kind);
        const snapshot = await db.collection(tenantCollection(tenantId, TENANT_COLLECTIONS[config.collection])).get();
        if (!snapshot || !Array.isArray(snapshot.docs)) throw new TypeError("CRM snapshot geçersiz.");
        return snapshot.docs.map(doc => normalizeStored({
            tenantId,
            kind,
            entityId: config.id(doc.id),
            data: doc.data()
        }));
    }

    return Object.freeze({
        listContacts: (tenantId, options) => list(tenantId, "contact", options),
        getContact: (tenantId, contactId) => get(tenantId, "contact", contactId),
        listRequests: (tenantId, options) => list(tenantId, "request", options),
        getRequest: (tenantId, requestId) => get(tenantId, "request", requestId),
        listTasks: (tenantId, options) => list(tenantId, "task", options),
        getTask: (tenantId, taskId) => get(tenantId, "task", taskId),

        async loadReportData(rawTenantId) {
            const tenantId = canonicalTenant(rawTenantId);
            const [contacts, requests, tasks] = await Promise.all([
                all(tenantId, "contact"), all(tenantId, "request"), all(tenantId, "task")
            ]);
            return Object.freeze({ contacts, requests, tasks });
        },

        async commitCreate({ kind, record, auditEvent } = {}) {
            const config = kindConfig(kind);
            const tenantId = canonicalTenant(record?.tenantId);
            const entityId = config.id(record?.[`${kind}Id`]);
            const safeRecord = normalizeStored({ tenantId, kind, entityId, data: record });
            const audit = requireAudit(auditEvent, tenantId, kind, "created", entityId);
            const target = recordRef(tenantId, kind, entityId);
            const event = auditRef(tenantId, audit.eventId);
            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" || typeof transaction.create !== "function") {
                    throw new TypeError("CRM create transaction geçersiz.");
                }
                const snapshot = await transaction.get(target);
                if (snapshot?.exists === true) throw safeError("CRM_ID_CONFLICT", "CRM kayıt kimliği çakıştı.");
                transaction.create(target, { ...safeRecord });
                transaction.create(event, { ...audit });
                return safeRecord;
            });
        },

        async commitUpdate({ kind, expectedRecord, nextRecord, auditEvent } = {}) {
            const config = kindConfig(kind);
            const tenantId = canonicalTenant(expectedRecord?.tenantId);
            const entityId = config.id(expectedRecord?.[`${kind}Id`]);
            const expected = normalizeStored({ tenantId, kind, entityId, data: expectedRecord });
            const next = normalizeStored({ tenantId, kind, entityId: nextRecord?.[`${kind}Id`], data: nextRecord });
            if (next.tenantId !== tenantId || next[`${kind}Id`] !== entityId || next.createdAt !== expected.createdAt) {
                throw new TypeError("CRM immutable alanları değiştirilemez.");
            }
            const audit = requireAudit(auditEvent, tenantId, kind, "updated", entityId);
            const target = recordRef(tenantId, kind, entityId);
            const event = auditRef(tenantId, audit.eventId);
            return db.runTransaction(async transaction => {
                if (!transaction || typeof transaction.get !== "function" ||
                    typeof transaction.update !== "function" || typeof transaction.create !== "function") {
                    throw new TypeError("CRM update transaction geçersiz.");
                }
                const snapshot = await transaction.get(target);
                if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== "function") {
                    throw safeError("CRM_STATE_CHANGED", "CRM kaydı değişti; işlem yeniden değerlendirilmelidir.");
                }
                const persisted = normalizeStored({ tenantId, kind, entityId, data: snapshot.data() });
                if (!isDeepStrictEqual(persisted, expected)) {
                    throw safeError("CRM_STATE_CHANGED", "CRM kaydı değişti; işlem yeniden değerlendirilmelidir.");
                }
                transaction.update(target, { ...next });
                transaction.create(event, { ...audit });
                return next;
            });
        }
    });
}

module.exports = {
    createFirestoreCrmRepository,
    normalizeLimit,
    normalizeStatus
};
