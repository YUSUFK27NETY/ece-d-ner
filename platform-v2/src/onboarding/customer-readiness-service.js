const { requireTenantId } = require("../tenant/tenant-id");
const { TENANT_STATUSES } = require("../tenant/tenant-record");

const ACTIVATION_READINESS_STATUSES = Object.freeze([
    "pending",
    "ready",
    "blocked",
    "unavailable"
]);
const ACTIVATION_READINESS_SOURCES = Object.freeze([
    "profile",
    "health",
    "plan",
    "adminBootstrap",
    "backup",
    "security",
    "domain"
]);
const ACTIVATION_READINESS_SOURCE_POLICY = Object.freeze({
    profile: Object.freeze({
        required: true,
        codes: Object.freeze([
            "PROFILE_INCOMPLETE",
            "PROFILE_INVALID",
            "PROFILE_UNAVAILABLE"
        ])
    }),
    health: Object.freeze({
        required: true,
        codes: Object.freeze([
            "HEALTH_CHECK_PENDING",
            "HEALTH_CHECK_FAILED",
            "HEALTH_UNAVAILABLE"
        ])
    }),
    plan: Object.freeze({
        required: true,
        codes: Object.freeze([
            "PLAN_NOT_CONFIGURED",
            "PLAN_UNSUPPORTED",
            "PLAN_UNAVAILABLE"
        ])
    }),
    adminBootstrap: Object.freeze({
        required: true,
        codes: Object.freeze([
            "ADMIN_BOOTSTRAP_PENDING",
            "ADMIN_BOOTSTRAP_BLOCKED",
            "ADMIN_BOOTSTRAP_UNAVAILABLE"
        ])
    }),
    backup: Object.freeze({
        required: true,
        codes: Object.freeze([
            "BACKUP_PENDING",
            "BACKUP_NOT_VERIFIED",
            "BACKUP_UNAVAILABLE"
        ])
    }),
    security: Object.freeze({
        required: true,
        codes: Object.freeze([
            "SECURITY_REVIEW_PENDING",
            "SECURITY_BLOCKED",
            "SECURITY_UNAVAILABLE"
        ])
    }),
    domain: Object.freeze({
        required: false,
        codes: Object.freeze([
            "DOMAIN_NOT_CONFIGURED",
            "DOMAIN_PENDING",
            "DOMAIN_VERIFICATION_FAILED",
            "DOMAIN_UNAVAILABLE"
        ])
    })
});
const REQUIRED_ACTIVATION_READINESS_SOURCES = Object.freeze(
    ACTIVATION_READINESS_SOURCES.filter(
        source => ACTIVATION_READINESS_SOURCE_POLICY[source].required
    )
);
const issuedReadiness = new WeakSet();

function fail(label) {
    throw new TypeError(`Activation readiness ${label} geçersiz.`);
}

function requireOwnValue(record, key, label) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);

    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
        fail(label);
    }

    return descriptor.value;
}

function requireCanonicalTenantId(value, label) {
    if (typeof value !== "string") {
        fail(label);
    }

    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail(label);
    }

    return tenantId;
}

function normalizeSourceAdapters(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        fail("source adapters");
    }

    const adapters = {};

    for (const source of Reflect.ownKeys(input)) {
        if (typeof source !== "string" ||
            !ACTIVATION_READINESS_SOURCES.includes(source)) {
            fail("source");
        }

        const adapter = requireOwnValue(input, source, "source adapter");
        if (!adapter || typeof adapter !== "object" || Array.isArray(adapter) ||
            typeof adapter.evaluate !== "function") {
            fail(`${source} adapter`);
        }

        adapters[source] = adapter;
    }

    return Object.freeze(adapters);
}

function normalizeObservedAt(value, evaluatedAtMs) {
    if (value === null || value === undefined) {
        return null;
    }

    const observedAtMs = typeof value === "string" ? Date.parse(value) : NaN;
    if (!Number.isFinite(observedAtMs) || observedAtMs <= 0 ||
        new Date(observedAtMs).toISOString() !== value ||
        observedAtMs > evaluatedAtMs) {
        fail("source observedAt");
    }

    return value;
}

function projectReadinessCheck(source, input, tenantId, evaluatedAtMs) {
    const policy = ACTIVATION_READINESS_SOURCE_POLICY[source];
    if (!policy) {
        fail("source");
    }
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        fail(`${source} result`);
    }

    const sourceDescriptor = Object.getOwnPropertyDescriptor(input, "source");
    if (sourceDescriptor &&
        (!Object.hasOwn(sourceDescriptor, "value") ||
            sourceDescriptor.value !== source)) {
        fail(`${source} result source`);
    }

    const tenantIdDescriptor = Object.getOwnPropertyDescriptor(input, "tenantId");
    if (tenantIdDescriptor &&
        (!Object.hasOwn(tenantIdDescriptor, "value") ||
            requireCanonicalTenantId(
                tenantIdDescriptor.value,
                `${source} result tenantId`
            ) !== tenantId)) {
        fail(`${source} result tenantId`);
    }

    const status = requireOwnValue(input, "status", `${source} status`);
    if (!ACTIVATION_READINESS_STATUSES.includes(status)) {
        fail(`${source} status`);
    }

    const codeDescriptor = Object.getOwnPropertyDescriptor(input, "code");
    const code = codeDescriptor && Object.hasOwn(codeDescriptor, "value")
        ? codeDescriptor.value
        : null;
    if (code !== null && !policy.codes.includes(code)) {
        fail(`${source} code`);
    }

    const observedAtDescriptor = Object.getOwnPropertyDescriptor(input, "observedAt");
    const observedAt = normalizeObservedAt(
        observedAtDescriptor && Object.hasOwn(observedAtDescriptor, "value")
            ? observedAtDescriptor.value
            : null,
        evaluatedAtMs
    );

    return Object.freeze({ status, code, observedAt });
}

function unavailableCheck() {
    return Object.freeze({
        status: "unavailable",
        code: null,
        observedAt: null
    });
}

function aggregateRequiredChecks(checks) {
    const statuses = REQUIRED_ACTIVATION_READINESS_SOURCES.map(
        source => checks[source].status
    );

    for (const status of ["blocked", "unavailable", "pending"]) {
        if (statuses.includes(status)) {
            return status;
        }
    }

    return "ready";
}

function createCustomerReadinessService({
    sourceAdapters = {},
    clock = Date.now
} = {}) {
    const adapters = normalizeSourceAdapters(sourceAdapters);
    if (typeof clock !== "function") {
        fail("clock");
    }

    let lastEvaluationMs = 0;

    function now() {
        const value = clock();
        if (!Number.isSafeInteger(value) || value <= 0 ||
            value > 8_640_000_000_000_000 || value < lastEvaluationMs) {
            fail("clock");
        }
        lastEvaluationMs = value;
        return value;
    }

    async function loadSource({ source, tenantId, tenant }) {
        const adapter = adapters[source];
        if (!adapter) {
            return Object.freeze({ available: false, value: null });
        }

        try {
            const value = await adapter.evaluate(Object.freeze({
                tenantId,
                tenant
            }));
            return Object.freeze({ available: true, value });
        } catch {
            return Object.freeze({ available: false, value: null });
        }
    }

    return Object.freeze({
        async evaluate(input) {
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
                Reflect.ownKeys(input).some(key => typeof key !== "string" ||
                    !["tenantId", "tenant"].includes(key))) {
                fail("request");
            }

            const tenantId = requireCanonicalTenantId(
                requireOwnValue(input, "tenantId", "tenantId"),
                "tenantId"
            );
            const tenant = requireOwnValue(input, "tenant", "tenant");
            if (!tenant || typeof tenant !== "object" || Array.isArray(tenant)) {
                fail("tenant");
            }

            const recordTenantId = requireCanonicalTenantId(
                requireOwnValue(tenant, "tenantId", "tenant record tenantId"),
                "tenant record tenantId"
            );
            if (recordTenantId !== tenantId) {
                const error = new Error("Tenant readiness kapsamı eşleşmiyor.");
                error.code = "TENANT_SCOPE_MISMATCH";
                throw error;
            }

            const lifecycleStatus = requireOwnValue(
                tenant,
                "status",
                "tenant lifecycle status"
            );
            if (!TENANT_STATUSES.has(lifecycleStatus)) {
                fail("tenant lifecycle status");
            }

            const loadedSources = await Promise.all(
                ACTIVATION_READINESS_SOURCES.map(source => loadSource({
                    source,
                    tenantId,
                    tenant
                }))
            );
            const evaluatedAtMs = now();
            const projectedChecks = ACTIVATION_READINESS_SOURCES.map(
                (source, index) => {
                    const loaded = loadedSources[index];
                    if (!loaded.available) {
                        return unavailableCheck();
                    }

                    try {
                        return projectReadinessCheck(
                            source,
                            loaded.value,
                            tenantId,
                            evaluatedAtMs
                        );
                    } catch {
                        return unavailableCheck();
                    }
                }
            );
            const checks = {};
            ACTIVATION_READINESS_SOURCES.forEach((source, index) => {
                checks[source] = projectedChecks[index];
            });
            Object.freeze(checks);

            const activationReadiness = aggregateRequiredChecks(checks);
            const readiness = Object.freeze({
                tenantId,
                lifecycleStatus,
                activationReadiness,
                canActivate: activationReadiness === "ready" &&
                    lifecycleStatus === "provisioning",
                checks,
                evaluatedAt: new Date(evaluatedAtMs).toISOString()
            });
            issuedReadiness.add(readiness);
            return readiness;
        }
    });
}

function assertCustomerReadiness(readiness) {
    if (!readiness || typeof readiness !== "object" ||
        !issuedReadiness.has(readiness)) {
        fail("read model");
    }

    return readiness;
}

module.exports = {
    ACTIVATION_READINESS_SOURCE_POLICY,
    ACTIVATION_READINESS_SOURCES,
    ACTIVATION_READINESS_STATUSES,
    REQUIRED_ACTIVATION_READINESS_SOURCES,
    assertCustomerReadiness,
    createCustomerReadinessService
};
