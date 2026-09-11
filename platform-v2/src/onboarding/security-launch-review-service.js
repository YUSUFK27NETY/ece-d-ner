const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    SECURITY_READINESS_ALERT_LIMIT,
    SECURITY_REVIEW_SOURCE
} = require("./security-readiness-adapter");

const REVIEW_KIND = "launch_security_review";
const BLOCKING_REVIEW_SEVERITIES = new Set(["warning", "high", "critical"]);

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
        Object.getPrototypeOf(value) === Object.prototype;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Security review tenant kimliği geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Security review tenant kimliği canonical olmalı.");
    }
    return tenantId;
}

function normalizeContext(context, tenantId) {
    if (!isPlainRecord(context) || Reflect.ownKeys(context).length !== 2 ||
        context.role !== "platform_admin" ||
        typeof context.actorId !== "string" ||
        !context.actorId || context.actorId !== context.actorId.trim() ||
        context.actorId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(context.actorId)) {
        throw new TypeError("Security review actor bağlamı geçersiz.");
    }
    authorizeTenantAction({
        context,
        tenantId,
        permission: "tenant.security.read"
    });
    return Object.freeze({ role: context.role, actorId: context.actorId });
}

function normalizeRequest(input) {
    if (!isPlainRecord(input)) {
        throw new TypeError("Security review isteği geçersiz.");
    }
    const allowed = ["context", "tenantId", "requestId"];
    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "context") ||
        !Object.hasOwn(input, "tenantId")) {
        throw new TypeError("Security review isteği geçersiz.");
    }
    const tenantId = requireCanonicalTenantId(input.tenantId);
    const context = normalizeContext(input.context, tenantId);
    const requestId = input.requestId === undefined || input.requestId === null
        ? null
        : String(input.requestId).trim();
    if (requestId !== null &&
        (!requestId || requestId.length > 128 ||
            /[\u0000-\u001f\u007f]/.test(requestId))) {
        throw new TypeError("Security review requestId geçersiz.");
    }
    return Object.freeze({ context, tenantId, requestId });
}

function currentTimestamp(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Security review clock geçersiz.");
    }
    return now.toISOString();
}

function summarizeAlerts(alerts, tenantId) {
    if (!Array.isArray(alerts) ||
        Object.getPrototypeOf(alerts) !== Array.prototype) {
        throw safeError(
            "SECURITY_REVIEW_UNAVAILABLE",
            "Güvenlik uyarıları doğrulanamadı."
        );
    }
    if (alerts.length >= SECURITY_READINESS_ALERT_LIMIT) {
        throw safeError(
            "SECURITY_REVIEW_VISIBILITY_TRUNCATED",
            "Güvenlik uyarısı görünürlüğü launch review için yeterli değil."
        );
    }

    let infoCount = 0;
    for (const alert of alerts) {
        if (!isPlainRecord(alert) || alert.tenantId !== tenantId ||
            !["info", "warning", "high", "critical"].includes(alert.severity)) {
            throw safeError(
                "SECURITY_REVIEW_UNAVAILABLE",
                "Güvenlik uyarıları doğrulanamadı."
            );
        }
        if (BLOCKING_REVIEW_SEVERITIES.has(alert.severity)) {
            throw safeError(
                "SECURITY_REVIEW_HAS_UNRESOLVED_ALERTS",
                "Launch security review için çözülmemiş güvenlik uyarıları var."
            );
        }
        if (alert.severity === "info") infoCount += 1;
    }
    return Object.freeze({
        reviewedAlertCount: alerts.length,
        infoAlertCount: infoCount
    });
}

function createSecurityLaunchReviewService({
    tenantRegistry,
    securityAlertReader,
    evidenceWriter,
    clock = () => new Date()
}) {
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Security review tenant registry gerekli.");
    }
    if (!securityAlertReader || typeof securityAlertReader.list !== "function") {
        throw new TypeError("Security review alert reader gerekli.");
    }
    if (!evidenceWriter ||
        typeof evidenceWriter.commitVerifiedReview !== "function") {
        throw new TypeError("Security review evidence writer gerekli.");
    }
    if (typeof clock !== "function") {
        throw new TypeError("Security review clock geçersiz.");
    }

    return Object.freeze({
        async completeReview(input) {
            const command = normalizeRequest(input);
            const tenant = await tenantRegistry.getById(command.tenantId);
            if (!tenant) {
                throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
            }
            if (tenant.id !== command.tenantId ||
                tenant.tenantId !== command.tenantId) {
                throw safeError(
                    "SECURITY_REVIEW_UNAVAILABLE",
                    "Tenant security review doğrulanamadı."
                );
            }
            if (tenant.status !== "provisioning") {
                throw safeError(
                    "SECURITY_REVIEW_INVALID_STATE",
                    "Launch security review yalnız provisioning tenant için tamamlanabilir."
                );
            }

            let alerts;
            try {
                alerts = await securityAlertReader.list({
                    context: { role: "platform_admin" },
                    tenantId: command.tenantId,
                    limit: SECURITY_READINESS_ALERT_LIMIT
                });
            } catch {
                throw safeError(
                    "SECURITY_REVIEW_UNAVAILABLE",
                    "Güvenlik uyarıları okunamadı."
                );
            }
            const summary = summarizeAlerts(alerts, command.tenantId);
            const observedAt = currentTimestamp(clock);
            const evidence = {
                schemaVersion: 1,
                tenantId: command.tenantId,
                reviewKind: REVIEW_KIND,
                source: SECURITY_REVIEW_SOURCE,
                state: "verified",
                observedAt
            };
            const auditEvent = createAuditEvent({
                tenantId: command.tenantId,
                action: "tenant.security_launch_review.verified",
                actorId: command.context.actorId,
                requestId: command.requestId,
                metadata: {
                    reviewKind: REVIEW_KIND,
                    source: SECURITY_REVIEW_SOURCE,
                    reviewedAlertCount: summary.reviewedAlertCount,
                    infoAlertCount: summary.infoAlertCount
                },
                now: new Date(observedAt)
            });

            try {
                await evidenceWriter.commitVerifiedReview({
                    expectedTenant: tenant,
                    evidence,
                    auditEvent
                });
            } catch (error) {
                if ([
                    "SECURITY_REVIEW_ALREADY_RECORDED",
                    "SECURITY_REVIEW_STATE_CHANGED"
                ].includes(error?.code)) {
                    throw error;
                }
                throw safeError(
                    "SECURITY_REVIEW_UNAVAILABLE",
                    "Launch security review kaydedilemedi."
                );
            }

            return Object.freeze({
                tenantId: command.tenantId,
                state: "verified",
                securityReview: "verified",
                reviewedAlertCount: summary.reviewedAlertCount,
                observedAt
            });
        }
    });
}

module.exports = {
    REVIEW_KIND,
    createSecurityLaunchReviewService
};
