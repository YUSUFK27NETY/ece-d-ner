function normalizeTimeoutMs(value = 3000) {
    const timeout = Number(value);

    if (!Number.isInteger(timeout) || timeout < 100 || timeout > 30_000) {
        throw new TypeError("Readiness timeout 100-30000ms arasında olmalı.");
    }

    return timeout;
}

async function runWithTimeout(fn, timeoutMs) {
    let timer;

    try {
        return await Promise.race([
            Promise.resolve().then(fn),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    const error = new Error("Readiness check timeout.");
                    error.code = "READINESS_TIMEOUT";
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function createReadinessChecker({ checks, timeoutMs = 3000, now = () => new Date() }) {
    const safeTimeout = normalizeTimeoutMs(timeoutMs);

    if (!checks || typeof checks !== "object" || Array.isArray(checks) ||
        Object.keys(checks).length === 0) {
        throw new TypeError("En az bir readiness check gerekli.");
    }

    const entries = Object.entries(checks).map(([name, fn]) => {
        if (!/^[a-z][a-z0-9_-]{1,63}$/.test(name) || typeof fn !== "function") {
            throw new TypeError("Readiness check adı/fonksiyonu geçersiz.");
        }

        return [name, fn];
    });

    return async function checkReadiness() {
        const results = await Promise.all(entries.map(async ([name, fn]) => {
            const startedAt = Date.now();

            try {
                const value = await runWithTimeout(fn, safeTimeout);
                const healthy = value === true || value?.healthy === true;

                return [name, {
                    status: healthy ? "ok" : "fail",
                    durationMs: Math.max(0, Date.now() - startedAt)
                }];
            } catch (error) {
                return [name, {
                    status: "fail",
                    code: String(error?.code ?? "DEPENDENCY_ERROR").slice(0, 80),
                    durationMs: Math.max(0, Date.now() - startedAt)
                }];
            }
        }));
        const checkMap = Object.fromEntries(results);
        const ready = Object.values(checkMap).every(item => item.status === "ok");
        const checkedAt = now();

        if (!(checkedAt instanceof Date) || Number.isNaN(checkedAt.getTime())) {
            throw new TypeError("Readiness clock geçersiz tarih döndürdü.");
        }

        return Object.freeze({
            ready,
            status: ready ? "ready" : "not_ready",
            checkedAt: checkedAt.toISOString(),
            checks: checkMap
        });
    };
}

module.exports = {
    normalizeTimeoutMs,
    runWithTimeout,
    createReadinessChecker
};
