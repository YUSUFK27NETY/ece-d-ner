const { createAuditEvent } = require("../audit/audit-event");
const {
    createMemberBootstrapIntent,
    normalizeMemberBootstrapCommand,
    projectMemberBootstrapIntent
} = require("./tenant-member-bootstrap-contract");

const DUPLICATE_CODE = "MEMBER_BOOTSTRAP_ALREADY_EXISTS";
const UNAVAILABLE_CODE = "MEMBER_BOOTSTRAP_UNAVAILABLE";

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
            const command = normalizeMemberBootstrapCommand(input);
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
    DUPLICATE_CODE,
    UNAVAILABLE_CODE,
    createTenantMemberBootstrapService
};
