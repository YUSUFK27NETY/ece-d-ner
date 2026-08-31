const crypto = require("node:crypto");
const { requireTenantId } = require("../tenant/tenant-id");

function createAuditEvent({
    tenantId,
    action,
    actorId = null,
    metadata = {},
    requestId = null,
    now = new Date()
}) {
    const normalizedAction = String(action ?? "").trim();

    if (!/^[a-z0-9_.-]{3,120}$/i.test(normalizedAction)) {
        throw new TypeError("Geçersiz audit action.");
    }

    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new TypeError("Audit metadata nesne olmalı.");
    }

    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Geçerli audit tarihi gerekli.");
    }

    return Object.freeze({
        eventId: crypto.randomUUID(),
        tenantId: requireTenantId(tenantId),
        action: normalizedAction,
        actorId: actorId ? String(actorId) : null,
        requestId: requestId ? String(requestId) : null,
        metadata: Object.freeze({ ...metadata }),
        createdAt: now.toISOString()
    });
}

module.exports = {
    createAuditEvent
};
