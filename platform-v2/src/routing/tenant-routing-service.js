const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { createTenantPlacement, assertPlacementTenant } = require("./tenant-placement");

function createTenantRoutingService({ registry, auditWriter = null, cacheTtlMs = 30_000, now = () => new Date() }) {
    if (!registry || typeof registry.get !== "function" || typeof registry.set !== "function") {
        throw new TypeError("Tenant placement registry get/set gerekli.");
    }
    if (auditWriter && typeof auditWriter.write !== "function") {
        throw new TypeError("Tenant routing audit writer geçersiz.");
    }
    const ttl = Number(cacheTtlMs);
    if (!Number.isInteger(ttl) || ttl < 100 || ttl > 3_600_000) {
        throw new TypeError("Tenant route cache TTL geçersiz.");
    }
    const cache = new Map();

    async function resolve({ context, tenantId: rawTenantId }) {
        const tenantId = requireTenantId(rawTenantId);
        authorizeTenantAction({ context, tenantId, permission: "tenant.route.read" });
        const timestamp = now();
        if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
            throw new TypeError("Tenant routing clock geçersiz.");
        }
        const cached = cache.get(tenantId);
        if (cached && cached.expiresAt > timestamp.getTime()) return cached.placement;

        const stored = await registry.get(tenantId);
        if (!stored) {
            const error = new Error("Tenant route bulunamadı.");
            error.code = "TENANT_ROUTE_NOT_FOUND";
            throw error;
        }
        const placement = assertPlacementTenant(stored, tenantId);
        if (placement.status === "inactive") {
            const error = new Error("Tenant route aktif değil.");
            error.code = "TENANT_ROUTE_UNAVAILABLE";
            throw error;
        }
        cache.set(tenantId, { placement, expiresAt: timestamp.getTime() + ttl });
        return placement;
    }

    async function updatePlacement({ context, tenantId: rawTenantId, placement: input, actorId = null, requestId = null }) {
        if (context?.role !== "platform_admin") {
            const error = new Error("Placement mutation Platform Admin gerektirir.");
            error.code = "PERMISSION_DENIED";
            throw error;
        }
        const tenantId = requireTenantId(rawTenantId);
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            throw new TypeError("Placement mutation kaydı gerekli.");
        }
        if (input?.tenantId !== undefined && requireTenantId(input.tenantId) !== tenantId) {
            const error = new Error("Placement tenant binding uyuşmuyor.");
            error.code = "TENANT_BOUNDARY_VIOLATION";
            throw error;
        }
        const current = await registry.get(tenantId);
        const placement = assertPlacementTenant({ ...input, tenantId }, tenantId);
        const expectedVersion = current ? createTenantPlacement(current).version + 1 : 1;
        if (placement.version !== expectedVersion) {
            const error = new Error("Placement version sırası geçersiz.");
            error.code = "PLACEMENT_VERSION_CONFLICT";
            throw error;
        }
        const saved = await registry.set(placement);
        cache.delete(tenantId);
        if (auditWriter) {
            await auditWriter.write({
                tenantId,
                action: "tenant.placement.updated",
                actorId: actorId || context.actorId || null,
                requestId,
                metadata: {
                    placementType: saved.placementType,
                    placementId: saved.placementId,
                    version: saved.version,
                    region: saved.region
                }
            });
        }
        return saved;
    }

    return Object.freeze({
        resolve,
        updatePlacement,
        invalidate(tenantId) { cache.delete(requireTenantId(tenantId)); }
    });
}

module.exports = { createTenantRoutingService };
