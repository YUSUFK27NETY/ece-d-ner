const { breakGlassFields, rejectBreakGlass } = require("../break-glass/break-glass-contract");

const DEFAULT_PLATFORM_BREAK_GLASS_INTEGRATION_CONFIG = Object.freeze({ allowPlatformWithoutIncident: false });

function normalizePlatformBreakGlassIntegrationConfig(input = DEFAULT_PLATFORM_BREAK_GLASS_INTEGRATION_CONFIG) {
    breakGlassFields(input, ["allowPlatformWithoutIncident"]);
    if (typeof input.allowPlatformWithoutIncident !== "boolean") rejectBreakGlass("INVALID_BREAK_GLASS_CONFIG");
    return Object.freeze({ allowPlatformWithoutIncident: input.allowPlatformWithoutIncident });
}

module.exports = { DEFAULT_PLATFORM_BREAK_GLASS_INTEGRATION_CONFIG, normalizePlatformBreakGlassIntegrationConfig };
