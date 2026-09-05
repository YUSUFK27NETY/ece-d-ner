const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const CACHE_CLASSIFICATIONS = new Set(["public_static", "private", "admin"]);

function safeSegment(value, label) {
    const segment = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._:-]{0,127}$/.test(segment)) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return segment;
}

function normalizeVersion(value) {
    const version = Number(value);
    if (!Number.isInteger(version) || version < 1 || version > 1_000_000_000) {
        throw new TypeError("Cache resource version geçersiz.");
    }
    return version;
}

function cacheKey({ tenantId, classification, resourceType, resourceId, version }) {
    return [tenantId, classification, resourceType, resourceId, `v${version}`].join("|");
}

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createTenantCache({ config, now = () => new Date() }) {
    if (!config?.cache) throw new TypeError("Tenant cache config gerekli.");
    const policy = config.cache;
    const entries = new Map();
    const invalidations = new Map();

    function currentTime() {
        const value = now();
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
            throw new TypeError("Tenant cache clock geçersiz.");
        }
        return value.getTime();
    }

    function normalizeDescriptor(input) {
        const tenantId = requireTenantId(input?.tenantId);
        const classification = String(input?.classification ?? "").trim().toLowerCase();
        if (!CACHE_CLASSIFICATIONS.has(classification)) {
            throw new TypeError("Cache classification geçersiz.");
        }
        return Object.freeze({
            tenantId,
            classification,
            resourceType: safeSegment(input?.resourceType, "Cache resourceType"),
            resourceId: safeSegment(input?.resourceId, "Cache resourceId"),
            version: normalizeVersion(input?.version)
        });
    }

    function responsePolicy(classification) {
        if (classification !== "public_static") return "private, no-store";
        return `public, max-age=${policy.publicTtlSeconds}, stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`;
    }

    function authorize(context, tenantId, permission) {
        authorizeTenantAction({ context, tenantId, permission });
    }

    function tenantEntries(tenantId) {
        return [...entries.values()].filter(entry => entry.tenantId === tenantId);
    }

    async function put({ context, value, ...input }) {
        const descriptor = normalizeDescriptor(input);
        authorize(context, descriptor.tenantId, "tenant.cache.write");
        const cacheControl = responsePolicy(descriptor.classification);

        if (descriptor.classification !== "public_static") {
            return Object.freeze({ stored: false, cacheControl, classification: descriptor.classification });
        }

        const existing = tenantEntries(descriptor.tenantId);
        const key = cacheKey(descriptor);
        if (!entries.has(key) && existing.length >= policy.maxEntriesPerTenant) {
            const oldest = existing.sort((left, right) => left.createdAtMs - right.createdAtMs)[0];
            entries.delete(oldest.key);
        }
        const createdAtMs = currentTime();
        entries.set(key, {
            ...descriptor,
            key,
            value: clone(value),
            createdAtMs,
            freshUntilMs: createdAtMs + (policy.publicTtlSeconds * 1000),
            staleUntilMs: createdAtMs + ((policy.publicTtlSeconds + policy.staleWhileRevalidateSeconds) * 1000)
        });
        return Object.freeze({ stored: true, cacheControl, classification: descriptor.classification });
    }

    async function get({ context, ...input }) {
        const descriptor = normalizeDescriptor(input);
        authorize(context, descriptor.tenantId, "tenant.cache.read");
        const cacheControl = responsePolicy(descriptor.classification);
        if (descriptor.classification !== "public_static") {
            return Object.freeze({ hit: false, state: "bypass", value: null, cacheControl });
        }
        const key = cacheKey(descriptor);
        const entry = entries.get(key);
        if (!entry) return Object.freeze({ hit: false, state: "miss", value: null, cacheControl });
        const at = currentTime();
        if (at >= entry.staleUntilMs) {
            entries.delete(key);
            return Object.freeze({ hit: false, state: "expired", value: null, cacheControl });
        }
        return Object.freeze({
            hit: true,
            state: at < entry.freshUntilMs ? "fresh" : "stale",
            value: clone(entry.value),
            cacheControl
        });
    }

    async function invalidate({ context, tenantId: rawTenantId, resourceType = null, resourceId = null }) {
        const tenantId = requireTenantId(rawTenantId);
        authorize(context, tenantId, "tenant.cache.write");
        const safeType = resourceType === null ? null : safeSegment(resourceType, "Cache resourceType");
        const safeId = resourceId === null ? null : safeSegment(resourceId, "Cache resourceId");
        if (safeId !== null && safeType === null) throw new TypeError("Cache resourceType gerekli.");
        let removed = 0;
        for (const [key, entry] of entries) {
            if (entry.tenantId !== tenantId) continue;
            if (safeType !== null && entry.resourceType !== safeType) continue;
            if (safeId !== null && entry.resourceId !== safeId) continue;
            entries.delete(key);
            removed += 1;
        }
        const lastInvalidatedAt = new Date(currentTime()).toISOString();
        invalidations.set(tenantId, { lastInvalidatedAt, invalidatedEntries: removed });
        return Object.freeze({ tenantId, removed, lastInvalidatedAt });
    }

    async function getSummary({ context, tenantId: rawTenantId }) {
        const tenantId = requireTenantId(rawTenantId);
        authorize(context, tenantId, "tenant.cache.read");
        const at = currentTime();
        let fresh = 0;
        let stale = 0;
        for (const entry of tenantEntries(tenantId)) {
            if (at >= entry.staleUntilMs) {
                entries.delete(entry.key);
            } else if (at < entry.freshUntilMs) {
                fresh += 1;
            } else {
                stale += 1;
            }
        }
        const invalidation = invalidations.get(tenantId) || {};
        return Object.freeze({
            publicEntries: fresh + stale,
            fresh,
            stale,
            privateStored: 0,
            lastInvalidatedAt: invalidation.lastInvalidatedAt || null,
            invalidatedEntries: invalidation.invalidatedEntries || 0
        });
    }

    return Object.freeze({ put, get, invalidate, getSummary });
}

module.exports = {
    CACHE_CLASSIFICATIONS,
    cacheKey,
    createTenantCache
};
