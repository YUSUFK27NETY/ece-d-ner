const { requireTenantId } = require("../tenant/tenant-id");
const { createTenantPlacement } = require("./tenant-placement");

function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
}

function createInMemoryPlacementRegistry(initial = []) {
    const placements = new Map();
    for (const input of initial) {
        const placement = createTenantPlacement(input);
        placements.set(placement.tenantId, clone(placement));
    }

    return Object.freeze({
        async get(tenantId) {
            return clone(placements.get(requireTenantId(tenantId)) || null);
        },
        async set(input) {
            const placement = createTenantPlacement(input);
            placements.set(placement.tenantId, clone(placement));
            return clone(placement);
        }
    });
}

module.exports = { createInMemoryPlacementRegistry };
