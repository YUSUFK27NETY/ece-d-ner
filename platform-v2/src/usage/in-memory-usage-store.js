const { requireTenantId } = require("../tenant/tenant-id");
const { mergeUsageAggregate } = require("./usage-telemetry");

function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createInMemoryUsageStore() {
    const aggregates = new Map();

    function storageKey(tenantId, descriptor) {
        return `${requireTenantId(tenantId)}:${descriptor.key}`;
    }

    return Object.freeze({
        async increment({ tenantId, descriptor, delta }) {
            const key = storageKey(tenantId, descriptor);
            const next = mergeUsageAggregate(aggregates.get(key), delta, descriptor);
            aggregates.set(key, clone(next));
            return clone(next);
        },

        async get({ tenantId, descriptor }) {
            return clone(aggregates.get(storageKey(tenantId, descriptor))) || null;
        }
    });
}

module.exports = {
    createInMemoryUsageStore
};
