const { requireTenantId } = require("../tenant/tenant-id");

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createInMemorySecuritySignalStore() {
    const signals = [];

    return Object.freeze({
        async write(signal) {
            signals.push(clone(signal));
            return clone(signal);
        },

        async listTenant({ tenantId, limit }) {
            const safeTenantId = requireTenantId(tenantId);
            return signals
                .filter(signal => signal.tenantId === safeTenantId)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
                .slice(0, limit)
                .map(clone);
        }
    });
}

module.exports = {
    createInMemorySecuritySignalStore
};
