function rejectLifecycle(code = "INVALID_METADATA") {
    const error = new TypeError("Secret lifecycle metadata kontratı reddedildi.");
    error.code = code;
    throw error;
}

function assertLifecycleFields(input, allowed) {
    if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) {
        rejectLifecycle();
    }
    // Reject forbidden fields before reading their descriptors' values; never invoke getters.
    for (const key of Reflect.ownKeys(input)) {
        if (typeof key !== "string" || !allowed.includes(key) ||
            ["__proto__", "constructor", "prototype"].includes(key)) rejectLifecycle();
        if (!Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), "value")) rejectLifecycle();
    }
}

function lifecycleId(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{1,127}$/.test(value) ||
        /^\d{7,15}$/.test(value)) rejectLifecycle();
    return value;
}

function lifecycleEnvironment(value) {
    if (value !== "staging" && value !== "production") rejectLifecycle("INVALID_ENVIRONMENT");
    return value;
}

function lifecycleInteger(value, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) rejectLifecycle("INVALID_CONFIG");
    return value;
}

function lifecycleTime(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) rejectLifecycle();
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0 || new Date(timestamp).toISOString() !== value) rejectLifecycle();
    return timestamp;
}

function lifecycleNow(value) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > Date.parse("9990-01-01T00:00:00.000Z")) {
        rejectLifecycle("INVALID_CLOCK");
    }
    return value;
}

function lifecycleIds(value, maxLength) {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maxLength) rejectLifecycle();
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1) rejectLifecycle();
    const output = [];
    for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor || !Object.hasOwn(descriptor, "value")) rejectLifecycle();
        const id = lifecycleId(descriptor.value);
        if (output.includes(id)) rejectLifecycle();
        output.push(id);
    }
    return Object.freeze(output);
}

function authorizeLifecycleScope(context, environment) {
    assertLifecycleFields(context, ["actorId", "role", "environment"]);
    const targetEnvironment = lifecycleEnvironment(environment);
    const actorId = lifecycleId(context.actorId);
    if (context.role !== "platform_admin") rejectLifecycle("PERMISSION_DENIED");
    if (lifecycleEnvironment(context.environment) !== targetEnvironment) rejectLifecycle("ENVIRONMENT_SCOPE_MISMATCH");
    return actorId;
}

module.exports = {
    rejectLifecycle, assertLifecycleFields, lifecycleId, lifecycleEnvironment,
    lifecycleInteger, lifecycleTime, lifecycleNow, lifecycleIds, authorizeLifecycleScope
};
