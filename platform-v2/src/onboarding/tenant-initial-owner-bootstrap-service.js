const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    deriveFirebaseSubjectRef,
    requireFirebaseUid
} = require("../auth/tenant-member-subject");

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
    if (typeof value !== "string") throw new TypeError("Tenant kimliği geçersiz.");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) throw new TypeError("Tenant kimliği canonical olmalı.");
    return tenantId;
}

function requireActorContext(context, tenantId) {
    if (!isPlainRecord(context) || Reflect.ownKeys(context).length !== 2 ||
        !Object.hasOwn(context, "role") || !Object.hasOwn(context, "actorId") ||
        context.role !== "platform_admin" || typeof context.actorId !== "string" ||
        context.actorId !== context.actorId.trim() || !context.actorId || context.actorId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(context.actorId)) {
        throw new TypeError("Initial owner bootstrap actor bağlamı geçersiz.");
    }
    authorizeTenantAction({ context, tenantId, permission: "members.manage" });
    return Object.freeze({ role: context.role, actorId: context.actorId });
}

function currentTimestamp(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Initial owner bootstrap clock geçersiz.");
    }
    return now.toISOString();
}

function normalizeRequest(input) {
    if (!isPlainRecord(input)) throw new TypeError("Initial owner bootstrap isteği geçersiz.");
    const keys = Reflect.ownKeys(input);
    const allowed = ["context", "tenantId", "firebaseUid", "requestId"];
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "context") || !Object.hasOwn(input, "tenantId") ||
        !Object.hasOwn(input, "firebaseUid")) {
        throw new TypeError("Initial owner bootstrap isteği geçersiz.");
    }
    const tenantId = requireCanonicalTenantId(input.tenantId);
    const context = requireActorContext(input.context, tenantId);
    const firebaseUid = requireFirebaseUid(input.firebaseUid);
    const requestId = input.requestId === undefined || input.requestId === null
        ? null
        : String(input.requestId).trim();
    if (requestId !== null && (!requestId || requestId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(requestId))) {
        throw new TypeError("Initial owner bootstrap requestId geçersiz.");
    }
    return Object.freeze({ context, tenantId, firebaseUid, requestId });
}

function createTenantInitialOwnerBootstrapService({
    auth,
    tenantRegistry,
    bindingRepository,
    clock = () => new Date()
}) {
    if (!auth || typeof auth.getUser !== "function") {
        throw new TypeError("Firebase Auth getUser adapter gerekli.");
    }
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Tenant registry getById gerekli.");
    }
    if (!bindingRepository || typeof bindingRepository.commitInitialOwner !== "function") {
        throw new TypeError("Tenant member binding repository gerekli.");
    }
    if (typeof clock !== "function") throw new TypeError("Initial owner bootstrap clock geçersiz.");

    return Object.freeze({
        async bindInitialOwner(input) {
            const command = normalizeRequest(input);
            const tenant = await tenantRegistry.getById(command.tenantId);
            if (!tenant) {
                throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
            }
            if (tenant.tenantId !== command.tenantId || tenant.id !== command.tenantId) {
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Tenant bootstrap doğrulanamadı.");
            }
            if (tenant.status !== "provisioning") {
                throw safeError(
                    "TENANT_INITIAL_OWNER_INVALID_STATE",
                    "Initial owner yalnız provisioning tenant için bağlanabilir."
                );
            }

            let userRecord;
            try {
                userRecord = await auth.getUser(command.firebaseUid);
            } catch (error) {
                if (error?.code === "auth/user-not-found") {
                    throw safeError("EXTERNAL_IDENTITY_NOT_FOUND", "Harici kimlik bulunamadı.");
                }
                throw safeError("EXTERNAL_IDENTITY_UNAVAILABLE", "Harici kimlik doğrulanamadı.");
            }

            if (!userRecord || userRecord.uid !== command.firebaseUid ||
                userRecord.disabled !== false || userRecord.customClaims?.platformAdmin === true) {
                throw safeError(
                    "EXTERNAL_IDENTITY_NOT_ELIGIBLE",
                    "Harici kimlik initial owner için uygun değil."
                );
            }

            const observedAt = currentTimestamp(clock);
            const subjectRef = deriveFirebaseSubjectRef(command.firebaseUid);
            const binding = {
                schemaVersion: 1,
                tenantId: command.tenantId,
                subjectRef,
                role: "tenant_owner",
                source: "firebase_auth",
                state: "active",
                createdAt: observedAt,
                updatedAt: observedAt
            };
            const ownerSlot = {
                schemaVersion: 1,
                tenantId: command.tenantId,
                subjectRef,
                kind: "initial_owner",
                role: "tenant_owner",
                source: "controlled_external_identity",
                state: "verified",
                observedAt
            };
            const evidence = {
                schemaVersion: 1,
                tenantId: command.tenantId,
                kind: "initial_owner",
                role: "tenant_owner",
                source: "controlled_external_identity",
                state: "verified",
                observedAt
            };
            const auditEvent = createAuditEvent({
                tenantId: command.tenantId,
                action: "tenant.initial_owner.bound",
                actorId: command.context.actorId,
                requestId: command.requestId,
                metadata: {
                    kind: "initial_owner",
                    role: "tenant_owner",
                    source: "controlled_external_identity"
                },
                now: new Date(observedAt)
            });

            try {
                await bindingRepository.commitInitialOwner({
                    expectedTenant: tenant,
                    binding,
                    ownerSlot,
                    evidence,
                    auditEvent
                });
            } catch (error) {
                if ([
                    "TENANT_INITIAL_OWNER_ALREADY_BOUND",
                    "TENANT_BOOTSTRAP_STATE_CHANGED"
                ].includes(error?.code)) {
                    throw error;
                }
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner bağlanamadı.");
            }

            return Object.freeze({
                tenantId: command.tenantId,
                role: "tenant_owner",
                state: "active",
                adminBootstrap: "verified",
                observedAt
            });
        }
    });
}

module.exports = {
    createTenantInitialOwnerBootstrapService
};
