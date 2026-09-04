const { requireTenantId } = require("../tenant/tenant-id");

function clone(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
}

function createInMemoryTenantMigrationStore() {
    const records = new Map();

    return Object.freeze({
        async get(migrationId) {
            return clone(records.get(String(migrationId)) || null);
        },
        async save(record) {
            records.set(String(record.migrationId), clone(record));
            return clone(record);
        },
        async listByTenant(tenantId) {
            const safeTenantId = requireTenantId(tenantId);
            return [...records.values()]
                .filter(record => record.tenantId === safeTenantId)
                .map(clone)
                .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        }
    });
}

module.exports = { createInMemoryTenantMigrationStore };
