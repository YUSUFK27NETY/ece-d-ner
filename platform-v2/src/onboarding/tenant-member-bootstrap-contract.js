const crypto = require("node:crypto");
const {
    ROLE_PERMISSIONS,
    authorizeTenantAction
} = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const MEMBER_BOOTSTRAP_KINDS = Object.freeze([
    "initial_owner",
    "member"
]);
const ASSIGNABLE_TENANT_BOOTSTRAP_ROLES = Object.freeze(
    Object.keys(ROLE_PERMISSIONS).filter(role => role !== "platform_admin")
);
const MEMBER_BOOTSTRAP_INTENT_STATUS = "external_identity_required";
const COMMAND_FIELDS = Object.freeze([
    "context",
    "tenantId",
    "subjectRef",
    "kind",
    "role",
    "requestId"
]);
const CONTEXT_FIELDS = Object.freeze([
    "tenantId",
    "actorId",
    "role"
]);

function fail(label) {
    throw new TypeError(`Tenant member bootstrap ${label} geçersiz.`);
}

function assertExactRecord(input, allowedFields, requiredFields, label) {
    if (!input || typeof input !== "object" || Array.isArray(input) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
        fail(label);
    }

    const keys = Reflect.ownKeys(input);
    if (keys.some(key => typeof key !== "string" ||
        !allowedFields.includes(key))) {
        fail(label);
    }

    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(input, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value")) {
            fail(label);
        }
    }

    if (requiredFields.some(field => !Object.hasOwn(input, field))) {
        fail(label);
    }

    return input;
}

function ownValue(record, key) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor && Object.hasOwn(descriptor, "value")
        ? descriptor.value
        : undefined;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") {
        fail("tenantId");
    }

    const tenantId = requireTenantId(value);
    if (tenantId !== value) {
        fail("tenantId");
    }

    return tenantId;
}

function requireOpaqueIdentifier(value, label) {
    if (typeof value !== "string" || value !== value.trim() ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ||
        /^\d{7,15}$/.test(value)) {
        fail(label);
    }

    return value;
}

function normalizeContext(value, targetTenantId) {
    const context = assertExactRecord(
        value,
        CONTEXT_FIELDS,
        ["actorId", "role"],
        "context"
    );
    const role = ownValue(context, "role");
    if (typeof role !== "string" || !Object.hasOwn(ROLE_PERMISSIONS, role)) {
        fail("context role");
    }

    const contextTenantIdValue = ownValue(context, "tenantId");
    const tenantId = role === "platform_admin" &&
        (contextTenantIdValue === undefined || contextTenantIdValue === null)
        ? null
        : requireCanonicalTenantId(contextTenantIdValue);
    const actorId = requireOpaqueIdentifier(
        ownValue(context, "actorId"),
        "actorId"
    );
    const normalized = Object.freeze({ tenantId, actorId, role });

    authorizeTenantAction({
        context: normalized,
        tenantId: targetTenantId,
        permission: "members.manage"
    });

    return normalized;
}

function normalizeKindAndRole(kind, role) {
    if (!MEMBER_BOOTSTRAP_KINDS.includes(kind)) {
        fail("kind");
    }
    if (!ASSIGNABLE_TENANT_BOOTSTRAP_ROLES.includes(role)) {
        fail("role");
    }
    if (kind === "initial_owner" && role !== "tenant_owner") {
        fail("initial owner role");
    }
    if (kind === "member" && role === "tenant_owner") {
        fail("member ownership");
    }

    return Object.freeze({ kind, role });
}

function createBootstrapIdentity({ tenantId, subjectRef, kind, role }) {
    return crypto.createHash("sha256")
        .update(JSON.stringify([1, tenantId, subjectRef, kind, role]))
        .digest("hex");
}

function normalizeMemberBootstrapCommand(input) {
    const command = assertExactRecord(
        input,
        COMMAND_FIELDS,
        ["context", "tenantId", "subjectRef", "kind", "role"],
        "request"
    );
    const tenantId = requireCanonicalTenantId(ownValue(command, "tenantId"));
    const context = normalizeContext(ownValue(command, "context"), tenantId);
    const subjectRef = requireOpaqueIdentifier(
        ownValue(command, "subjectRef"),
        "subjectRef"
    );
    const { kind, role } = normalizeKindAndRole(
        ownValue(command, "kind"),
        ownValue(command, "role")
    );
    const requestIdValue = ownValue(command, "requestId");
    const requestId = requestIdValue === undefined || requestIdValue === null
        ? null
        : requireOpaqueIdentifier(requestIdValue, "requestId");
    const idempotencyKey = createBootstrapIdentity({
        tenantId,
        subjectRef,
        kind,
        role
    });

    return Object.freeze({
        context,
        tenantId,
        subjectRef,
        kind,
        role,
        requestId,
        idempotencyKey
    });
}

function createMemberBootstrapIntent(command, createdAt) {
    if (!command || typeof command !== "object" || !Object.isFrozen(command)) {
        fail("normalized command");
    }
    if (typeof createdAt !== "string" ||
        new Date(createdAt).toISOString() !== createdAt) {
        fail("createdAt");
    }

    return Object.freeze({
        schemaVersion: 1,
        bootstrapId: `member-bootstrap:${command.idempotencyKey}`,
        idempotencyKey: command.idempotencyKey,
        tenantId: command.tenantId,
        subjectRef: command.subjectRef,
        kind: command.kind,
        role: command.role,
        status: MEMBER_BOOTSTRAP_INTENT_STATUS,
        createdAt
    });
}

function projectMemberBootstrapIntent(intent) {
    return Object.freeze({
        schemaVersion: intent.schemaVersion,
        bootstrapId: intent.bootstrapId,
        idempotencyKey: intent.idempotencyKey,
        tenantId: intent.tenantId,
        kind: intent.kind,
        role: intent.role,
        status: intent.status,
        externalIdentityWorkRequired: true,
        createdAt: intent.createdAt
    });
}

module.exports = {
    ASSIGNABLE_TENANT_BOOTSTRAP_ROLES,
    MEMBER_BOOTSTRAP_INTENT_STATUS,
    MEMBER_BOOTSTRAP_KINDS,
    createBootstrapIdentity,
    createMemberBootstrapIntent,
    normalizeMemberBootstrapCommand,
    projectMemberBootstrapIntent
};
