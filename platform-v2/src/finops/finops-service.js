const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const { assertCostProvider } = require("./cost-provider");
const {
    allocateSharedCosts,
    detectCostAnomaly,
    estimateTenantCost,
    sumSharedMonthlyCosts
} = require("./cost-model");

function previousMonth(date) {
    const value = date instanceof Date ? new Date(date) : new Date(date);
    if (Number.isNaN(value.getTime())) throw new TypeError("FinOps tarih geçersiz.");
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() - 1, 1));
}

function createFinOpsService({
    config,
    costProvider,
    usageTelemetry,
    tenantRegistry,
    securitySignals = null
}) {
    const provider = assertCostProvider(costProvider);

    if (!config?.finops || !config?.plans?.default) {
        throw new TypeError("FinOps config gerekli.");
    }
    if (!usageTelemetry || typeof usageTelemetry.getAggregate !== "function") {
        throw new TypeError("FinOps usage telemetry gerekli.");
    }
    if (!tenantRegistry || typeof tenantRegistry.list !== "function") {
        throw new TypeError("FinOps tenant registry gerekli.");
    }

    async function buildPortfolio({ context, at = new Date() }) {
        if (context?.role !== "platform_admin") {
            const error = new Error("Portfolio cost görünümü Platform Admin gerektirir.");
            error.code = "PERMISSION_DENIED";
            throw error;
        }

        const tenants = await tenantRegistry.list({ limit: 200 });
        const [rateCard, sharedCosts] = await Promise.all([
            provider.getRateCard({ at }),
            provider.getSharedMonthlyCosts({ at })
        ]);
        const priorAt = previousMonth(at);
        const currentUsage = await Promise.all(tenants.map(async tenant => ({
            tenant,
            usage: await usageTelemetry.getAggregate({
                context,
                tenantId: tenant.tenantId,
                period: "monthly",
                at
            })
        })));
        const previousUsage = await Promise.all(tenants.map(async tenant => ({
            tenant,
            usage: await usageTelemetry.getAggregate({
                context,
                tenantId: tenant.tenantId,
                period: "monthly",
                at: priorAt
            })
        })));
        const totalSharedCost = sumSharedMonthlyCosts(sharedCosts);
        const currentAllocation = allocateSharedCosts({
            totalSharedCost,
            tenantUsages: currentUsage.map(item => ({
                tenantId: item.tenant.tenantId,
                requestCount: item.usage.requestCount
            }))
        });
        const previousAllocation = allocateSharedCosts({
            totalSharedCost,
            tenantUsages: previousUsage.map(item => ({
                tenantId: item.tenant.tenantId,
                requestCount: item.usage.requestCount
            }))
        });
        const previousByTenant = new Map(previousUsage.map(item => [item.tenant.tenantId, item]));

        const estimates = currentUsage.map(item => {
            const tenantId = requireTenantId(item.tenant.tenantId);
            const plan = String(item.tenant.plan || "default").trim().toLowerCase();
            const planPolicy = Object.prototype.hasOwnProperty.call(config.plans, plan)
                ? config.plans[plan]
                : config.plans.default;
            const tenantPolicy = Object.prototype.hasOwnProperty.call(config.tenantOverrides, tenantId)
                ? config.tenantOverrides[tenantId]
                : {};
            const revenue = tenantPolicy.monthlyRevenueReference ??
                planPolicy.monthlyRevenueReference ??
                config.finops.defaultMonthlyRevenue;
            const current = estimateTenantCost({
                tenantId,
                usage: item.usage,
                rateCard,
                allocatedSharedCost: currentAllocation.allocations[tenantId] || 0,
                monthlyRevenueReference: revenue,
                currency: config.finops.currency,
                thresholds: config.finops.thresholds
            });
            const previous = estimateTenantCost({
                tenantId,
                usage: previousByTenant.get(tenantId)?.usage,
                rateCard,
                allocatedSharedCost: previousAllocation.allocations[tenantId] || 0,
                monthlyRevenueReference: revenue,
                currency: config.finops.currency,
                thresholds: config.finops.thresholds
            });

            return Object.freeze({
                ...current,
                anomaly: detectCostAnomaly({
                    currentCost: current.estimatedMonthlyTechnicalCost,
                    baselineCost: previous.estimatedMonthlyTechnicalCost,
                    config: config.finops.anomaly
                })
            });
        }).sort((left, right) =>
            right.estimatedMonthlyTechnicalCost - left.estimatedMonthlyTechnicalCost ||
            left.tenantId.localeCompare(right.tenantId)
        );

        return Object.freeze({
            currency: config.finops.currency,
            tenantCount: tenants.length,
            totalSharedCost,
            allocatedSharedCost: currentAllocation.allocatedTotal,
            sharedUnattributedCost: currentAllocation.unattributedCost,
            estimates: Object.freeze(estimates)
        });
    }

    return Object.freeze({
        async getTenantEstimate({ context, tenantId, at = new Date() }) {
            const safeTenantId = requireTenantId(tenantId);
            authorizeTenantAction({
                context,
                tenantId: safeTenantId,
                permission: "tenant.cost.read"
            });

            if (context.role !== "platform_admin") {
                const tenant = await tenantRegistry.getById(safeTenantId);
                if (!tenant) {
                    const error = new Error("İşletme bulunamadı.");
                    error.code = "TENANT_NOT_FOUND";
                    throw error;
                }
                const [usage, rateCard] = await Promise.all([
                    usageTelemetry.getAggregate({ context, tenantId: safeTenantId, period: "monthly", at }),
                    provider.getRateCard({ at })
                ]);
                const plan = String(tenant.plan || "default").trim().toLowerCase();
                const planPolicy = Object.prototype.hasOwnProperty.call(config.plans, plan)
                    ? config.plans[plan]
                    : config.plans.default;
                const tenantPolicy = Object.prototype.hasOwnProperty.call(config.tenantOverrides, safeTenantId)
                    ? config.tenantOverrides[safeTenantId]
                    : {};
                return estimateTenantCost({
                    tenantId: safeTenantId,
                    usage,
                    rateCard,
                    allocatedSharedCost: 0,
                    monthlyRevenueReference: tenantPolicy.monthlyRevenueReference ??
                        planPolicy.monthlyRevenueReference ??
                        config.finops.defaultMonthlyRevenue,
                    currency: config.finops.currency,
                    thresholds: config.finops.thresholds
                });
            }

            const portfolio = await buildPortfolio({ context, at });
            const estimate = portfolio.estimates.find(item => item.tenantId === safeTenantId);
            if (!estimate) {
                const error = new Error("İşletme bulunamadı.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }
            return estimate;
        },

        async getTopTenants({ context, limit = 10, at = new Date() }) {
            const safeLimit = Number(limit);
            if (!Number.isInteger(safeLimit) || safeLimit < 1 || safeLimit > 100) {
                throw new TypeError("FinOps top tenant limiti geçersiz.");
            }
            const portfolio = await buildPortfolio({ context, at });
            return Object.freeze({
                ...portfolio,
                estimates: Object.freeze(portfolio.estimates.slice(0, safeLimit))
            });
        },

        async evaluateAndSignal({ context, at = new Date(), requestId = null }) {
            const portfolio = await buildPortfolio({ context, at });
            if (securitySignals) {
                for (const estimate of portfolio.estimates) {
                    if (estimate.anomaly.anomalous) {
                        await securitySignals.emit({
                            tenantId: estimate.tenantId,
                            type: "cost_anomaly",
                            severity: "warning",
                            requestId,
                            operation: "finops.monthly.evaluate",
                            metadata: {
                                costRatio: estimate.infraRevenueRatio ?? 0,
                                reasonCode: "MONTH_OVER_MONTH_INCREASE"
                            }
                        });
                    }
                }
            }
            return portfolio;
        }
    });
}

module.exports = {
    createFinOpsService,
    previousMonth
};
