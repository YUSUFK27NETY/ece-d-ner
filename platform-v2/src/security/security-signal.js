const crypto = require("node:crypto");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const SECURITY_SIGNAL_TYPES = new Set([
    "repeated_unauthorized",
    "forbidden",
    "tenant_boundary_violation",
    "quota_warning",
    "cost_anomaly",
    "upper_plan_review",
    "rate_limit_exceeded"
]);
const SECURITY_SIGNAL_SEVERITIES = new Set(["info", "warning", "critical"]);
const SAFE_METADATA_FIELDS = new Set([
    "statusCode",
    "threshold",
    "policyScope",
    "reasonCode",
    "usageRatio",
    "costRatio",
    "plan"
]);

function cleanIdentifier(value, label, maxLength = 120) {
    const normalized = String(value ?? "").trim();

    if (!normalized || normalized.length > maxLength || !/^[a-z0-9_.:-]+$/i.test(normalized)) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return normalized;
}

function sanitizeMetadata(metadata) {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new TypeError("Security signal metadata nesne olmalı.");
    }

    const output = {};

    for (const [key, value] of Object.entries(metadata)) {
        if (!SAFE_METADATA_FIELDS.has(key)) {
            throw new TypeError("Security signal metadata izin verilmeyen alan içeriyor.");
        }

        if (!["string", "number", "boolean"].includes(typeof value) ||
            (typeof value === "string" && value.length > 120) ||
            (typeof value === "number" && !Number.isFinite(value))) {
            throw new TypeError("Security signal metadata değeri geçersiz.");
        }

        output[key] = value;
    }

    return Object.freeze(output);
}

function createSecuritySignal({
    tenantId = null,
    type,
    severity = "warning",
    requestId = null,
    operation,
    count = 1,
    metadata = {},
    now = new Date()
}) {
    const safeType = String(type ?? "").trim().toLowerCase();
    const safeSeverity = String(severity ?? "").trim().toLowerCase();
    const occurredAt = now instanceof Date ? now : new Date(now);
    const safeCount = Number(count);

    if (!SECURITY_SIGNAL_TYPES.has(safeType)) {
        throw new TypeError("Security signal type geçersiz.");
    }
    if (!SECURITY_SIGNAL_SEVERITIES.has(safeSeverity)) {
        throw new TypeError("Security signal severity geçersiz.");
    }
    if (Number.isNaN(occurredAt.getTime())) {
        throw new TypeError("Security signal tarihi geçersiz.");
    }
    if (!Number.isInteger(safeCount) || safeCount < 1 || safeCount > 1_000_000_000) {
        throw new TypeError("Security signal count geçersiz.");
    }

    return Object.freeze({
        schemaVersion: 1,
        signalId: crypto.randomUUID(),
        tenantId: tenantId === null || tenantId === undefined
            ? null
            : requireTenantId(tenantId),
        type: safeType,
        severity: safeSeverity,
        requestId: requestId ? cleanIdentifier(requestId, "Security signal requestId", 128) : null,
        operation: cleanIdentifier(operation, "Security signal operation"),
        count: safeCount,
        metadata: sanitizeMetadata(metadata),
        createdAt: occurredAt.toISOString()
    });
}

function assertSecuritySignalStore(store) {
    for (const method of ["write", "listTenant"]) {
        if (!store || typeof store[method] !== "function") {
            throw new TypeError(`Security signal store ${method} metodunu uygulamalı.`);
        }
    }

    return store;
}

function createSecuritySignalService({ store }) {
    const signalStore = assertSecuritySignalStore(store);

    return Object.freeze({
        async emit(input) {
            const signal = createSecuritySignal(input);
            return signalStore.write(signal);
        },

        async listTenant({ context, tenantId, limit = 20 }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "tenant.security.read"
            });

            const safeLimit = Number(limit);
            if (!Number.isInteger(safeLimit) || safeLimit < 1 || safeLimit > 200) {
                throw new TypeError("Security signal liste limiti geçersiz.");
            }

            return signalStore.listTenant({ tenantId: safeTenantId, limit: safeLimit });
        }
    });
}

module.exports = {
    SAFE_METADATA_FIELDS,
    SECURITY_SIGNAL_SEVERITIES,
    SECURITY_SIGNAL_TYPES,
    createSecuritySignal,
    createSecuritySignalService,
    sanitizeMetadata
};
