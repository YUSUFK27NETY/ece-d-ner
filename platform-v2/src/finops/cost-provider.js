function assertCostProvider(provider) {
    for (const method of ["getRateCard", "getSharedMonthlyCosts"]) {
        if (!provider || typeof provider[method] !== "function") {
            throw new TypeError(`Cost provider ${method} metodunu uygulamalı.`);
        }
    }

    return provider;
}

function createConfigCostProvider({ finopsConfig }) {
    if (!finopsConfig?.rates || !finopsConfig?.sharedMonthlyCosts) {
        throw new TypeError("FinOps provider config gerekli.");
    }

    return Object.freeze({
        async getRateCard() {
            return finopsConfig.rates;
        },

        async getSharedMonthlyCosts() {
            return finopsConfig.sharedMonthlyCosts;
        }
    });
}

module.exports = {
    assertCostProvider,
    createConfigCostProvider
};
