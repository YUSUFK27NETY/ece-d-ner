const { createAuditEvent } = require("../audit/audit-event");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    createMemberBootstrapIntent,
    normalizeMemberBootstrapCommand,
    projectMemberBootstrapIntent
} = require("./tenant-member-bootstrap-contract");

const DUPLICATE_CODE = "MEMBER_BOOTSTRAP_ALREADY_EXISTS";
const UNAVAILABLE_CODE = "MEMBER_BOOTSTRAP_UNAVAILABLE";
const BOUNDARY_DENIAL_ACTION = "tenant.member_bootstrap.intent.denied";
const BOUNDARY_DENIAL_REASON = "TENANT_SCOPE_MISMATCH";

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function assertRegistry(registry) {
    if (!registry || typeof registry.create !== "function") {
        throw new TypeError("Member bootstrap registry create metodunu uygulamalı.");
    }

    return registry;
}

function assertAuditWriter(auditWriter) {
    if (auditWriter !== null &&
        (!auditWriter || typeof auditWriter.write !== "function")) {
        throw new TypeError("Audit writer write metodunu uygulamalı.");
    }

    return auditWriter;
}

function errorCode(error) {
    if (!error || typeof error !== "object") {
        return null;
    }

    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor && Object.hasOwn(descriptor, "value") &&
        typeof descriptor.value === "string"
        ? descriptor.value
        : null;
}

function currentTimestamp(clock) {
    let now;
    try {
        now = clock();
    } catch {
        throw new TypeError("Member bootstrap clock geçersiz.");
    }

    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Member bootstrap clock geçersiz.");
    }

    return now.toISOString();
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function ownDataValue(record, key) {
    if (!record || typeof record !== "object") {
        return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function safeOpaqueIdentifier(value) {
    return typeof value === "string" && value === value.trim() &&
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) &&
        !/^\d{7,15}$/.test(value)
        ? value
        : null;
}

function projectBoundaryDenialAuditInput(input) {
    if (!isPlainRecord(input)) {
        return null;
    }

    const targetTenantIdValue = ownDataValue(input, "tenantId");
    const context = ownDataValue(input, "context");
    if (typeof targetTenantIdValue !== "string" || !isPlainRecord(context)) {
        return null;
    }

    let tenantId;
    try {
        tenantId = requireTenantId(targetTenantIdValue);
    } catch {
        return null;
    }
    if (tenantId !== targetTenantIdValue) {
        return null;
    }

    const actorId = safeOpaqueIdentifier(ownDataValue(context, "actorId"));
    if (!actorId) {
        return null;
    }

    const rawRequestId = ownDataValue(input, "requestId");
    const requestId = rawRequestId === undefined || rawRequestId === null
        ? null
        : safeOpaqueIdentifier(rawRequestId);

    return Object.freeze({ tenantId, actorId, requestId });
}

async function auditBoundaryDenial({ writer, input, clock }) {
    if (!writer) {
        return;
    }

    const auditInput = projectBoundaryDenialAuditInput(input);
    if (!auditInput) {
        throw safeError(
            UNAVAILABLE_CODE,
            "Member bootstrap denial audit kaydı oluşturulamadı."
        );
    }

    const deniedAt = currentTimestamp(clock);
    try {
        await writer.write(createAuditEvent({
            tenantId: auditInput.tenantId,
            action: BOUNDARY_DENIAL_ACTION,
            actorId: auditInput.actorId,
            requestId: auditInput.requestId,
            metadata: {
                reasonCode: BOUNDARY_DENIAL_REASON
            },
            now: new Date(deniedAt)
        }));
    } catch {
        throw safeError(
            UNAVAILABLE_CODE,
            "Member bootstrap denial audit kaydı oluşturulamadı."
        );
    }
}

function createTenantMemberBootstrapService({
    registry,
    auditWriter = null,
    clock = () => new Date()
}) {
    const intentRegistry = assertRegistry(registry);
    const writer = assertAuditWriter(auditWriter);
    if (typeof clock !== "function") {
        throw new TypeError("Member bootstrap clock geçersiz.");
    }

    return Object.freeze({
        async createIntent(input) {
            let command;
            try {
                command = normalizeMemberBootstrapCommand(input);
            } catch (error) {
                if (errorCode(error) === BOUNDARY_DENIAL_REASON) {
                    await auditBoundaryDenial({ writer, input, clock });
                }
                throw error;
            }

            const createdAt = currentTimestamp(clock);
            const intent = createMemberBootstrapIntent(command, createdAt);

            try {
                await intentRegistry.create(intent);
            } catch (error) {
                if (errorCode(error) === DUPLICATE_CODE) {
                    throw safeError(
                        DUPLICATE_CODE,
                        "Member bootstrap intent zaten mevcut."
                    );
                }
                throw safeError(
                    UNAVAILABLE_CODE,
                    "Member bootstrap intent oluşturulamadı."
                );
            }

            if (writer) {
                try {
                    await writer.write(createAuditEvent({
                        tenantId: command.tenantId,
                        action: "tenant.member_bootstrap.intent.created",
                        actorId: command.context.actorId,
                        requestId: command.requestId,
                        metadata: {
                            kind: command.kind,
                            role: command.role
                        },
                        now: new Date(createdAt)
                    }));
                } catch {
                    throw safeError(
                        UNAVAILABLE_CODE,
                        "Member bootstrap audit kaydı oluşturulamadı."
                    );
                }
            }

            return projectMemberBootstrapIntent(intent);
        }
    });
}

module.exports = {
    BOUNDARY_DENIAL_ACTION,
    BOUNDARY_DENIAL_REASON,
    DUPLICATE_CODE,
    UNAVAILABLE_CODE,
    createTenantMemberBootstrapService
};
