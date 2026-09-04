const { requireTenantId } = require("../tenant/tenant-id");

const PLACEMENT_TYPES = new Set(["shared", "shard", "dedicated"]);
const PLACEMENT_STATUSES = new Set(["active", "migrating", "draining", "inactive"]);
const RELEASE_CHANNELS = new Set(["canary", "staged", "stable"]);

function simpleId(value, label) {
    const id = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(id)) throw new TypeError(`${label} geçersiz.`);
    return id;
}

function createTenantPlacement(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Tenant placement nesnesi gerekli.");
    }
    const allowed = new Set([
        "tenantId", "placementType", "placementId", "shardId", "region", "status",
        "version", "releaseChannel", "cohort", "updatedAt"
    ]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError("Tenant placement bilinmeyen alan içeriyor.");
    }

    const tenantId = requireTenantId(input.tenantId);
    const placementType = String(input.placementType ?? "shared").trim().toLowerCase();
    const status = String(input.status ?? "active").trim().toLowerCase();
    const releaseChannel = String(input.releaseChannel ?? "stable").trim().toLowerCase();
    if (!PLACEMENT_TYPES.has(placementType)) throw new TypeError("Placement type geçersiz.");
    if (!PLACEMENT_STATUSES.has(status)) throw new TypeError("Placement status geçersiz.");
    if (!RELEASE_CHANNELS.has(releaseChannel)) throw new TypeError("Placement release channel geçersiz.");

    const placementId = input.placementId === undefined || input.placementId === null
        ? (placementType === "shared" ? "shared-primary" : null)
        : simpleId(input.placementId, "Placement id");
    const shardId = input.shardId === undefined || input.shardId === null
        ? null
        : simpleId(input.shardId, "Shard id");
    if (!placementId) throw new TypeError("Placement id gerekli.");
    if (placementType === "shard" && (!shardId || shardId !== placementId)) {
        const error = new Error("Shard placement binding uyuşmuyor.");
        error.code = "INVALID_SHARD_BINDING";
        throw error;
    }
    if (placementType !== "shard" && shardId !== null) {
        throw new TypeError("Shard id yalnız shard placement için kullanılabilir.");
    }

    const region = simpleId(input.region ?? "global", "Placement region");
    const cohort = simpleId(input.cohort ?? "default", "Placement cohort");
    const version = Number(input.version ?? 1);
    if (!Number.isInteger(version) || version < 1 || version > 1_000_000) {
        throw new TypeError("Placement version geçersiz.");
    }
    const updatedAt = input.updatedAt instanceof Date ? input.updatedAt : new Date(input.updatedAt ?? new Date());
    if (Number.isNaN(updatedAt.getTime())) throw new TypeError("Placement updatedAt geçersiz.");

    return Object.freeze({
        tenantId, placementType, placementId, shardId, region, status, version,
        releaseChannel, cohort, updatedAt: updatedAt.toISOString()
    });
}

function assertPlacementTenant(placement, expectedTenantId) {
    const normalized = createTenantPlacement(placement);
    if (normalized.tenantId !== requireTenantId(expectedTenantId)) {
        const error = new Error("Tenant route başka tenant placement kaydına bağlı.");
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }
    return normalized;
}

module.exports = {
    PLACEMENT_TYPES,
    PLACEMENT_STATUSES,
    RELEASE_CHANNELS,
    createTenantPlacement,
    assertPlacementTenant
};
