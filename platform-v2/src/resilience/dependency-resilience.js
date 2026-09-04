const DEPENDENCY_STATUSES = new Set(["healthy", "degraded", "unavailable"]);

function safeDependency(value) {
    const dependency = String(value ?? "").trim().toLowerCase();
    if (!/^[a-z][a-z0-9._-]{1,63}$/.test(dependency)) {
        throw new TypeError("Dependency adı geçersiz.");
    }
    return dependency;
}

function safeDate(now) {
    const value = now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        throw new TypeError("Dependency resilience clock geçersiz.");
    }
    return value;
}

async function withTimeout(operation, timeoutMs) {
    let timer;
    try {
        return await Promise.race([
            Promise.resolve().then(operation),
            new Promise((resolve, reject) => {
                timer = setTimeout(() => {
                    const error = new Error("Dependency timeout.");
                    error.code = "DEPENDENCY_TIMEOUT";
                    reject(error);
                }, timeoutMs);
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function createDependencyResilienceService({
    config,
    now = () => new Date(),
    sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    onSignal = null
}) {
    if (!config?.resilience) throw new TypeError("Dependency resilience config gerekli.");
    if (typeof sleep !== "function" || (onSignal !== null && typeof onSignal !== "function")) {
        throw new TypeError("Dependency resilience callback geçersiz.");
    }
    const policy = config.resilience;
    const states = new Map();

    function stateFor(dependency) {
        if (!states.has(dependency)) {
            states.set(dependency, {
                dependency, consecutiveFailures: 0, circuitOpenedAtMs: null,
                lastFailureAt: null, lastSuccessAt: null, lastErrorCode: null
            });
        }
        return states.get(dependency);
    }

    function statusOf(state, atMs) {
        if (state.circuitOpenedAtMs !== null && atMs - state.circuitOpenedAtMs < policy.recoveryMs) {
            return "unavailable";
        }
        return state.consecutiveFailures > 0 ? "degraded" : "healthy";
    }

    function present(state) {
        const atMs = safeDate(now).getTime();
        const status = statusOf(state, atMs);
        return Object.freeze({
            dependency: state.dependency,
            status,
            circuit: status === "unavailable" ? "open" : (state.consecutiveFailures > 0 ? "half_open" : "closed"),
            consecutiveFailures: state.consecutiveFailures,
            lastFailureAt: state.lastFailureAt,
            lastSuccessAt: state.lastSuccessAt,
            lastErrorCode: state.lastErrorCode
        });
    }

    async function signal(state, errorCode) {
        if (!onSignal) return;
        try {
            await onSignal(Object.freeze({
                dependency: state.dependency,
                status: present(state).status,
                errorCode,
                consecutiveFailures: state.consecutiveFailures
            }));
        } catch {
            // Operational signal delivery must not replace the sanitized dependency outcome.
        }
    }

    async function execute({ dependency: rawDependency, operation }) {
        const dependency = safeDependency(rawDependency);
        if (typeof operation !== "function") throw new TypeError("Dependency operation gerekli.");
        const state = stateFor(dependency);
        const startedAt = safeDate(now);
        if (statusOf(state, startedAt.getTime()) === "unavailable") {
            const error = new Error("Dependency geçici olarak kullanılamıyor.");
            error.code = "DEPENDENCY_CIRCUIT_OPEN";
            throw error;
        }
        if (state.circuitOpenedAtMs !== null) state.circuitOpenedAtMs = null;

        let lastCode = "DEPENDENCY_ERROR";
        for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
            try {
                const value = await withTimeout(operation, policy.timeoutMs);
                state.consecutiveFailures = 0;
                state.circuitOpenedAtMs = null;
                state.lastErrorCode = null;
                state.lastSuccessAt = safeDate(now).toISOString();
                return value;
            } catch (error) {
                lastCode = error?.code === "DEPENDENCY_TIMEOUT" ? "DEPENDENCY_TIMEOUT" : "DEPENDENCY_ERROR";
                state.consecutiveFailures += 1;
                state.lastErrorCode = lastCode;
                state.lastFailureAt = safeDate(now).toISOString();
                if (state.consecutiveFailures >= policy.failureThreshold) {
                    state.circuitOpenedAtMs = safeDate(now).getTime();
                    await signal(state, lastCode);
                    break;
                }
                if (attempt < policy.maxAttempts) {
                    const delay = Math.min(policy.maxBackoffMs, policy.baseBackoffMs * (2 ** (attempt - 1)));
                    await sleep(delay);
                }
            }
        }
        const error = new Error("Dependency işlemi tamamlanamadı.");
        error.code = lastCode;
        throw error;
    }

    function getStatus(dependency) {
        return present(stateFor(safeDependency(dependency)));
    }

    function getSummary() {
        const items = [...states.values()].map(present);
        const status = items.some(item => item.status === "unavailable")
            ? "unavailable"
            : (items.some(item => item.status === "degraded") ? "degraded" : "healthy");
        return Object.freeze({ status, dependencies: Object.freeze(items) });
    }

    function readiness() {
        const summary = getSummary();
        return Object.freeze({ healthy: summary.status !== "unavailable", status: summary.status });
    }

    return Object.freeze({ execute, getStatus, getSummary, readiness });
}

module.exports = {
    DEPENDENCY_STATUSES,
    withTimeout,
    createDependencyResilienceService
};
