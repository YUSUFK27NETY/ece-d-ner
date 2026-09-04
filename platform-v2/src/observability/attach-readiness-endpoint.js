function attachReadinessEndpoint({
    app,
    checkReadiness,
    service = "platform-v2-admin-api"
}) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Readiness endpoint için Express app gerekli.");
    }

    if (typeof checkReadiness !== "function") {
        throw new TypeError("Readiness endpoint için checkReadiness gerekli.");
    }

    const safeService = String(service ?? "").trim();
    if (!/^[a-z0-9][a-z0-9._-]{2,120}$/i.test(safeService)) {
        throw new TypeError("Readiness service adı geçersiz.");
    }

    app.get("/ready", async (req, res) => {
        try {
            const result = await checkReadiness();
            const ready = result?.ready === true;

            return res.status(ready ? 200 : 503).json({
                success: ready,
                service: safeService,
                status: ready ? "ready" : "not_ready",
                checkedAt: result?.checkedAt ?? null,
                checks: result?.checks ?? {}
            });
        } catch {
            return res.status(503).json({
                success: false,
                service: safeService,
                status: "not_ready",
                checkedAt: null,
                checks: {}
            });
        }
    });

    return app;
}

module.exports = {
    attachReadinessEndpoint
};
