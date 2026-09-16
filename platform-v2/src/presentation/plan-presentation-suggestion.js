const { PRESENTATION_SCHEMA_VERSION } = require("./presentation-tier");

const PLAN_PRESENTATION_SUGGESTIONS = Object.freeze({
    starter: "starter",
    business: "business",
    business_pro: "pro"
});

function normalizePlanId(value) {
    const planId = String(value ?? "").trim().toLowerCase();
    if (planId === "business-pro" || planId === "business pro") {
        return "business_pro";
    }
    return planId;
}

function suggestPresentationForPlan(value) {
    const planId = normalizePlanId(value);
    const tier = PLAN_PRESENTATION_SUGGESTIONS[planId];
    if (!tier) return null;

    return Object.freeze({
        tier,
        version: PRESENTATION_SCHEMA_VERSION,
        source: "plan_suggestion"
    });
}

module.exports = {
    PLAN_PRESENTATION_SUGGESTIONS,
    normalizePlanId,
    suggestPresentationForPlan
};
