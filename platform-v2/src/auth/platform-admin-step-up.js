const {
    DEFAULT_PLATFORM_STEP_UP_CONFIG,
    normalizePlatformStepUpConfig
} = require("../config/platform-step-up-config");

// Exact server-owned operation identifiers, never HTTP methods or client risk labels.
const PLATFORM_ADMIN_OPERATION_RISKS = Object.freeze({
    "tenant.read": "low",
    "tenant.operations.read": "low",
    "tenant.create": "medium",
    "tenant.update": "medium",
    "tenant.delete": "high",
    "platform_admin.claim.grant": "high",
    "platform_admin.claim.revoke": "high",
    "platform_admin.provision": "high",
    "placement.mutate": "high",
    "routing.mutate": "high",
    "migration.apply": "high",
    "migration.cutover": "high",
    "backup.restore.apply": "high",
    "secret.rotate": "high",
    "credential.rotate": "high",
    "production.destructive": "high"
});

const emittedDecisions = new WeakSet();

function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function isTimestamp(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function safeActorId(value) {
    // Opaque server-side IDs only; no email, name, JWT, URL or control characters.
    return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
        ? value : null;
}

function createOperationRegistry(additionalOperations) {
    const registry = new Map(Object.entries(PLATFORM_ADMIN_OPERATION_RISKS));
    if (!isRecord(additionalOperations)) {
        throw new TypeError("Platform step-up operation policy geçersiz.");
    }
    for (const [operation, riskLevel] of Object.entries(additionalOperations)) {
        if (operation.length > 120 ||
            !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(operation) ||
            registry.has(operation) || !["low", "medium", "high"].includes(riskLevel)) {
            throw new TypeError("Platform step-up operation policy geçersiz.");
        }
        registry.set(operation, riskLevel);
    }
    return registry;
}

function createPlatformAdminStepUpPolicy({
    config = DEFAULT_PLATFORM_STEP_UP_CONFIG,
    additionalOperations = {},
    clock = Date.now
} = {}) {
    let policy;
    let invalidReason = null;
    let registry = new Map(Object.entries(PLATFORM_ADMIN_OPERATION_RISKS));
    try {
        policy = normalizePlatformStepUpConfig(config);
    } catch {
        invalidReason = "INVALID_CONFIG";
    }
    try {
        registry = createOperationRegistry(additionalOperations);
    } catch {
        invalidReason = invalidReason || "INVALID_OPERATION_POLICY";
    }

    return Object.freeze({
        evaluate(input = {}) {
            const request = isRecord(input) ? input : {};
            const auth = isRecord(request.verifiedAuth) ? request.verifiedAuth : {};
            const knownOperation = typeof request.operation === "string" && registry.has(request.operation);
            const operation = knownOperation ? request.operation : "unknown";
            const riskLevel = knownOperation ? registry.get(operation) : "high";
            const actorId = safeActorId(auth.actorId);
            let authAgeMs = null;
            let remainingFreshnessMs = 0;
            let freshnessBucket = "unknown";
            let verifiedFactorType = null;

            function finish(reasonCode, decision = "deny") {
                const result = Object.freeze({
                    actorId: auth.verified === true ? actorId : null,
                    operation,
                    riskLevel,
                    decision,
                    reasonCode,
                    authAgeMs,
                    remainingFreshnessMs,
                    freshnessBucket,
                    verifiedFactorType
                });
                emittedDecisions.add(result);
                return result;
            }

            if (invalidReason) return finish(invalidReason);
            if (!actorId) return finish("MISSING_ACTOR");
            if (auth.platformAdmin !== true) return finish("NOT_PLATFORM_ADMIN");
            // This assertion must come from a trusted verification adapter, not a request body.
            if (auth.verified !== true) return finish("UNVERIFIED_AUTH");
            if (!knownOperation) return finish("UNKNOWN_OPERATION");

            let nowMs;
            try {
                nowMs = clock();
            } catch {
                return finish("INVALID_CLOCK");
            }
            if (!isTimestamp(nowMs)) return finish("INVALID_CLOCK");

            const authTime = auth.authenticatedAtMs;
            let freshnessReason = null;
            if (authTime === undefined || authTime === null) {
                freshnessReason = "AUTH_TIME_MISSING";
            } else if (!isTimestamp(authTime) || authTime > nowMs) {
                freshnessBucket = "invalid";
                freshnessReason = "AUTH_TIME_INVALID";
            } else {
                authAgeMs = nowMs - authTime;
                remainingFreshnessMs = Math.max(0, policy.elevatedSessionTtlMs - authAgeMs);
                freshnessBucket = remainingFreshnessMs > 0 ? "recent" : "expired";
                if (remainingFreshnessMs === 0) freshnessReason = "AUTH_EXPIRED";
            }

            // Low risk needs verified admin identity; medium additionally needs recent re-auth.
            if (riskLevel !== "low" && freshnessReason) return finish(freshnessReason);

            if (Array.isArray(auth.verifiedFactors)) {
                const factor = auth.verifiedFactors.find(item =>
                    isRecord(item) && item.verified === true &&
                    policy.requiredFactorTypes.includes(item.type) &&
                    item.actorId === actorId && item.authenticatedAtMs === authTime &&
                    isTimestamp(authTime) && isTimestamp(item.verifiedAtMs) &&
                    item.verifiedAtMs >= authTime && item.verifiedAtMs <= nowMs &&
                    nowMs - item.verifiedAtMs < policy.elevatedSessionTtlMs
                );
                if (factor) verifiedFactorType = factor.type;
            }
            if (riskLevel === "high" && !verifiedFactorType) {
                return finish("VERIFIED_FACTOR_REQUIRED");
            }
            return finish("POLICY_SATISFIED", "allow");
        }
    });
}

function buildStepUpAuditMetadata(result) {
    // Only frozen decisions issued here are accepted; a raw/hydrated payload cannot be logged.
    if (!emittedDecisions.has(result)) {
        throw new TypeError("Platform step-up audit doğrulanmış karar gerektiriyor.");
    }
    return Object.freeze({
        actorId: result.actorId,
        operation: result.operation,
        riskLevel: result.riskLevel,
        decision: result.decision,
        reasonCode: result.reasonCode,
        authAgeMs: result.authAgeMs,
        freshnessBucket: result.freshnessBucket,
        verifiedFactorType: result.verifiedFactorType
    });
}

module.exports = {
    PLATFORM_ADMIN_OPERATION_RISKS,
    createPlatformAdminStepUpPolicy,
    buildStepUpAuditMetadata
};
