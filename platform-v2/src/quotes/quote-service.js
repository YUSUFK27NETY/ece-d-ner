const crypto = require("node:crypto");
const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    assertStatusTransition,
    createQuoteRecord,
    normalizeOffer,
    normalizePersistedQuote,
    normalizePublicQuoteInput,
    projectQuoteAdmin,
    projectQuotePublic,
    requireIdempotencyKey,
    requireQuoteId
} = require("./quote-model");

const QUOTES_FEATURE = "quotes";
const QUOTES_PERMISSION = "settings.manage";

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
    if (typeof value !== "string") throw new TypeError("Quote tenantId geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Quote tenantId geçersiz.");
    return tenantId;
}

function nowFrom(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new TypeError("Quote clock geçersiz.");
    return now;
}

function requireActor(context) {
    if (typeof context?.actorId !== "string" || !context.actorId.trim()) {
        throw new TypeError("Quote actorId geçersiz.");
    }
    return context.actorId;
}

function quoteIdFor(tenantId, idempotencyKey) {
    const digest = crypto.createHash("sha256")
        .update(`${tenantId}\n${idempotencyKey}`, "utf8")
        .digest("hex");
    return `q_${digest.slice(0, 32)}`;
}

function requestHashFor(normalizedInput) {
    return crypto.createHash("sha256")
        .update(JSON.stringify(normalizedInput), "utf8")
        .digest("hex");
}

function createQuoteService({ tenantRegistry, repository, entitlementService, clock = () => new Date() }) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Quote tenant registry geçersiz.");
    }
    if (!repository || typeof repository.listByTenant !== "function" ||
        typeof repository.getById !== "function" || typeof repository.commitCreate !== "function" ||
        typeof repository.commitUpdate !== "function") {
        throw new TypeError("Quote repository geçersiz.");
    }
    if (!entitlementService || typeof entitlementService.evaluate !== "function" ||
        typeof entitlementService.assertFeatureAccess !== "function") {
        throw new TypeError("Quote entitlement service geçersiz.");
    }
    if (typeof clock !== "function") throw new TypeError("Quote clock geçersiz.");

    async function loadTenant(tenantId) {
        const tenant = await tenantRegistry.getById(tenantId);
        if (!tenant || tenant.tenantId !== tenantId || requireTenantId(tenant.tenantId) !== tenantId) {
            throw safeError("TENANT_NOT_FOUND", "Tenant bulunamadı.");
        }
        return tenant;
    }

    function evaluatePublic(tenant) {
        const result = entitlementService.evaluate({ tenant, feature: QUOTES_FEATURE });
        if (!result || result.feature !== QUOTES_FEATURE || result.featureEnabled !== true) {
            throw safeError("QUOTE_NOT_AVAILABLE", "Teklif modülü kullanılamıyor.");
        }
        if (result.usedDefaultPlanPolicy === true) {
            throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "Tenant planı doğrulanamadı.");
        }
    }

    async function authorize(context, rawTenantId) {
        if (!isPlainRecord(context)) throw new TypeError("Quote context geçersiz.");
        const tenantId = canonicalTenant(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: QUOTES_PERMISSION });
        const tenant = await loadTenant(tenantId);
        const result = entitlementService.assertFeatureAccess({
            context,
            tenant,
            permission: QUOTES_PERMISSION,
            feature: QUOTES_FEATURE
        });
        if (!result || result.feature !== QUOTES_FEATURE || result.featureEnabled !== true ||
            result.usedDefaultPlanPolicy === true) {
            throw safeError("ENTITLEMENT_PLAN_UNRESOLVED", "Teklif modülü erişimi doğrulanamadı.");
        }
        return { context, tenantId, tenant };
    }

    return Object.freeze({
        async createPublic({ tenantId, input, idempotencyKey } = {}) {
            const safeTenantId = canonicalTenant(tenantId);
            const tenant = await loadTenant(safeTenantId);
            if (tenant.status !== "active") throw safeError("QUOTE_NOT_AVAILABLE", "Teklif modülü kullanılamıyor.");
            evaluatePublic(tenant);
            const key = requireIdempotencyKey(idempotencyKey);
            const normalized = normalizePublicQuoteInput(input);
            const now = nowFrom(clock);
            const quoteId = quoteIdFor(safeTenantId, key);
            const requestHash = requestHashFor(normalized);
            const quote = createQuoteRecord({
                tenantId: safeTenantId,
                quoteId,
                requestHash,
                input: normalized,
                now
            });
            const auditEvent = createAuditEvent({
                tenantId: safeTenantId,
                action: "quote.request.created",
                metadata: {
                    quoteId,
                    status: quote.status,
                    itemCount: quote.items.length
                },
                now
            });
            const result = await repository.commitCreate({ quote, auditEvent });
            return Object.freeze({
                created: result.created === true,
                quote: projectQuotePublic(result.quote)
            });
        },

        async listAdmin({ context, tenantId, status = null, limit = 100 } = {}) {
            const authorized = await authorize(context, tenantId);
            const records = await repository.listByTenant(authorized.tenantId, { status, limit });
            if (!Array.isArray(records)) throw safeError("QUOTE_UNAVAILABLE", "Teklif listesi alınamadı.");
            return Object.freeze(records.map(projectQuoteAdmin));
        },

        async getAdmin({ context, tenantId, quoteId } = {}) {
            const authorized = await authorize(context, tenantId);
            const safeQuoteId = requireQuoteId(quoteId);
            const quote = await repository.getById(authorized.tenantId, safeQuoteId);
            if (!quote) throw safeError("QUOTE_NOT_FOUND", "Teklif bulunamadı.");
            return projectQuoteAdmin(quote);
        },

        async updateAdmin({ context, tenantId, quoteId, input, requestId = null } = {}) {
            const authorized = await authorize(context, tenantId);
            if (authorized.tenant.status === "archived") {
                throw safeError("TENANT_ARCHIVED", "Arşivlenmiş tenant teklif değiştiremez.");
            }
            const safeQuoteId = requireQuoteId(quoteId);
            const current = await repository.getById(authorized.tenantId, safeQuoteId);
            if (!current) throw safeError("QUOTE_NOT_FOUND", "Teklif bulunamadı.");
            const patch = normalizeOffer(input);
            const nextStatus = patch.status ?? current.status;
            assertStatusTransition(current.status, nextStatus);
            const amountMinor = patch.amountMinor !== undefined ? patch.amountMinor : current.amountMinor;
            const currency = patch.currency !== undefined ? patch.currency : current.currency;
            if ((amountMinor === null) !== (currency === null)) {
                throw new TypeError("Teklif tutarı ve para birimi birlikte ayarlanmalı.");
            }
            const now = nowFrom(clock);
            const next = normalizePersistedQuote({
                tenantId: authorized.tenantId,
                quoteId: safeQuoteId,
                data: {
                    ...current,
                    ...patch,
                    status: nextStatus,
                    amountMinor,
                    currency,
                    updatedAt: now.toISOString()
                }
            });
            const auditEvent = createAuditEvent({
                tenantId: authorized.tenantId,
                action: "quote.updated",
                actorId: requireActor(authorized.context),
                requestId,
                metadata: {
                    quoteId: safeQuoteId,
                    fromStatus: current.status,
                    toStatus: next.status,
                    hasOffer: next.amountMinor !== null
                },
                now
            });
            const saved = await repository.commitUpdate({ expectedQuote: current, nextQuote: next, auditEvent });
            return projectQuoteAdmin(saved);
        }
    });
}

module.exports = {
    QUOTES_FEATURE,
    QUOTES_PERMISSION,
    createQuoteService,
    quoteIdFor,
    requestHashFor
};
