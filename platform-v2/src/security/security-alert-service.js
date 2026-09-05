const {
    DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG, normalizePlatformSecurityAlertsConfig
} = require("../config/platform-security-alerts-config");
const {
    normalizeSecurityEvent, securityEventScopeKey, repeatedPolicy, buildSecurityAlert, requireTimestamp
} = require("./security-alert-model");

function createSecurityAlertService({ sink, config = DEFAULT_PLATFORM_SECURITY_ALERTS_CONFIG, clock = Date.now }) {
    const policy = normalizePlatformSecurityAlertsConfig(config);
    if (!sink || typeof sink.emit !== "function" || typeof clock !== "function") {
        throw new TypeError("Security alert sink/clock kontratı geçersiz.");
    }
    const scopes = new Map();
    const pendingAlerts = new Map();
    const retentionMs = Math.max(policy.dedupeWindowMs, policy.repeated401.windowMs, policy.repeated403.windowMs);
    let lastClockMs = 0;
    let work = Promise.resolve();

    function enqueue(action) {
        const result = work.then(action);
        work = result.catch(() => {});
        return result;
    }

    function now() {
        try {
            const value = requireTimestamp(clock());
            if (value < lastClockMs) throw new Error();
            lastClockMs = value;
            return value;
        } catch {
            throw new TypeError("Security alert clock geçersiz veya geriye gitti.");
        }
    }

    async function flushPending() {
        for (const [key, alert] of pendingAlerts) {
            try {
                await sink.emit(alert);
            } catch {
                const error = new Error("Security alert sink yazımı başarısız.");
                error.code = "SECURITY_ALERT_SINK_FAILED";
                throw error;
            }
            pendingAlerts.delete(key);
        }
    }

    return Object.freeze({
        async record(input) {
            // Snapshot and validate before async work; unknown values never reach state/sink.
            const receivedAtMs = now();
            const event = normalizeSecurityEvent(input, { nowMs: receivedAtMs });
            return enqueue(async () => {
                await flushPending();
                for (const [key, state] of scopes) {
                    if (receivedAtMs - state.lastReceivedAtMs >= retentionMs) scopes.delete(key);
                }
                const key = securityEventScopeKey(event);
                const previous = scopes.get(key);
                if (!previous && scopes.size >= policy.maxScopes) {
                    throw new Error("Security alert scope kapasitesi dolu.");
                }
                const repeated = repeatedPolicy(event.eventType, policy);
                const recent = repeated
                    ? (previous?.recent || []).filter(time => time > receivedAtMs - repeated.windowMs)
                    : [];
                if (recent.length >= policy.maxEventsPerScope) {
                    throw new Error("Security alert rolling window kapasitesi dolu.");
                }
                if (repeated) recent.push(receivedAtMs);
                const continued = previous && receivedAtMs - previous.lastReceivedAtMs < policy.dedupeWindowMs;
                const group = continued ? {
                    ...previous.group,
                    eventCount: previous.group.eventCount + 1,
                    firstSeenAt: event.occurredAt < previous.group.firstSeenAt ? event.occurredAt : previous.group.firstSeenAt,
                    lastSeenAt: event.occurredAt > previous.group.lastSeenAt ? event.occurredAt : previous.group.lastSeenAt
                } : {
                    startedAtMs: receivedAtMs,
                    eventCount: 1,
                    firstSeenAt: event.occurredAt,
                    lastSeenAt: event.occurredAt,
                    correlationId: event.correlationId,
                    lastAlert: null
                };
                if (!Number.isSafeInteger(group.eventCount)) throw new Error("Security alert count sınırı aşıldı.");
                scopes.set(key, { recent, group, lastReceivedAtMs: receivedAtMs });
                const rollingCount = repeated ? recent.length : group.eventCount;
                if (repeated && rollingCount < repeated.countThreshold && !group.lastAlert) return null;

                const alert = buildSecurityAlert({
                    event, config: policy, groupStartedAtMs: group.startedAtMs,
                    firstSeenAt: group.firstSeenAt, lastSeenAt: group.lastSeenAt,
                    eventCount: group.eventCount, rollingCount, correlationId: group.correlationId,
                    previousAlert: group.lastAlert
                });
                group.lastAlert = alert;
                pendingAlerts.set(key, alert);
                await flushPending();
                // Ignore arbitrary sink response payloads; return only the core's safe projection.
                return alert;
            });
        },
        // Retry delivery of an already counted observation without recording it again.
        async flush() {
            return enqueue(flushPending);
        }
    });
}

module.exports = { createSecurityAlertService };
