const { breakGlassFields, breakGlassInteger, rejectBreakGlass } = require("../break-glass/break-glass-contract");

const DEFAULT_PLATFORM_BREAK_GLASS_CONFIG = Object.freeze({
    ttlMs: 15 * 60_000,
    maxActiveSessions: 1,
    requireSeparateApprover: true,
    approvalRequiredForHighRisk: true
});

function normalizePlatformBreakGlassConfig(input = DEFAULT_PLATFORM_BREAK_GLASS_CONFIG) {
    breakGlassFields(input, Object.keys(DEFAULT_PLATFORM_BREAK_GLASS_CONFIG));
    if (typeof input.requireSeparateApprover !== "boolean" || typeof input.approvalRequiredForHighRisk !== "boolean") {
        rejectBreakGlass("INVALID_BREAK_GLASS_CONFIG");
    }
    return Object.freeze({
        ttlMs: breakGlassInteger(input.ttlMs, 60_000, 3_600_000),
        maxActiveSessions: breakGlassInteger(input.maxActiveSessions, 1, 20),
        requireSeparateApprover: input.requireSeparateApprover,
        approvalRequiredForHighRisk: input.approvalRequiredForHighRisk
    });
}

module.exports = { DEFAULT_PLATFORM_BREAK_GLASS_CONFIG, normalizePlatformBreakGlassConfig };
