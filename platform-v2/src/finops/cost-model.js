const BYTES_PER_GIB = 1024 ** 3;
const HOURS_PER_MONTH = 730;

function safeMetric(value, label) {
    const number = Number(value ?? 0);

    if (!Number.isFinite(number) || number < 0) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return number;
}

function round(value, digits = 6) {
    const factor = 10 ** digits;
    return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sumSharedMonthlyCosts(costs) {
    if (!costs || typeof costs !== "object" || Array.isArray(costs)) {
        throw new TypeError("Shared cost nesne olmalı.");
    }

    return round(Object.entries(costs).reduce((sum, [key, value]) => {
        return sum + safeMetric(value, `Shared cost ${key}`);
    }, 0));
}

function allocateSharedCosts({ tenantUsages, totalSharedCost }) {
    if (!Array.isArray(tenantUsages)) {
        throw new TypeError("Shared cost tenant usage listesi gerekli.");
    }

    const safeTotal = safeMetric(totalSharedCost, "Shared cost total");
    const tenants = tenantUsages.map(item => ({
        tenantId: String(item?.tenantId ?? "").trim(),
        requestCount: safeMetric(item?.requestCount, "Shared cost requestCount")
    })).sort((left, right) => left.tenantId.localeCompare(right.tenantId));

    if (tenants.some(item => !/^[a-z0-9][a-z0-9-]{2,62}$/.test(item.tenantId))) {
        throw new TypeError("Shared cost tenantId geçersiz.");
    }
    if (new Set(tenants.map(item => item.tenantId)).size !== tenants.length) {
        throw new TypeError("Shared cost tenant listesi tekrar içeriyor.");
    }

    if (tenants.length === 0) {
        return Object.freeze({
            allocations: Object.freeze({}),
            allocatedTotal: 0,
            unattributedCost: safeTotal
        });
    }

    const totalRequests = tenants.reduce((sum, item) => sum + item.requestCount, 0);
    const allocations = {};
    let allocated = 0;

    tenants.forEach((item, index) => {
        const isLast = index === tenants.length - 1;
        const weight = totalRequests > 0
            ? item.requestCount / totalRequests
            : 1 / tenants.length;
        const amount = isLast ? round(safeTotal - allocated) : round(safeTotal * weight);
        allocations[item.tenantId] = amount;
        allocated = round(allocated + amount);
    });

    return Object.freeze({
        allocations: Object.freeze(allocations),
        allocatedTotal: allocated,
        unattributedCost: round(Math.max(0, safeTotal - allocated))
    });
}

function estimateTenantCost({
    tenantId,
    usage,
    rateCard,
    allocatedSharedCost = 0,
    monthlyRevenueReference = null,
    currency,
    thresholds
}) {
    const providerUsage = usage?.providerUsage || {};
    const requestCount = safeMetric(usage?.requestCount, "FinOps requestCount");
    const costs = {
        requests: requestCount / 100_000 * safeMetric(rateCard.requestPer100000, "Request rate"),
        firestoreReads: safeMetric(providerUsage.firestoreReads, "Firestore reads") / 100_000 *
            safeMetric(rateCard.firestoreReadPer100000, "Firestore read rate"),
        firestoreWrites: safeMetric(providerUsage.firestoreWrites, "Firestore writes") / 100_000 *
            safeMetric(rateCard.firestoreWritePer100000, "Firestore write rate"),
        renderCompute: safeMetric(providerUsage.renderComputeMs, "Render compute") / 3_600_000 *
            safeMetric(rateCard.renderComputeHour, "Render compute rate"),
        r2Storage: safeMetric(providerUsage.r2StorageByteHours, "R2 storage") /
            (BYTES_PER_GIB * HOURS_PER_MONTH) * safeMetric(rateCard.r2StorageGbMonth, "R2 storage rate"),
        r2Bandwidth: safeMetric(providerUsage.r2BandwidthBytes, "R2 bandwidth") /
            BYTES_PER_GIB * safeMetric(rateCard.r2BandwidthGb, "R2 bandwidth rate"),
        backupStorage: safeMetric(providerUsage.backupStorageByteHours, "Backup storage") /
            (BYTES_PER_GIB * HOURS_PER_MONTH) * safeMetric(rateCard.backupStorageGbMonth, "Backup storage rate")
    };

    for (const key of Object.keys(costs)) {
        costs[key] = round(costs[key]);
    }

    const attributableCost = round(Object.values(costs).reduce((sum, value) => sum + value, 0));
    const sharedCost = round(safeMetric(allocatedSharedCost, "Allocated shared cost"));
    const estimatedMonthlyTechnicalCost = round(attributableCost + sharedCost);
    const revenue = monthlyRevenueReference === null
        ? null
        : safeMetric(monthlyRevenueReference, "Monthly revenue reference");
    const ratio = revenue && revenue > 0 ? estimatedMonthlyTechnicalCost / revenue : null;
    let status = "unknown";

    if (ratio !== null) {
        status = ratio <= thresholds.warningRatio
            ? "normal"
            : ratio <= thresholds.criticalRatio
                ? "warning"
                : "critical";
    }

    return Object.freeze({
        tenantId,
        currency,
        attributableCost,
        allocatedSharedCost: sharedCost,
        sharedUnattributedCost: 0,
        estimatedMonthlyTechnicalCost,
        monthlyRevenueReference: revenue,
        estimatedContributionMargin: revenue === null
            ? null
            : round(revenue - estimatedMonthlyTechnicalCost),
        infraRevenueRatio: ratio,
        status,
        costBreakdown: Object.freeze(costs)
    });
}

function detectCostAnomaly({ currentCost, baselineCost, config }) {
    const current = safeMetric(currentCost, "Anomaly current cost");
    const baseline = safeMetric(baselineCost, "Anomaly baseline cost");
    const increase = current - baseline;
    const multiplier = baseline > 0 ? current / baseline : null;
    const anomalous = increase >= config.minimumIncrease &&
        (baseline === 0 ? current >= config.minimumIncrease : multiplier >= config.multiplier);

    return Object.freeze({
        anomalous,
        currentCost: current,
        baselineCost: baseline,
        increase: round(increase),
        multiplier
    });
}

module.exports = {
    BYTES_PER_GIB,
    HOURS_PER_MONTH,
    allocateSharedCosts,
    detectCostAnomaly,
    estimateTenantCost,
    sumSharedMonthlyCosts
};
