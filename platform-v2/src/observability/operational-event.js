const { requireTenantId } = require("../tenant/tenant-id");

const LEVELS = new Set(["debug", "info", "warn", "error"]);

function cleanString(value, maxLength = 160) {
    const text = String(value ?? "").trim();
    if (!text) return null;
    return text.replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}

function buildOperationalEvent({
    level = "info",
    event,
    operation = null,
    requestId = null,
    tenantId = null,
    status = null,
    code = null,
    durationMs = null,
    timestamp = new Date()
}) {
    const safeLevel = String(level ?? "").toLowerCase();
    if (!LEVELS.has(safeLevel)) throw new TypeError("Operational event level geçersiz.");

    const safeEvent = cleanString(event, 120);
    if (!safeEvent || !/^[A-Za-z0-9._:-]+$/.test(safeEvent)) throw new TypeError("Operational event adı geçersiz.");

    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    if (Number.isNaN(date.getTime())) throw new TypeError("Operational event timestamp geçersiz.");

    const output = {
        timestamp: date.toISOString(),
        level: safeLevel,
        event: safeEvent
    };

    const optional = {
        operation: cleanString(operation, 120),
        requestId: cleanString(requestId, 128),
        status: cleanString(status, 80),
        code: cleanString(code, 80)
    };
    for (const [key, value] of Object.entries(optional)) if (value) output[key] = value;

    if (tenantId !== null && tenantId !== undefined && String(tenantId).trim()) {
        output.tenantId = requireTenantId(tenantId);
    }

    if (durationMs !== null && durationMs !== undefined) {
        const duration = Number(durationMs);
        if (!Number.isFinite(duration) || duration < 0 || duration > 86_400_000) throw new TypeError("Operational event durationMs geçersiz.");
        output.durationMs = Math.round(duration);
    }

    return Object.freeze(output);
}

function createJsonOperationalLogger({ sink = console } = {}) {
    if (!sink || typeof sink.log !== "function" || typeof sink.error !== "function") {
        throw new TypeError("Operational logger sink log/error metodlarını uygulamalı.");
    }

    return Object.freeze({
        write(eventInput) {
            const event = buildOperationalEvent(eventInput);
            const line = JSON.stringify(event);
            if (event.level === "error") sink.error(line);
            else sink.log(line);
            return event;
        }
    });
}

module.exports = {
    LEVELS,
    buildOperationalEvent,
    createJsonOperationalLogger
};
