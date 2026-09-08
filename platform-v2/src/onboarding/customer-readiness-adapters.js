const { requireTenantId } = require("../tenant/tenant-id");

function fail(label) {
    throw new TypeError(`Customer readiness ${label} geçersiz.`);
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function readOwn(record, key) {
    if (!record || typeof record !== "object") {
        return Object.freeze({ exists: false, safe: false, value: undefined });
    }

    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (!descriptor) {
        return Object.freeze({ exists: false, safe: true, value: undefined });
    }

    return Object.hasOwn(descriptor, "value")
        ? Object.freeze({ exists: true, safe: true, value: descriptor.value })
        : Object.freeze({ exists: true, safe: false, value: undefined });
}

function requireAdapterTenantId(input) {
    if (!isPlainRecord(input)) {
        fail("adapter request");
    }

    const field = readOwn(input, "tenantId");
    if (!field.exists || !field.safe || typeof field.value !== "string") {
        fail("tenantId");
    }

    const tenantId = requireTenantId(field.value);
    if (tenantId !== field.value) {
        fail("tenantId");
    }

    return tenantId;
}

function canonicalTimestamp(value) {
    const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
    return Number.isFinite(timestamp) && timestamp > 0 &&
        new Date(timestamp).toISOString() === value
        ? value
        : null;
}

function readinessResult({ source, tenantId, status, code, observedAt }) {
    return Object.freeze({ source, tenantId, status, code, observedAt });
}

function classifyStringField(field, isValid) {
    if (!field.exists || (field.safe &&
        (field.value === null || field.value === ""))) {
        return "incomplete";
    }
    if (!field.safe || typeof field.value !== "string" ||
        !isValid(field.value)) {
        return "invalid";
    }
    return "ready";
}

function classifyTimezone(field) {
    const structure = classifyStringField(
        field,
        value => value === value.trim() && value.length <= 64
    );
    if (structure !== "ready") {
        return structure;
    }

    try {
        new Intl.DateTimeFormat("tr-TR", { timeZone: field.value })
            .format(new Date(0));
        return "ready";
    } catch {
        return "invalid";
    }
}

function createProfileReadinessAdapter() {
    return Object.freeze({
        evaluate(input) {
            const tenantId = requireAdapterTenantId(input);
            const tenantField = readOwn(input, "tenant");
            if (!tenantField.exists || !tenantField.safe ||
                !isPlainRecord(tenantField.value)) {
                return readinessResult({
                    source: "profile",
                    tenantId,
                    status: "blocked",
                    code: "PROFILE_INVALID",
                    observedAt: null
                });
            }

            const tenant = tenantField.value;
            const displayName = classifyStringField(
                readOwn(tenant, "displayName"),
                value => value === value.trim() &&
                    value.length >= 2 && value.length <= 120
            );
            const sector = classifyStringField(
                readOwn(tenant, "sector"),
                value => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)
            );
            const profileField = readOwn(tenant, "profile");
            let timezone = "incomplete";
            if (profileField.exists && profileField.safe &&
                profileField.value !== null) {
                timezone = isPlainRecord(profileField.value)
                    ? classifyTimezone(readOwn(profileField.value, "timezone"))
                    : "invalid";
            } else if (profileField.exists && !profileField.safe) {
                timezone = "invalid";
            }

            const states = [displayName, sector, timezone];
            const status = states.includes("invalid")
                ? "blocked"
                : states.includes("incomplete") ? "pending" : "ready";
            const code = status === "blocked"
                ? "PROFILE_INVALID"
                : status === "pending" ? "PROFILE_INCOMPLETE" : null;
            const updatedAt = readOwn(tenant, "updatedAt");
            const observedAt = updatedAt.exists && updatedAt.safe
                ? canonicalTimestamp(updatedAt.value)
                : null;

            return readinessResult({
                source: "profile",
                tenantId,
                status,
                code,
                observedAt
            });
        }
    });
}

function createHealthReadinessAdapter({ checkReadiness }) {
    if (typeof checkReadiness !== "function") {
        fail("health checker");
    }

    return Object.freeze({
        async evaluate(input) {
            const tenantId = requireAdapterTenantId(input);
            const readiness = await checkReadiness();
            if (!isPlainRecord(readiness)) {
                fail("health result");
            }

            const ready = readOwn(readiness, "ready");
            const checkedAt = readOwn(readiness, "checkedAt");
            const observedAt = checkedAt.exists && checkedAt.safe
                ? canonicalTimestamp(checkedAt.value)
                : null;
            if (!ready.exists || !ready.safe ||
                typeof ready.value !== "boolean" || !observedAt) {
                fail("health result");
            }

            return readinessResult({
                source: "health",
                tenantId,
                status: ready.value ? "ready" : "blocked",
                code: ready.value ? null : "HEALTH_CHECK_FAILED",
                observedAt
            });
        }
    });
}

function createBackupReadinessAdapter({ backupEvidenceProvider }) {
    if (!backupEvidenceProvider ||
        typeof backupEvidenceProvider.getStatus !== "function") {
        fail("backup evidence provider");
    }

    return Object.freeze({
        async evaluate(input) {
            const tenantId = requireAdapterTenantId(input);
            const evidence = await backupEvidenceProvider.getStatus({ tenantId });
            if (!isPlainRecord(evidence)) {
                fail("backup evidence");
            }

            const objectCount = readOwn(evidence, "objectCount");
            const verifiedAt = readOwn(evidence, "verifiedAt");
            if (!objectCount.exists || !objectCount.safe ||
                !Number.isSafeInteger(objectCount.value) || objectCount.value < 0 ||
                !verifiedAt.exists || !verifiedAt.safe) {
                fail("backup evidence");
            }

            const canonicalVerifiedAt = canonicalTimestamp(verifiedAt.value);
            const ready = objectCount.value > 0 && canonicalVerifiedAt !== null;
            return readinessResult({
                source: "backup",
                tenantId,
                status: ready ? "ready" : "pending",
                code: ready ? null : "BACKUP_NOT_VERIFIED",
                observedAt: canonicalVerifiedAt
            });
        }
    });
}

function createCustomerReadinessSourceAdapters({
    checkReadiness,
    backupEvidenceProvider = null
}) {
    const adapters = {
        profile: createProfileReadinessAdapter(),
        health: createHealthReadinessAdapter({ checkReadiness })
    };

    if (backupEvidenceProvider !== null) {
        adapters.backup = createBackupReadinessAdapter({
            backupEvidenceProvider
        });
    }

    return Object.freeze(adapters);
}

module.exports = {
    canonicalTimestamp,
    createBackupReadinessAdapter,
    createCustomerReadinessSourceAdapters,
    createHealthReadinessAdapter,
    createProfileReadinessAdapter
};
