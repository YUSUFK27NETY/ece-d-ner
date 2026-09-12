const crypto = require("node:crypto");
const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    deriveFirebaseSubjectRef,
    requireFirebaseUid
} = require("../auth/tenant-member-subject");

const DEFAULT_INITIAL_OWNER_INVITE_TTL_MS = 30 * 60 * 1000;
const INITIAL_OWNER_INVITE_DELIVERY = "firebase_email_link";

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

function normalizeRequestId(value) {
    const requestId = value === undefined || value === null ? null : String(value).trim();
    if (requestId !== null && (!requestId || requestId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(requestId))) {
        throw new TypeError("Initial owner bootstrap requestId geçersiz.");
    }
    return requestId;
}

function normalizeEmail(value) {
    if (typeof value !== "string") throw new TypeError("Owner e-posta adresi geçersiz.");
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 || /[\u0000-\u0020\u007f]/.test(email) ||
        !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
        throw new TypeError("Owner e-posta adresi geçersiz.");
    }
    return email;
}

function digest(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
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
    const requestId = normalizeRequestId(input.requestId);
    return Object.freeze({ context, tenantId, firebaseUid, requestId });
}

function normalizeInviteCreateRequest(input) {
    if (!isPlainRecord(input)) throw new TypeError("Initial owner daveti geçersiz.");
    const keys = Reflect.ownKeys(input);
    const allowed = ["context", "tenantId", "email", "requestId"];
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "context") || !Object.hasOwn(input, "tenantId") ||
        !Object.hasOwn(input, "email")) {
        throw new TypeError("Initial owner daveti geçersiz.");
    }
    const tenantId = requireCanonicalTenantId(input.tenantId);
    return Object.freeze({
        tenantId,
        context: requireActorContext(input.context, tenantId),
        email: normalizeEmail(input.email),
        requestId: normalizeRequestId(input.requestId)
    });
}

function normalizeInviteAcceptRequest(input) {
    if (!isPlainRecord(input)) throw new TypeError("Initial owner davet kabul isteği geçersiz.");
    const keys = Reflect.ownKeys(input);
    const allowed = ["tenantId", "inviteToken", "idToken", "requestId"];
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "tenantId") || !Object.hasOwn(input, "inviteToken") ||
        !Object.hasOwn(input, "idToken")) {
        throw new TypeError("Initial owner davet kabul isteği geçersiz.");
    }
    const inviteToken = typeof input.inviteToken === "string" ? input.inviteToken : "";
    const idToken = typeof input.idToken === "string" ? input.idToken.trim() : "";
    if (!/^[A-Za-z0-9_-]{40,120}$/.test(inviteToken) || !idToken || idToken.length > 8192 ||
        /[\u0000-\u001f\u007f]/.test(idToken)) {
        throw new TypeError("Initial owner davet kabul isteği geçersiz.");
    }
    return Object.freeze({
        tenantId: requireCanonicalTenantId(input.tenantId),
        inviteToken,
        idToken,
        requestId: normalizeRequestId(input.requestId)
    });
}

function createOwnerArtifacts({ tenantId, firebaseUid, observedAt, actorId, requestId, auditSource }) {
    const subjectRef = deriveFirebaseSubjectRef(firebaseUid);
    const binding = {
        schemaVersion: 1,
        tenantId,
        subjectRef,
        role: "tenant_owner",
        source: "firebase_auth",
        state: "active",
        createdAt: observedAt,
        updatedAt: observedAt
    };
    const ownerSlot = {
        schemaVersion: 1,
        tenantId,
        subjectRef,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt
    };
    const evidence = {
        schemaVersion: 1,
        tenantId,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt
    };
    const auditEvent = createAuditEvent({
        tenantId,
        action: "tenant.initial_owner.bound",
        actorId,
        requestId,
        metadata: {
            kind: "initial_owner",
            role: "tenant_owner",
            source: auditSource
        },
        now: new Date(observedAt)
    });
    return Object.freeze({ binding, ownerSlot, evidence, auditEvent });
}

function requireProvisioningTenant(tenant, tenantId) {
    if (!tenant) throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
    if (tenant.tenantId !== tenantId || tenant.id !== tenantId) {
        throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Tenant bootstrap doğrulanamadı.");
    }
    if (tenant.status !== "provisioning") {
        throw safeError(
            "TENANT_INITIAL_OWNER_INVALID_STATE",
            "Initial owner yalnız provisioning tenant için bağlanabilir."
        );
    }
    return tenant;
}

function createTenantInitialOwnerBootstrapService({
    auth,
    tenantRegistry,
    bindingRepository,
    clock = () => new Date(),
    inviteTtlMs = DEFAULT_INITIAL_OWNER_INVITE_TTL_MS,
    randomBytes = crypto.randomBytes
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
    if (!Number.isSafeInteger(inviteTtlMs) || inviteTtlMs < 5 * 60 * 1000 ||
        inviteTtlMs > 24 * 60 * 60 * 1000) {
        throw new TypeError("Initial owner davet süresi geçersiz.");
    }
    if (typeof randomBytes !== "function") throw new TypeError("Initial owner random source geçersiz.");

    return Object.freeze({
        async bindInitialOwner(input) {
            const command = normalizeRequest(input);
            const tenant = requireProvisioningTenant(
                await tenantRegistry.getById(command.tenantId),
                command.tenantId
            );

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
            const artifacts = createOwnerArtifacts({
                tenantId: command.tenantId,
                firebaseUid: command.firebaseUid,
                observedAt,
                actorId: command.context.actorId,
                requestId: command.requestId,
                auditSource: "controlled_external_identity"
            });

            try {
                await bindingRepository.commitInitialOwner({
                    expectedTenant: tenant,
                    ...artifacts
                });
            } catch (error) {
                if ([
                    "TENANT_INITIAL_OWNER_ALREADY_BOUND",
                    "TENANT_BOOTSTRAP_STATE_CHANGED"
                ].includes(error?.code)) throw error;
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner bağlanamadı.");
            }

            return Object.freeze({
                tenantId: command.tenantId,
                role: "tenant_owner",
                state: "active",
                adminBootstrap: "verified",
                observedAt
            });
        },

        async createInitialOwnerInvite(input) {
            if (typeof bindingRepository.createInitialOwnerInvite !== "function") {
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti kullanılamıyor.");
            }
            const command = normalizeInviteCreateRequest(input);
            const tenant = requireProvisioningTenant(
                await tenantRegistry.getById(command.tenantId),
                command.tenantId
            );
            const createdAt = currentTimestamp(clock);
            const expiresAt = new Date(new Date(createdAt).getTime() + inviteTtlMs).toISOString();
            let rawToken;
            try {
                rawToken = randomBytes(32).toString("base64url");
            } catch {
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti oluşturulamadı.");
            }
            if (!/^[A-Za-z0-9_-]{40,120}$/.test(rawToken)) {
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti oluşturulamadı.");
            }
            const invite = Object.freeze({
                schemaVersion: 1,
                tenantId: command.tenantId,
                emailHash: digest(command.email),
                tokenHash: digest(rawToken),
                role: "tenant_owner",
                state: "pending",
                delivery: INITIAL_OWNER_INVITE_DELIVERY,
                createdAt,
                expiresAt
            });
            const auditEvent = createAuditEvent({
                tenantId: command.tenantId,
                action: "tenant.initial_owner.invite.created",
                actorId: command.context.actorId,
                requestId: command.requestId,
                metadata: {
                    kind: "initial_owner",
                    role: "tenant_owner",
                    delivery: INITIAL_OWNER_INVITE_DELIVERY
                },
                now: new Date(createdAt)
            });
            try {
                await bindingRepository.createInitialOwnerInvite({
                    expectedTenant: tenant,
                    invite,
                    auditEvent
                });
            } catch (error) {
                if ([
                    "TENANT_INITIAL_OWNER_ALREADY_BOUND",
                    "TENANT_BOOTSTRAP_STATE_CHANGED"
                ].includes(error?.code)) throw error;
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti oluşturulamadı.");
            }
            return Object.freeze({
                tenantId: command.tenantId,
                role: "tenant_owner",
                delivery: INITIAL_OWNER_INVITE_DELIVERY,
                inviteToken: rawToken,
                expiresAt
            });
        },

        async acceptInitialOwnerInvite(input) {
            if (typeof auth.verifyIdToken !== "function" ||
                typeof bindingRepository.commitInitialOwnerFromInvite !== "function") {
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti kullanılamıyor.");
            }
            const command = normalizeInviteAcceptRequest(input);
            let decoded;
            try {
                decoded = await auth.verifyIdToken(command.idToken, true);
            } catch {
                throw safeError("INVITE_AUTH_INVALID", "Davet oturumu doğrulanamadı.");
            }
            const firebaseUid = requireFirebaseUid(decoded?.uid);
            let userRecord;
            try {
                userRecord = await auth.getUser(firebaseUid);
            } catch {
                throw safeError("INVITE_AUTH_INVALID", "Davet oturumu doğrulanamadı.");
            }
            const decodedEmail = normalizeEmail(decoded?.email);
            const recordEmail = normalizeEmail(userRecord?.email);
            if (decodedEmail !== recordEmail || decoded?.email_verified !== true ||
                userRecord?.emailVerified !== true || userRecord?.disabled !== false ||
                decoded?.platformAdmin === true || userRecord?.customClaims?.platformAdmin === true) {
                throw safeError("INVITE_IDENTITY_NOT_ELIGIBLE", "Davet kimliği uygun değil.");
            }
            const tenant = requireProvisioningTenant(
                await tenantRegistry.getById(command.tenantId),
                command.tenantId
            );
            const observedAt = currentTimestamp(clock);
            const artifacts = createOwnerArtifacts({
                tenantId: command.tenantId,
                firebaseUid,
                observedAt,
                actorId: firebaseUid,
                requestId: command.requestId,
                auditSource: INITIAL_OWNER_INVITE_DELIVERY
            });
            try {
                await bindingRepository.commitInitialOwnerFromInvite({
                    expectedTenant: tenant,
                    emailHash: digest(decodedEmail),
                    tokenHash: digest(command.inviteToken),
                    acceptedAt: observedAt,
                    ...artifacts
                });
            } catch (error) {
                if ([
                    "TENANT_INITIAL_OWNER_ALREADY_BOUND",
                    "TENANT_INITIAL_OWNER_INVITE_INVALID",
                    "TENANT_INITIAL_OWNER_INVITE_EXPIRED",
                    "TENANT_BOOTSTRAP_STATE_CHANGED"
                ].includes(error?.code)) throw error;
                throw safeError("TENANT_BOOTSTRAP_UNAVAILABLE", "Initial owner daveti kabul edilemedi.");
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
    DEFAULT_INITIAL_OWNER_INVITE_TTL_MS,
    INITIAL_OWNER_INVITE_DELIVERY,
    createTenantInitialOwnerBootstrapService
};
