const { requireTenantId } = require("../tenant/tenant-id");

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }

function createInMemoryRolloutStore(initial = []) {
    const records = new Map();
    for (const record of initial) records.set(requireTenantId(record.tenantId), clone(record));

    return Object.freeze({
        async get(tenantId) { return clone(records.get(requireTenantId(tenantId)) || null); },
        async save(record) {
            const tenantId = requireTenantId(record?.tenantId);
            records.set(tenantId, clone(record));
            return clone(record);
        }
    });
}

module.exports = { createInMemoryRolloutStore };
