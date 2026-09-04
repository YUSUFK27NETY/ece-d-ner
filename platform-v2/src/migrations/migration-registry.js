function normalizeSchemaVersion(value, label = "schemaVersion") {
    const version = Number(value);

    if (!Number.isInteger(version) || version < 0 || version > 1_000_000) {
        throw new TypeError(`${label} 0-1000000 arasında tam sayı olmalı.`);
    }

    return version;
}

function normalizeMigration(migration) {
    if (!migration || typeof migration !== "object" || Array.isArray(migration)) {
        throw new TypeError("Migration nesnesi gerekli.");
    }

    const version = normalizeSchemaVersion(migration.version, "migration.version");

    if (version < 1) {
        throw new TypeError("Migration version en az 1 olmalı.");
    }

    const id = String(migration.id ?? "").trim();

    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/.test(id)) {
        throw new TypeError("Migration id geçersiz.");
    }

    if (migration.idempotent !== true) {
        throw new TypeError("Migration idempotent: true sözleşmesini açıkça tanımlamalı.");
    }

    if (typeof migration.up !== "function" || typeof migration.verify !== "function") {
        throw new TypeError("Migration up ve verify fonksiyonlarını uygulamalı.");
    }

    if (migration.rollback !== undefined && typeof migration.rollback !== "function") {
        throw new TypeError("Migration rollback fonksiyon olmalı.");
    }

    if (!migration.rollback && !String(migration.forwardFix ?? "").trim()) {
        throw new TypeError("Migration rollback veya forwardFix prosedürü tanımlamalı.");
    }

    return Object.freeze({
        ...migration,
        version,
        id,
        idempotent: true,
        description: String(migration.description ?? "").trim(),
        forwardFix: String(migration.forwardFix ?? "").trim() || null
    });
}

function createMigrationPlan({ currentVersion, targetVersion, migrations }) {
    const current = normalizeSchemaVersion(currentVersion, "currentVersion");
    const target = normalizeSchemaVersion(targetVersion, "targetVersion");

    if (target < current) {
        throw new Error("Otomatik downgrade migration desteklenmiyor.");
    }

    if (!Array.isArray(migrations)) {
        throw new TypeError("Migration listesi gerekli.");
    }

    const normalized = migrations.map(normalizeMigration);
    const versions = new Set();
    const ids = new Set();

    for (const migration of normalized) {
        if (versions.has(migration.version) || ids.has(migration.id)) {
            throw new Error("Tekrarlanan migration version veya id bulundu.");
        }

        versions.add(migration.version);
        ids.add(migration.id);
    }

    const byVersion = new Map(normalized.map(item => [item.version, item]));
    const plan = [];

    for (let version = current + 1; version <= target; version += 1) {
        const migration = byVersion.get(version);

        if (!migration) {
            throw new Error(`Migration zincirinde ${version} sürümü eksik.`);
        }

        plan.push(migration);
    }

    return Object.freeze({
        currentVersion: current,
        targetVersion: target,
        migrations: Object.freeze(plan)
    });
}

async function applyMigrationPlan({ plan, context, onApplied = async () => {} }) {
    if (!plan || !Array.isArray(plan.migrations)) {
        throw new TypeError("Geçerli migration planı gerekli.");
    }

    if (typeof onApplied !== "function") {
        throw new TypeError("onApplied fonksiyon olmalı.");
    }

    let version = normalizeSchemaVersion(plan.currentVersion, "plan.currentVersion");
    const applied = [];

    for (const migration of plan.migrations) {
        if (migration.version !== version + 1) {
            throw new Error("Migration planı sıralı değil.");
        }

        await migration.up(context);
        const verified = await migration.verify(context);

        if (verified !== true) {
            const error = new Error(`Migration doğrulaması başarısız: ${migration.id}`);
            error.code = "MIGRATION_VERIFY_FAILED";
            throw error;
        }

        await onApplied({
            version: migration.version,
            id: migration.id
        });
        version = migration.version;
        applied.push(migration.id);
    }

    return Object.freeze({
        fromVersion: plan.currentVersion,
        toVersion: version,
        applied: Object.freeze(applied)
    });
}

module.exports = {
    normalizeSchemaVersion,
    normalizeMigration,
    createMigrationPlan,
    applyMigrationPlan
};
