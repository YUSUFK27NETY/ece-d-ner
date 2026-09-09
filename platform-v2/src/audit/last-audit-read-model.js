const { requireTenantId } = require("../tenant/tenant-id");

const LAST_AUDIT_STATUSES = Object.freeze([
    "available",
    "none",
    "unavailable"
]);
const issuedLastAuditModels = new WeakSet();

function fail(label) {
    throw new TypeError(`Last audit ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readOwn(record, key) {
    if (!record || typeof record !== "object") {
        return Object.freeze({ exists: false, safe: false, value: undefined });
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return Object.freeze({ exists: false, safe: true, value: undefined });
    }

    return Object.hasOwn(descriptor, "value")
        ? Object.freeze({ exists: true, safe: true, value: descriptor.value })
        : Object.freeze({ exists: true, safe: false, value: undefined });
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        fail("tenantId");
    }

    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail("tenantId");
    }

    return tenantId;
}

function canonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 &&
        new Date(timestamp).toISOString() === value
        ? value
        : null;
}

function issue({ tenantId, status, action, createdAt }) {
    const model = Object.freeze({
        tenantId,
        status,
        action,
        createdAt
    });
    issuedLastAuditModels.add(model);
    return model;
}

function unavailable(tenantId) {
    return issue({
        tenantId,
        status: "unavailable",
        action: null,
        createdAt: null
    });
}

function projectEvent(event, tenantId) {
    if (!isPlainRecord(event)) {
        fail("event");
    }

    const eventTenantId = readOwn(event, "tenantId");
    const action = readOwn(event, "action");
    const createdAt = readOwn(event, "createdAt");
    if (!eventTenantId.exists || !eventTenantId.safe ||
        !action.exists || !action.safe ||
        !createdAt.exists || !createdAt.safe ||
        requireCanonicalTenantId(eventTenantId.value) !== tenantId ||
        typeof action.value !== "string" ||
        !/^[a-z0-9_.-]{3,120}$/i.test(action.value)) {
        fail("event");
    }

    const timestamp = canonicalTimestamp(createdAt.value);
    if (!timestamp) {
        fail("event timestamp");
    }

    return issue({
        tenantId,
        status: "available",
        action: action.value,
        createdAt: timestamp
    });
}

function normalizeReader(auditReader) {
    if (!isPlainRecord(auditReader)) {
        return null;
    }

    const getLatest = readOwn(auditReader, "getLatest");
    if (!getLatest.exists || !getLatest.safe ||
        typeof getLatest.value !== "function") {
        return null;
    }

    return getLatest.value.bind(auditReader);
}

function createLastAuditReadModel({ auditReader = null } = {}) {
    const getLatest = normalizeReader(auditReader);

    return Object.freeze({
        async get(input) {
            if (!isPlainRecord(input) || Reflect.ownKeys(input).length !== 1) {
                fail("request");
            }

            const tenantIdField = readOwn(input, "tenantId");
            if (!tenantIdField.exists || !tenantIdField.safe) {
                fail("request");
            }
            const tenantId = requireCanonicalTenantId(tenantIdField.value);

            if (!getLatest) {
                return unavailable(tenantId);
            }

            try {
                const event = await getLatest(Object.freeze({ tenantId }));
                if (event === null) {
                    return issue({
                        tenantId,
                        status: "none",
                        action: null,
                        createdAt: null
                    });
                }
                return projectEvent(event, tenantId);
            } catch {
                return unavailable(tenantId);
            }
        }
    });
}

function assertLastAuditReadModel(model) {
    if (!model || typeof model !== "object" ||
        !issuedLastAuditModels.has(model) ||
        !LAST_AUDIT_STATUSES.includes(model.status)) {
        fail("read model");
    }
    return model;
}

module.exports = {
    LAST_AUDIT_STATUSES,
    assertLastAuditReadModel,
    createLastAuditReadModel
};
