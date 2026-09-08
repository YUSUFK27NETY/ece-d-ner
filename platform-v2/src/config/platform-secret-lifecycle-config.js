const {
    assertLifecycleFields, lifecycleInteger, rejectLifecycle
} = require("../secrets/secret-metadata-contract");

const DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG = Object.freeze({
    defaultRotationIntervalDays: 90,
    warningWindowDays: 14,
    dualKeyOverlapDays: 7,
    oldKeyRetentionDays: 30,
    inventoryEvidenceTtlMs: 300_000,
    maxPreviousKeyIds: 64
});

function normalizePlatformSecretLifecycleConfig(input = DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG) {
    assertLifecycleFields(input, Object.keys(DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG));
    const output = {
        defaultRotationIntervalDays: lifecycleInteger(input.defaultRotationIntervalDays, 1, 3650),
        warningWindowDays: lifecycleInteger(input.warningWindowDays, 0, 365),
        dualKeyOverlapDays: lifecycleInteger(input.dualKeyOverlapDays, 1, 90),
        oldKeyRetentionDays: lifecycleInteger(input.oldKeyRetentionDays, 1, 3650),
        inventoryEvidenceTtlMs: lifecycleInteger(input.inventoryEvidenceTtlMs, 1000, 3_600_000),
        maxPreviousKeyIds: lifecycleInteger(input.maxPreviousKeyIds, 1, 1000)
    };
    if (output.warningWindowDays >= output.defaultRotationIntervalDays ||
        output.oldKeyRetentionDays < output.dualKeyOverlapDays) rejectLifecycle("INVALID_CONFIG");
    return Object.freeze(output);
}

module.exports = { DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG, normalizePlatformSecretLifecycleConfig };
