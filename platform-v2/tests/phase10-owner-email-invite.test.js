const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    createTenantInitialOwnerBootstrapService
} = require("../src/onboarding/tenant-initial-owner-bootstrap-service");

function codedError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function tenant(status = "provisioning") {
    return {
        id: "ela-doner",
        tenantId: "ela-doner",
        displayName: "Ela Döner",
        sector: "restaurant",
        status,
        plan: "starter",
        features: {},
        profile: {}
    };
}

function createHarness() {
    let now = new Date("2026-09-12T18:00:00.000Z");
    let record = tenant();
    let invite = null;
    let bound = null;
    const createAudits = [];
    const acceptInputs = [];
    const identity = {
        decoded: {
            uid: "firebase-owner-1",
            email: "owner@example.com",
            email_verified: true,
            platformAdmin: false
        },
        user: {
            uid: "firebase-owner-1",
            email: "owner@example.com",
            emailVerified: true,
            disabled: false,
            customClaims: {}
        }
    };

    const repository = {
        async commitInitialOwner() {},
        async createInitialOwnerInvite(input) {
            invite = { ...input.invite };
            createAudits.push(input.auditEvent);
        },
        async commitInitialOwnerFromInvite(input) {
            acceptInputs.push(input);
            if (bound) throw codedError("TENANT_INITIAL_OWNER_ALREADY_BOUND");
            if (!invite || invite.emailHash !== input.emailHash || invite.tokenHash !== input.tokenHash) {
                throw codedError("TENANT_INITIAL_OWNER_INVITE_INVALID");
            }
            if (new Date(input.acceptedAt).getTime() >= new Date(invite.expiresAt).getTime()) {
                throw codedError("TENANT_INITIAL_OWNER_INVITE_EXPIRED");
            }
            bound = { ...input.binding };
            invite = null;
        }
    };

    const auth = {
        async verifyIdToken(token, checkRevoked) {
            assert.equal(token, "firebase-id-token");
            assert.equal(checkRevoked, true);
            return { ...identity.decoded };
        },
        async getUser(uid) {
            assert.equal(uid, identity.user.uid);
            return { ...identity.user, customClaims: { ...identity.user.customClaims } };
        }
    };

    const service = createTenantInitialOwnerBootstrapService({
        auth,
        tenantRegistry: { async getById(id) { return id === "ela-doner" ? record : null; } },
        bindingRepository: repository,
        clock: () => new Date(now),
        randomBytes: size => {
            assert.equal(size, 32);
            return Buffer.alloc(32, 7);
        }
    });

    return {
        service,
        identity,
        createAudits,
        acceptInputs,
        get invite() { return invite; },
        get bound() { return bound; },
        setNow(value) { now = new Date(value); },
        setStatus(status) { record = { ...record, status }; }
    };
}

function createCommand(email = " Owner@Example.com ") {
    return {
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: "ela-doner",
        email,
        requestId: "request-create"
    };
}

function acceptCommand(inviteToken) {
    return {
        tenantId: "ela-doner",
        inviteToken,
        idToken: "firebase-id-token",
        requestId: "request-accept"
    };
}

test("owner invite stores only hashes and projects one-time token only to authenticated admin caller", async () => {
    const harness = createHarness();
    const result = await harness.service.createInitialOwnerInvite(createCommand());

    assert.equal(result.tenantId, "ela-doner");
    assert.equal(result.role, "tenant_owner");
    assert.equal(result.delivery, "firebase_email_link");
    assert.match(result.inviteToken, /^[A-Za-z0-9_-]{40,120}$/);
    assert.equal(harness.invite.role, "tenant_owner");
    assert.equal(harness.invite.state, "pending");
    assert.match(harness.invite.emailHash, /^[0-9a-f]{64}$/);
    assert.match(harness.invite.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(JSON.stringify(harness.invite).includes("owner@example.com"), false);
    assert.equal(JSON.stringify(harness.invite).includes(result.inviteToken), false);
    assert.equal(harness.invite.emailHash, crypto.createHash("sha256").update("owner@example.com").digest("hex"));
    assert.equal(harness.createAudits.length, 1);
    assert.deepEqual(harness.createAudits[0].metadata, {
        kind: "initial_owner",
        role: "tenant_owner",
        delivery: "firebase_email_link"
    });
    assert.equal(JSON.stringify(harness.createAudits[0]).includes("owner@example.com"), false);
    assert.equal(JSON.stringify(harness.createAudits[0]).includes(result.inviteToken), false);
});

test("valid Firebase email-link identity atomically consumes invite and creates only tenant_owner binding", async () => {
    const harness = createHarness();
    const invite = await harness.service.createInitialOwnerInvite(createCommand());
    const result = await harness.service.acceptInitialOwnerInvite(acceptCommand(invite.inviteToken));

    assert.deepEqual(result.role, "tenant_owner");
    assert.equal(result.state, "active");
    assert.equal(result.adminBootstrap, "verified");
    assert.equal(harness.invite, null);
    assert.equal(harness.bound.role, "tenant_owner");
    assert.equal(harness.bound.source, "firebase_auth");
    assert.match(harness.bound.subjectRef, /^firebase:[0-9a-f]{64}$/);
    assert.equal(harness.acceptInputs.length, 1);
    assert.equal(harness.acceptInputs[0].auditEvent.action, "tenant.initial_owner.bound");
    assert.equal(harness.acceptInputs[0].auditEvent.metadata.source, "firebase_email_link");

    await assert.rejects(
        () => harness.service.acceptInitialOwnerInvite(acceptCommand(invite.inviteToken)),
        error => error?.code === "TENANT_INITIAL_OWNER_ALREADY_BOUND" ||
            error?.code === "TENANT_INITIAL_OWNER_INVITE_INVALID"
    );
});

test("platform_admin identity can never be promoted through owner invite", async () => {
    const harness = createHarness();
    const invite = await harness.service.createInitialOwnerInvite(createCommand());
    harness.identity.decoded.platformAdmin = true;
    harness.identity.user.customClaims.platformAdmin = true;

    await assert.rejects(
        () => harness.service.acceptInitialOwnerInvite(acceptCommand(invite.inviteToken)),
        error => error?.code === "INVITE_IDENTITY_NOT_ELIGIBLE"
    );
    assert.equal(harness.bound, null);
    assert.notEqual(harness.invite, null);
});

test("invite is bound to exact verified email hash", async () => {
    const harness = createHarness();
    const invite = await harness.service.createInitialOwnerInvite(createCommand());
    harness.identity.decoded.email = "other@example.com";
    harness.identity.user.email = "other@example.com";

    await assert.rejects(
        () => harness.service.acceptInitialOwnerInvite(acceptCommand(invite.inviteToken)),
        error => error?.code === "TENANT_INITIAL_OWNER_INVITE_INVALID"
    );
    assert.equal(harness.bound, null);
});

test("expired invite and lifecycle drift fail closed", async () => {
    const expired = createHarness();
    const invite = await expired.service.createInitialOwnerInvite(createCommand());
    expired.setNow("2026-09-12T18:31:00.000Z");
    await assert.rejects(
        () => expired.service.acceptInitialOwnerInvite(acceptCommand(invite.inviteToken)),
        error => error?.code === "TENANT_INITIAL_OWNER_INVITE_EXPIRED"
    );
    assert.equal(expired.bound, null);

    const lifecycle = createHarness();
    lifecycle.setStatus("active");
    await assert.rejects(
        () => lifecycle.service.createInitialOwnerInvite(createCommand()),
        error => error?.code === "TENANT_INITIAL_OWNER_INVALID_STATE"
    );
});

test("email invite frontends avoid URL email state, local storage and unsafe DOM", () => {
    const adminHtml = fs.readFileSync(path.join(__dirname, "../public/admin/quick-setup.html"), "utf8");
    const inviteClient = fs.readFileSync(path.join(__dirname, "../public/admin/owner-email-invite.js"), "utf8");
    const acceptHtml = fs.readFileSync(path.join(__dirname, "../public/owner/accept-invite.html"), "utf8");
    const acceptClient = fs.readFileSync(path.join(__dirname, "../public/owner/accept-invite.js"), "utf8");

    assert.match(adminHtml, /Owner e-posta/);
    assert.match(adminHtml, /send-owner-invite/);
    assert.doesNotMatch(adminHtml, /Firebase User UID/);
    assert.match(inviteClient, /sendSignInLinkToEmail/);
    assert.match(inviteClient, /handleCodeInApp: true/);
    assert.match(inviteClient, /inviteToken/);
    assert.match(acceptHtml, /Davet edilen e-posta/);
    assert.match(acceptClient, /isSignInWithEmailLink/);
    assert.match(acceptClient, /signInWithEmailLink/);
    assert.match(acceptClient, /getIdToken\(true\)/);
    assert.match(acceptClient, /history\.replaceState/);

    for (const source of [inviteClient, acceptClient]) {
        assert.doesNotMatch(source, /localStorage|sessionStorage/);
        assert.doesNotMatch(source, /innerHTML\s*=/);
        assert.doesNotMatch(source, /console\./);
    }
    const landingFunction = inviteClient.slice(
        inviteClient.indexOf("function inviteLandingUrl"),
        inviteClient.indexOf("function friendlyFirebaseError")
    );
    assert.doesNotMatch(landingFunction, /email/i);
});

test("invite endpoints remain split between Platform Admin creation and rate-limited Firebase acceptance", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../src/http/attach-tenant-member-identity-endpoints.js"),
        "utf8"
    );
    assert.match(source, /\/api\/platform\/tenants\/:tenantId\/admin-bootstrap\/initial-owner-invite/);
    assert.match(source, /\/api\/tenant-invitations\/:tenantId\/initial-owner\/accept/);
    assert.match(source, /rateLimit/);
    assert.match(source, /max: 30/);
    assert.match(source, /Bearer /);
    assert.doesNotMatch(source, /inviteToken.*console/s);
});

test("Firestore invite consumption deletes pending invite in the same transaction as owner artifacts", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../src/firestore/firestore-tenant-member-binding-repository.js"),
        "utf8"
    );
    assert.match(source, /INITIAL_OWNER_INVITE_SETTING_ID/);
    assert.match(source, /commitInitialOwnerFromInvite/);
    assert.match(source, /transaction\.create\(refs\.memberRef/);
    assert.match(source, /transaction\.create\(refs\.ownerSlotRef/);
    assert.match(source, /transaction\.create\(refs\.evidenceRef/);
    assert.match(source, /transaction\.delete\(refs\.inviteRef\)/);
    assert.match(source, /TENANT_INITIAL_OWNER_INVITE_EXPIRED/);
});
