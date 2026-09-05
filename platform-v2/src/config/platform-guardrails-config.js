const { FEATURE_CATALOG } = require("../tenant/feature-catalog");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    DEFAULT_PLATFORM_STEP_UP_CONFIG,
    normalizePlatformStepUpConfig
} = require("./platform-step-up-config");
const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG,
    normalizePlatformSecurityAlertsConfig
} = require("./platform-security-alerts-config");
const {
    DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG,
    normalizePlatformSecretLifecycleConfig
} = require("./platform-secret-lifecycle-config");
const {
    DEFAULT_PLATFORM_INCIDENTS_CONFIG,
    normalizePlatformIncidentsConfig
} = require("./platform-incidents-config");
const {
    DEFAULT_PLATFORM_BREAK_GLASS_CONFIG,
    normalizePlatformBreakGlassConfig
} = require("./platform-break-glass-config");

const DEFAULT_PLATFORM_GUARDRAILS_CONFIG = Object.freeze({
    telemetry: Object.freeze({
        retentionDays: 400
    }),
    rateLimits: Object.freeze({
        public: Object.freeze({
            sustainedWindowMs: 60_000,
            sustainedMax: 120,
            burstWindowMs: 10_000,
            burstMax: 30
        }),
        adminTenant: Object.freeze({
            sustainedWindowMs: 15 * 60_000,
            sustainedMax: 180,
            burstWindowMs: 60_000,
            burstMax: 60
        })
    }),
    security: Object.freeze({
        authFailureWindowMs: 5 * 60_000,
        authFailureThreshold: 5,
        signalListLimit: 20,
        stepUp: DEFAULT_PLATFORM_STEP_UP_CONFIG,
        alerts: DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG,
        secretLifecycle: DEFAULT_PLATFORM_SECRET_LIFECYCLE_CONFIG,
        incidents: DEFAULT_PLATFORM_INCIDENTS_CONFIG,
        breakGlass: DEFAULT_PLATFORM_BREAK_GLASS_CONFIG
    }),
    plans: Object.freeze({
        default: Object.freeze({
            allowedFeatures: "*",
            softRequestLimit: null,
            warningThreshold: 0.8,
            dedicatedReviewThreshold: 1
        })
    }),
    tenantOverrides: Object.freeze({}),
    finops: Object.freeze({
        currency: "TRY",
        defaultMonthlyRevenue: 2000,
        thresholds: Object.freeze({
            warningRatio: 0.10,
            criticalRatio: 0.15
        }),
        anomaly: Object.freeze({
            multiplier: 2,
            minimumIncrease: 100
        }),
        rates: Object.freeze({
            requestPer100000: 0,
            firestoreReadPer100000: 0,
            firestoreWritePer100000: 0,
            renderComputeHour: 0,
            r2StorageGbMonth: 0,
            r2BandwidthGb: 0,
            backupStorageGbMonth: 0
        }),
        sharedMonthlyCosts: Object.freeze({
            renderCompute: 0,
            other: 0
        })
    })
});

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function mergeConfig(base, override) {
    if (!isPlainObject(override)) {
        return override === undefined ? base : override;
    }

    const output = { ...(isPlainObject(base) ? base : {}) };

    for (const [key, value] of Object.entries(override)) {
        if (new Set(["__proto__", "prototype", "constructor"]).has(key)) {
            throw new TypeError("Platform guardrails config güvenli olmayan alan içeriyor.");
        }
        output[key] = isPlainObject(value)
            ? mergeConfig(output[key], value)
            : value;
    }

    return output;
}

function assertKeys(value, allowed, label) {
    if (!isPlainObject(value)) {
        throw new TypeError(`${label} nesne olmalı.`);
    }

    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new TypeError(`${label} bilinmeyen alan içeriyor.`);
        }
    }
}

function requireInteger(value, label, min, max) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < min || number > max) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return number;
}

function requireNumber(value, label, min, max) {
    const number = Number(value);

    if (!Number.isFinite(number) || number < min || number > max) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return number;
}

function normalizeAllowedFeatures(value, label) {
    if (value === "*") {
        return "*";
    }

    if (!Array.isArray(value) || value.length > Object.keys(FEATURE_CATALOG).length) {
        throw new TypeError(`${label} geçersiz.`);
    }

    const output = [];

    for (const feature of value) {
        const key = String(feature ?? "").trim();

        if (!(key in FEATURE_CATALOG) || output.includes(key)) {
            throw new TypeError(`${label} geçersiz.`);
        }

        output.push(key);
    }

    return Object.freeze(output.sort());
}

function normalizePlanPolicy(input, label, { partial = false } = {}) {
    assertKeys(input, new Set([
        "allowedFeatures",
        "softRequestLimit",
        "warningThreshold",
        "dedicatedReviewThreshold",
        "monthlyRevenueReference"
    ]), label);

    const output = {};

    if (!partial || input.allowedFeatures !== undefined) {
        output.allowedFeatures = normalizeAllowedFeatures(
            input.allowedFeatures,
            `${label} allowedFeatures`
        );
    }

    if (!partial || input.softRequestLimit !== undefined) {
        output.softRequestLimit = input.softRequestLimit === null
            ? null
            : requireInteger(input.softRequestLimit, `${label} softRequestLimit`, 1, 1_000_000_000);
    }

    if (!partial || input.warningThreshold !== undefined) {
        output.warningThreshold = requireNumber(
            input.warningThreshold,
            `${label} warningThreshold`,
            0.01,
            1
        );
    }

    if (!partial || input.dedicatedReviewThreshold !== undefined) {
        output.dedicatedReviewThreshold = requireNumber(
            input.dedicatedReviewThreshold,
            `${label} dedicatedReviewThreshold`,
            1,
            100
        );
    }

    if (input.monthlyRevenueReference !== undefined) {
        output.monthlyRevenueReference = input.monthlyRevenueReference === null
            ? null
            : requireNumber(
                input.monthlyRevenueReference,
                `${label} monthlyRevenueReference`,
                0.01,
                1_000_000_000
            );
    }

    if (
        output.warningThreshold !== undefined &&
        output.dedicatedReviewThreshold !== undefined &&
        output.warningThreshold > output.dedicatedReviewThreshold
    ) {
        throw new TypeError(`${label} threshold sırası geçersiz.`);
    }

    return Object.freeze(output);
}

function normalizeRatePolicy(input, label) {
    assertKeys(input, new Set([
        "sustainedWindowMs",
        "sustainedMax",
        "burstWindowMs",
        "burstMax"
    ]), label);

    const policy = {
        sustainedWindowMs: requireInteger(input.sustainedWindowMs, `${label} sustainedWindowMs`, 1000, 86_400_000),
        sustainedMax: requireInteger(input.sustainedMax, `${label} sustainedMax`, 1, 10_000_000),
        burstWindowMs: requireInteger(input.burstWindowMs, `${label} burstWindowMs`, 100, 3_600_000),
        burstMax: requireInteger(input.burstMax, `${label} burstMax`, 1, 1_000_000)
    };

    if (policy.burstWindowMs > policy.sustainedWindowMs) {
        throw new TypeError(`${label} pencere sırası geçersiz.`);
    }

    return Object.freeze(policy);
}

function normalizePlatformGuardrailsConfig(input) {
    assertKeys(input, new Set([
        "telemetry",
        "rateLimits",
        "security",
        "plans",
        "tenantOverrides",
        "finops"
    ]), "Platform guardrails config");

    assertKeys(input.telemetry, new Set(["retentionDays"]), "Telemetry config");
    assertKeys(input.rateLimits, new Set(["public", "adminTenant"]), "Rate limit config");
    assertKeys(input.security, new Set([
        "authFailureWindowMs",
        "authFailureThreshold",
        "signalListLimit",
        "stepUp",
        "alerts",
        "secretLifecycle",
        "incidents",
        "breakGlass"
    ]), "Security config");
    assertKeys(input.finops, new Set([
        "currency",
        "defaultMonthlyRevenue",
        "thresholds",
        "anomaly",
        "rates",
        "sharedMonthlyCosts"
    ]), "FinOps config");
    assertKeys(input.finops.thresholds, new Set([
        "warningRatio",
        "criticalRatio"
    ]), "FinOps threshold config");
    assertKeys(input.finops.anomaly, new Set([
        "multiplier",
        "minimumIncrease"
    ]), "FinOps anomaly config");
    assertKeys(input.finops.rates, new Set([
        "requestPer100000",
        "firestoreReadPer100000",
        "firestoreWritePer100000",
        "renderComputeHour",
        "r2StorageGbMonth",
        "r2BandwidthGb",
        "backupStorageGbMonth"
    ]), "FinOps rate config");
    assertKeys(input.finops.sharedMonthlyCosts, new Set([
        "renderCompute",
        "other"
    ]), "FinOps shared cost config");

    const plans = {};
    for (const [plan, policy] of Object.entries(input.plans)) {
        if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(plan)) {
            throw new TypeError("Plan config anahtarı geçersiz.");
        }
        plans[plan] = normalizePlanPolicy(policy, `Plan ${plan}`);
    }
    if (!plans.default) {
        throw new TypeError("Default plan config gerekli.");
    }

    const tenantOverrides = {};
    for (const [tenantId, policy] of Object.entries(input.tenantOverrides)) {
        const safeTenantId = requireTenantId(tenantId);
        tenantOverrides[safeTenantId] = normalizePlanPolicy(
            policy,
            "Tenant override",
            { partial: true }
        );
    }

    const warningRatio = requireNumber(
        input.finops.thresholds.warningRatio,
        "FinOps warningRatio",
        0,
        100
    );
    const criticalRatio = requireNumber(
        input.finops.thresholds.criticalRatio,
        "FinOps criticalRatio",
        0,
        100
    );
    if (warningRatio > criticalRatio) {
        throw new TypeError("FinOps threshold sırası geçersiz.");
    }

    const rates = {};
    for (const [key, value] of Object.entries(input.finops.rates)) {
        rates[key] = requireNumber(value, `FinOps rate ${key}`, 0, 1_000_000_000);
    }

    const sharedMonthlyCosts = {};
    for (const [key, value] of Object.entries(input.finops.sharedMonthlyCosts)) {
        sharedMonthlyCosts[key] = requireNumber(value, `FinOps shared cost ${key}`, 0, 1_000_000_000);
    }

    const currency = String(input.finops.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
        throw new TypeError("FinOps currency geçersiz.");
    }

    return Object.freeze({
        telemetry: Object.freeze({
            retentionDays: requireInteger(input.telemetry.retentionDays, "Telemetry retentionDays", 1, 3650)
        }),
        rateLimits: Object.freeze({
            public: normalizeRatePolicy(input.rateLimits.public, "Public rate limit"),
            adminTenant: normalizeRatePolicy(input.rateLimits.adminTenant, "Admin tenant rate limit")
        }),
        security: Object.freeze({
            authFailureWindowMs: requireInteger(
                input.security.authFailureWindowMs,
                "Security authFailureWindowMs",
                1000,
                86_400_000
            ),
            authFailureThreshold: requireInteger(
                input.security.authFailureThreshold,
                "Security authFailureThreshold",
                2,
                10_000
            ),
            stepUp: normalizePlatformStepUpConfig(input.security.stepUp),
            alerts: normalizePlatformSecurityAlertsConfig(input.security.alerts),
            secretLifecycle: normalizePlatformSecretLifecycleConfig(input.security.secretLifecycle),
            incidents: normalizePlatformIncidentsConfig(input.security.incidents),
            breakGlass: normalizePlatformBreakGlassConfig(input.security.breakGlass),
            signalListLimit: requireInteger(
                input.security.signalListLimit,
                "Security signalListLimit",
                1,
                200
            )
        }),
        plans: Object.freeze(plans),
        tenantOverrides: Object.freeze(tenantOverrides),
        finops: Object.freeze({
            currency,
            defaultMonthlyRevenue: input.finops.defaultMonthlyRevenue === null
                ? null
                : requireNumber(
                    input.finops.defaultMonthlyRevenue,
                    "FinOps defaultMonthlyRevenue",
                    0.01,
                    1_000_000_000
                ),
            thresholds: Object.freeze({ warningRatio, criticalRatio }),
            anomaly: Object.freeze({
                multiplier: requireNumber(input.finops.anomaly.multiplier, "FinOps anomaly multiplier", 1.01, 1000),
                minimumIncrease: requireNumber(input.finops.anomaly.minimumIncrease, "FinOps anomaly minimumIncrease", 0, 1_000_000_000)
            }),
            rates: Object.freeze(rates),
            sharedMonthlyCosts: Object.freeze(sharedMonthlyCosts)
        })
    });
}

function loadPlatformGuardrailsConfig(raw = process.env.PLATFORM_GUARDRAILS_CONFIG_JSON) {
    let overrides = {};

    if (raw !== undefined && raw !== null && String(raw).trim()) {
        try {
            overrides = JSON.parse(String(raw));
        } catch {
            throw new TypeError("PLATFORM_GUARDRAILS_CONFIG_JSON geçerli JSON olmalı.");
        }

        if (!isPlainObject(overrides)) {
            throw new TypeError("PLATFORM_GUARDRAILS_CONFIG_JSON nesne olmalı.");
        }
    }

    return normalizePlatformGuardrailsConfig(
        mergeConfig(DEFAULT_PLATFORM_GUARDRAILS_CONFIG, overrides)
    );
}

module.exports = {
    DEFAULT_PLATFORM_GUARDRAILS_CONFIG,
    loadPlatformGuardrailsConfig,
    normalizePlatformGuardrailsConfig
};
