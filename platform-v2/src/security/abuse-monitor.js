const issuedAuthAnomalyObservations = new WeakSet();

function issueAuthAnomalyObservation({ requestId, occurredAt }) {
    const observation = Object.freeze({ requestId, occurredAt });
    issuedAuthAnomalyObservations.add(observation);
    return observation;
}

function consumeAuthAnomalyObservation(observation) {
    if (!issuedAuthAnomalyObservations.has(observation)) {
        throw new TypeError("Auth anomaly issued observation gerekli.");
    }
    issuedAuthAnomalyObservations.delete(observation);
    return observation;
}

function createAbuseMonitor({
    securitySignals,
    securityOperations = null,
    windowMs,
    threshold,
    now = () => Date.now()
}) {
    if (!securitySignals || typeof securitySignals.emit !== "function") {
        throw new TypeError("Abuse monitor security signal service gerekli.");
    }
    if (!Number.isInteger(windowMs) || windowMs < 1000) {
        throw new TypeError("Abuse monitor windowMs geçersiz.");
    }
    if (!Number.isInteger(threshold) || threshold < 2) {
        throw new TypeError("Abuse monitor threshold geçersiz.");
    }
    if (typeof now !== "function") {
        throw new TypeError("Abuse monitor clock geçersiz.");
    }
    if (securityOperations && typeof securityOperations.recordAuthAnomaly !== "function") {
        throw new TypeError("Abuse monitor security operations bridge geçersiz.");
    }

    const failures = new Map();

    return Object.freeze({
        async recordDenied({
            tenantId = null,
            requestId = null,
            operation,
            statusCode
        }) {
            const safeStatus = Number(statusCode);
            if (![401, 403].includes(safeStatus)) {
                throw new TypeError("Abuse monitor yalnız 401/403 kaydeder.");
            }

            const timestamp = Number(now());
            if (!Number.isFinite(timestamp)) {
                throw new TypeError("Abuse monitor clock geçersiz.");
            }

            const key = `${tenantId || "platform"}:${safeStatus}:${operation}`;
            const recent = (failures.get(key) || [])
                .filter(item => timestamp - item <= windowMs);
            recent.push(timestamp);
            failures.set(key, recent);

            if (recent.length !== threshold) {
                return null;
            }

            const signalInput = {
                tenantId,
                type: safeStatus === 401 ? "repeated_unauthorized" : "forbidden",
                severity: "warning",
                requestId,
                operation,
                count: recent.length,
                metadata: {
                    statusCode: safeStatus,
                    threshold
                },
                now: new Date(timestamp)
            };
            const signalPromise = Promise.resolve().then(() =>
                securitySignals.emit(signalInput)
            );
            const shouldRecordCentralAuthAnomaly = securityOperations &&
                tenantId === null && operation === "platform.admin.auth";
            const centralPromise = shouldRecordCentralAuthAnomaly
                ? Promise.resolve().then(() => securityOperations.recordAuthAnomaly(
                    issueAuthAnomalyObservation({
                        requestId,
                        occurredAt: new Date(timestamp).toISOString()
                    })
                ))
                : Promise.resolve(null);
            const [signalResult, centralResult] = await Promise.allSettled([
                signalPromise,
                centralPromise
            ]);

            if (centralResult.status === "rejected") {
                console.error("Central auth anomaly security alert kaydı başarısız.");
            }
            if (signalResult.status === "rejected") throw signalResult.reason;
            return signalResult.value;
        },

        async recordTenantBoundaryViolation({
            tenantId,
            requestId = null,
            operation
        }) {
            return securitySignals.emit({
                tenantId,
                type: "tenant_boundary_violation",
                severity: "critical",
                requestId,
                operation,
                metadata: {
                    reasonCode: "TENANT_SCOPE_MISMATCH"
                },
                now: new Date(Number(now()))
            });
        }
    });
}

module.exports = {
    createAbuseMonitor,
    consumeAuthAnomalyObservation
};
