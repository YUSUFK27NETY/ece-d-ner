const { requireTenantId } = require("../tenant/tenant-id");

function resolveAdminOperation(req) {
    const suffix = String(req.path || "").replace(/^\/+/, "");

    if (suffix === "operations") {
        return "platform.tenant.operations.read";
    }
    if (req.method === "PATCH") {
        return "platform.tenant.update";
    }
    return "platform.tenant.read";
}

function createTenantTelemetryMiddleware({ telemetry }) {
    if (!telemetry || typeof telemetry.record !== "function") {
        throw new TypeError("Tenant telemetry service gerekli.");
    }

    return function tenantTelemetry(req, res, next) {
        let tenantId;

        try {
            tenantId = requireTenantId(req.params.tenantId);
        } catch {
            return res.status(400).json({
                success: false,
                message: "Geçersiz tenant telemetry bağlamı."
            });
        }

        const startedAt = process.hrtime.bigint();
        const operation = resolveAdminOperation(req);

        res.once("finish", () => {
            const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
            const isWrite = !new Set(["GET", "HEAD", "OPTIONS"]).has(req.method);

            Promise.resolve(telemetry.record({
                tenantId,
                operation,
                operationClass: "admin",
                statusCode: res.statusCode,
                latencyMs: durationMs,
                firestoreReads: isWrite ? 0 : 1,
                firestoreWrites: isWrite ? 1 : 0
            })).catch(() => {
                console.error("Tenant usage telemetry yazılamadı.");
            });
        });

        return next();
    };
}

module.exports = {
    createTenantTelemetryMiddleware,
    resolveAdminOperation
};
