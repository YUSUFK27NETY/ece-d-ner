const crypto = require("node:crypto");
const { createAuditEvent } = require("../audit/audit-event");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");
const {
    deriveFirebaseSubjectRef,
    requireFirebaseUid
} = require("../auth/tenant-member-subject");

const DEFAULT_OWNER_REASSIGNMENT_INVITE_TTL_MS = 30 * 60 * 1000;
const OWNER_REASSIGNMENT_INVITE_DELIVERY = "firebase_email_link";

function safeError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function isPlainRecord(value) {
    return Boolean(value) && typeof value === "object" &&
        !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        throw new TypeError("Owner reassignment tenantId geçersiz.");
    }
    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        throw new TypeError("Owner reassignment tenantId canonical olmalı.");
    }
    return tenantId;
}

function requireActorContext(context, tenantId) {
    if (!isPlainRecord(context) || Reflect.ownKeys(context).length !== 2 ||
        context.role !== "platform_admin" ||
        typeof context.actorId !== "string" ||
        context.actorId !== context.actorId.trim() ||
        !context.actorId || context.actorId.length > 128 ||
        /[\u0000-\u001f\u007f]/.test(context.actorId)) {
        throw new TypeError("Owner reassignment actor bağlamı geçersiz.");
    }
    authorizeTenantAction({
        context,
        tenantId,
        permission: "members.manage"
    });
    return Object.freeze({
        role: context.role,
        actorId: context.actorId
    });
}

function normalizeEmail(value) {
    if (typeof value !== "string") {
        throw new TypeError("Owner reassignment e-posta adresi geçersiz.");
    }
    const email = value.trim().toLowerCase();
    if (!email || email.length > 254 ||
        /[\u0000-\u0020\u007f]/.test(email) ||
        !/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
        throw new TypeError("Owner reassignment e-posta adresi geçersiz.");
    }
    return email;
}

function normalizeRequestId(value) {
    const requestId = value === undefined || value === null
        ? null
        : String(value).trim();
    if (requestId !== null &&
        (!requestId || requestId.length > 128 ||
            /[\u0000-\u001f\u007f]/.test(requestId))) {
        throw new TypeError("Owner reassignment requestId geçersiz.");
    }
    return requestId;
}

function currentTimestamp(clock) {
    const now = clock();
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Owner reassignment clock geçersiz.");
    }
    return now.toISOString();
}

function digest(value) {
    return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function requireProvisioningTenant(tenant, tenantId) {
    if (!tenant) {
        throw safeError("TENANT_NOT_FOUND", "İşletme bulunamadı.");
    }
    if (tenant.tenantId !== tenantId || tenant.id !== tenantId) {
        throw safeError(
            "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE",
            "Owner reassignment tenant durumu doğrulanamadı."
        );
    }
    if (tenant.status !== "provisioning") {
        throw safeError(
            "TENANT_OWNER_REASSIGNMENT_INVALID_STATE",
            "Owner yalnız provisioning tenantta yeniden atanabilir."
        );
    }
    return tenant;
}

function normalizeCreateRequest(input) {
    if (!isPlainRecord(input)) {
        throw new TypeError("Owner reassignment davet isteği geçersiz.");
    }
    const keys = Reflect.ownKeys(input);
    const allowed = ["context", "tenantId", "email", "requestId"];
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "context") ||
        !Object.hasOwn(input, "tenantId") ||
        !Object.hasOwn(input, "email")) {
        throw new TypeError("Owner reassignment davet isteği geçersiz.");
    }
    const tenantId = requireCanonicalTenantId(input.tenantId);
    return Object.freeze({
        tenantId,
        context: requireActorContext(input.context, tenantId),
        email: normalizeEmail(input.email),
        requestId: normalizeRequestId(input.requestId)
    });
}

function normalizeAcceptRequest(input) {
    if (!isPlainRecord(input)) {
        throw new TypeError("Owner reassignment kabul isteği geçersiz.");
    }
    const keys = Reflect.ownKeys(input);
    const allowed = ["tenantId", "inviteToken", "idToken", "requestId"];
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key)) ||
        !Object.hasOwn(input, "tenantId") ||
        !Object.hasOwn(input, "inviteToken") ||
        !Object.hasOwn(input, "idToken")) {
        throw new TypeError("Owner reassignment kabul isteği geçersiz.");
    }
    const inviteToken = typeof input.inviteToken === "string"
        ? input.inviteToken
        : "";
    const idToken = typeof input.idToken === "string"
        ? input.idToken.trim()
        : "";
    if (!/^[A-Za-z0-9_-]{40,120}$/.test(inviteToken) ||
        !idToken || idToken.length > 8192 ||
        /[\u0000-\u001f\u007f]/.test(idToken)) {
        throw new TypeError("Owner reassignment kabul isteği geçersiz.");
    }
    return Object.freeze({
        tenantId: requireCanonicalTenantId(input.tenantId),
        inviteToken,
        idToken,
        requestId: normalizeRequestId(input.requestId)
    });
}

function createNewOwnerArtifacts({
    tenantId,
    firebaseUid,
    observedAt,
    requestId
}) {
    const subjectRef = deriveFirebaseSubjectRef(firebaseUid);
    const newBinding = Object.freeze({
        schemaVersion: 1,
        tenantId,
        subjectRef,
        role: "tenant_owner",
        source: "firebase_auth",
        state: "active",
        createdAt: observedAt,
        updatedAt: observedAt
    });
    const newOwnerSlot = Object.freeze({
        schemaVersion: 1,
        tenantId,
        subjectRef,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt
    });
    const newEvidence = Object.freeze({
        schemaVersion: 1,
        tenantId,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt
    });
    const auditEvent = createAuditEvent({
        tenantId,
        action: "tenant.initial_owner.reassigned",
        actorId: subjectRef,
        requestId,
        metadata: {
            kind: "initial_owner",
            role: "tenant_owner",
            source: OWNER_REASSIGNMENT_INVITE_DELIVERY
        },
        now: new Date(observedAt)
    });
    return Object.freeze({
        newBinding,
        newOwnerSlot,
        newEvidence,
        auditEvent
    });
}

function createProvisioningOwnerReassignmentService({
    auth,
    tenantRegistry,
    reassignmentRepository,
    clock = () => new Date(),
    inviteTtlMs = DEFAULT_OWNER_REASSIGNMENT_INVITE_TTL_MS,
    randomBytes = crypto.randomBytes
}) {
    if (!auth || typeof auth.getUser !== "function" ||
        typeof auth.verifyIdToken !== "function") {
        throw new TypeError("Owner reassignment Firebase Auth adapter gerekli.");
    }
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Owner reassignment tenant registry gerekli.");
    }
    if (!reassignmentRepository ||
        typeof reassignmentRepository.readCurrentOwner !== "function" ||
        typeof reassignmentRepository.createInvite !== "function" ||
        typeof reassignmentRepository.commitReassignment !== "function") {
        throw new TypeError("Owner reassignment repository gerekli.");
    }
    if (typeof clock !== "function") {
        throw new TypeError("Owner reassignment clock geçersiz.");
    }
    if (!Number.isSafeInteger(inviteTtlMs) ||
        inviteTtlMs < 5 * 60 * 1000 ||
        inviteTtlMs > 24 * 60 * 60 * 1000) {
        throw new TypeError("Owner reassignment davet süresi geçersiz.");
    }
    if (typeof randomBytes !== "function") {
        throw new TypeError("Owner reassignment random source geçersiz.");
    }

    return Object.freeze({
        async createInvite(input) {
            const command = normalizeCreateRequest(input);
            const tenant = requireProvisioningTenant(
                await tenantRegistry.getById(command.tenantId),
                command.tenantId
            );
            const createdAt = currentTimestamp(clock);
            const expiresAt = new Date(
                new Date(createdAt).getTime() + inviteTtlMs
            ).toISOString();

            let rawToken;
            try {
                rawToken = randomBytes(32).toString("base64url");
            } catch {
                throw safeError(
                    "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE",
                    "Owner reassignment daveti oluşturulamadı."
                );
            }
            if (!/^[A-Za-z0-9_-]{40,120}$/.test(rawToken)) {
                throw safeError(
                    "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE",
                    "Owner reassignment daveti oluşturulamadı."
                );
            }

            const ownerState = await reassignmentRepository.readCurrentOwner({
                expectedTenant: tenant
            });
            if (!ownerState ||
                typeof ownerState.subjectRef !== "string" ||
                !/^firebase:[0-9a-f]{64}$/.test(ownerState.subjectRef)) {
                throw safeError(
                    "TENANT_OWNER_REASSIGNMENT_OWNER_MISSING",
                    "Mevcut owner doğrulanamadı."
                );
            }

            const invite = Object.freeze({
                schemaVersion: 1,
                tenantId: command.tenantId,
                emailHash: digest(command.email),
                tokenHash: digest(rawToken),
                expectedOwnerSubjectRef: ownerState.subjectRef,
                role: "tenant_owner",
                state: "pending",
                delivery: OWNER_REASSIGNMENT_INVITE_DELIVERY,
                createdAt,
                expiresAt
            });
            const auditEvent = createAuditEvent({
                tenantId: command.tenantId,
                action: "tenant.initial_owner.reassignment.invite.created",
                actorId: command.context.actorId,
                requestId: command.requestId,
                metadata: {
                    kind: "initial_owner",
                    role: "tenant_owner",
                    delivery: OWNER_REASSIGNMENT_INVITE_DELIVERY
                },
                now: new Date(createdAt)
            });

            try {
                await reassignmentRepository.createInvite({
                    expectedTenant: tenant,
                    invite,
                    auditEvent
                });
            } catch (error) {
                if ([
                    "TENANT_OWNER_REASSIGNMENT_OWNER_MISSING",
                    "TENANT_OWNER_REASSIGNMENT_STATE_CHANGED"
                ].includes(error?.code)) {
                    throw error;
                }
                throw safeError(
                    "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE",
                    "Owner reassignment daveti oluşturulamadı."
                );
            }

            return Object.freeze({
                tenantId: command.tenantId,
                role: "tenant_owner",
                delivery: OWNER_REASSIGNMENT_INVITE_DELIVERY,
                inviteToken: rawToken,
                expiresAt
            });
        },

        async acceptInvite(input) {
            const command = normalizeAcceptRequest(input);

            let decoded;
            try {
                decoded = await auth.verifyIdToken(command.idToken, true);
            } catch {
                throw safeError(
                    "OWNER_REASSIGNMENT_AUTH_INVALID",
                    "Owner reassignment oturumu doğrulanamadı."
                );
            }

            let firebaseUid;
            try {
                firebaseUid = requireFirebaseUid(decoded?.uid);
            } catch {
                throw safeError(
                    "OWNER_REASSIGNMENT_AUTH_INVALID",
                    "Owner reassignment oturumu doğrulanamadı."
                );
            }

            let userRecord;
            try {
                userRecord = await auth.getUser(firebaseUid);
            } catch {
                throw safeError(
                    "OWNER_REASSIGNMENT_AUTH_INVALID",
                    "Owner reassignment oturumu doğrulanamadı."
                );
            }

            let decodedEmail;
            let recordEmail;
            try {
                decodedEmail = normalizeEmail(decoded?.email);
                recordEmail = normalizeEmail(userRecord?.email);
            } catch {
                throw safeError(
                    "OWNER_REASSIGNMENT_IDENTITY_NOT_ELIGIBLE",
                    "Owner reassignment kimliği uygun değil."
                );
            }

            if (decodedEmail !== recordEmail ||
                decoded?.email_verified !== true ||
                userRecord?.emailVerified !== true ||
                userRecord?.disabled !== false ||
                decoded?.platformAdmin === true ||
                userRecord?.customClaims?.platformAdmin === true) {
                throw safeError(
                    "OWNER_REASSIGNMENT_IDENTITY_NOT_ELIGIBLE",
                    "Owner reassignment kimliği uygun değil."
                );
            }

            const tenant = requireProvisioningTenant(
                await tenantRegistry.getById(command.tenantId),
                command.tenantId
            );
            const observedAt = currentTimestamp(clock);
            const artifacts = createNewOwnerArtifacts({
                tenantId: command.tenantId,
                firebaseUid,
                observedAt,
                requestId: command.requestId
            });

            try {
                await reassignmentRepository.commitReassignment({
                    expectedTenant: tenant,
                    emailHash: digest(decodedEmail),
                    tokenHash: digest(command.inviteToken),
                    acceptedAt: observedAt,
                    ...artifacts
                });
            } catch (error) {
                if ([
                    "TENANT_OWNER_REASSIGNMENT_OWNER_MISSING",
                    "TENANT_OWNER_REASSIGNMENT_STATE_CHANGED",
                    "TENANT_OWNER_REASSIGNMENT_INVITE_INVALID",
                    "TENANT_OWNER_REASSIGNMENT_INVITE_EXPIRED",
                    "TENANT_OWNER_REASSIGNMENT_TARGET_EXISTS",
                    "TENANT_OWNER_REASSIGNMENT_SAME_SUBJECT"
                ].includes(error?.code)) {
                    throw error;
                }
                throw safeError(
                    "TENANT_OWNER_REASSIGNMENT_UNAVAILABLE",
                    "Owner reassignment tamamlanamadı."
                );
            }

            return Object.freeze({
                tenantId: command.tenantId,
                role: "tenant_owner",
                state: "active",
                adminBootstrap: "verified",
                ownerReassigned: true,
                observedAt
            });
        }
    });
}

module.exports = {
    DEFAULT_OWNER_REASSIGNMENT_INVITE_TTL_MS,
    OWNER_REASSIGNMENT_INVITE_DELIVERY,
    createProvisioningOwnerReassignmentService
};
