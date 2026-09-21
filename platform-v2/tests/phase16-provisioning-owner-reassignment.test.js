const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    createProvisioningOwnerReassignmentService
} = require("../src/onboarding/provisioning-owner-reassignment-service");

const TENANT_ID = "doydoy-doner";
const CURRENT_SUBJECT = "firebase:" + "a".repeat(64);

function tenant(status = "provisioning") {
    return {
        id: TENANT_ID,
        tenantId: TENANT_ID,
        displayName: "Doydoy Döner",
        sector: "restaurant",
        status,
        plan: "starter",
        features: {},
        profile: {}
    };
}

function createHarness() {
    let record = tenant();
    let now = new Date("2026-09-21T14:00:00.000Z");
    const calls = {
        createInvite: [],
        commit: []
    };
    const identity = {
        decoded: {
            uid: "firebase-can-poyraz",
            email: "canpoyraz277@gmail.com",
            email_verified: true,
            platformAdmin: false
        },
        user: {
            uid: "firebase-can-poyraz",
            email: "canpoyraz277@gmail.com",
            emailVerified: true,
            disabled: false,
            customClaims: {}
        }
    };
    const repository = {
        async readCurrentOwner({ expectedTenant }) {
            assert.equal(expectedTenant.tenantId, TENANT_ID);
            return {
                tenantId: TENANT_ID,
                subjectRef: CURRENT_SUBJECT
            };
        },
        async createInvite(input) {
            calls.createInvite.push(input);
        },
        async commitReassignment(input) {
            calls.commit.push(input);
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
            return {
                ...identity.user,
                customClaims: { ...identity.user.customClaims }
            };
        }
    };
    const service = createProvisioningOwnerReassignmentService({
        auth,
        tenantRegistry: {
            async getById(id) {
                return id === TENANT_ID ? record : null;
            }
        },
        reassignmentRepository: repository,
        clock: () => new Date(now),
        randomBytes: size => {
            assert.equal(size, 32);
            return Buffer.alloc(32, 9);
        }
    });

    return {
        service,
        calls,
        identity,
        setStatus(status) {
            record = { ...record, status };
        },
        setNow(value) {
            now = new Date(value);
        }
    };
}

test("platform admin can create provisioning owner reassignment invite without exposing email/token hashes", async () => {
    const harness = createHarness();
    const result = await harness.service.createInvite({
        context: {
            role: "platform_admin",
            actorId: "platform-admin-1"
        },
        tenantId: TENANT_ID,
        email: " CanPoyraz277@gmail.com ",
        requestId: "request-reassign-create"
    });

    assert.equal(result.tenantId, TENANT_ID);
    assert.equal(result.role, "tenant_owner");
    assert.equal(result.delivery, "firebase_email_link");
    assert.match(result.inviteToken, /^[A-Za-z0-9_-]{40,120}$/);
    assert.equal(harness.calls.createInvite.length, 1);

    const input = harness.calls.createInvite[0];
    assert.equal(input.invite.expectedOwnerSubjectRef, CURRENT_SUBJECT);
    assert.equal(
        input.invite.emailHash,
        crypto.createHash("sha256")
            .update("canpoyraz277@gmail.com")
            .digest("hex")
    );
    assert.match(input.invite.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(
        JSON.stringify(input.invite).includes("canpoyraz277@gmail.com"),
        false
    );
    assert.equal(
        JSON.stringify(input.invite).includes(result.inviteToken),
        false
    );
    assert.equal(
        input.auditEvent.action,
        "tenant.initial_owner.reassignment.invite.created"
    );
});

test("reassignment acceptance creates new owner artifacts and delegates atomic swap to repository", async () => {
    const harness = createHarness();
    const invite = await harness.service.createInvite({
        context: {
            role: "platform_admin",
            actorId: "platform-admin-1"
        },
        tenantId: TENANT_ID,
        email: "canpoyraz277@gmail.com",
        requestId: "request-reassign-create"
    });

    const result = await harness.service.acceptInvite({
        tenantId: TENANT_ID,
        inviteToken: invite.inviteToken,
        idToken: "firebase-id-token",
        requestId: "request-reassign-accept"
    });

    assert.equal(result.ownerReassigned, true);
    assert.equal(result.role, "tenant_owner");
    assert.equal(result.state, "active");
    assert.equal(result.adminBootstrap, "verified");
    assert.equal(harness.calls.commit.length, 1);

    const input = harness.calls.commit[0];
    assert.equal(input.expectedTenant.status, "provisioning");
    assert.equal(input.newBinding.role, "tenant_owner");
    assert.equal(input.newBinding.state, "active");
    assert.equal(input.newBinding.source, "firebase_auth");
    assert.match(input.newBinding.subjectRef, /^firebase:[0-9a-f]{64}$/);
    assert.notEqual(input.newBinding.subjectRef, CURRENT_SUBJECT);
    assert.equal(
        input.newOwnerSlot.subjectRef,
        input.newBinding.subjectRef
    );
    assert.equal(
        input.newEvidence.observedAt,
        input.newOwnerSlot.observedAt
    );
    assert.equal(
        input.auditEvent.action,
        "tenant.initial_owner.reassigned"
    );
    assert.equal(
        JSON.stringify(input.auditEvent).includes("canpoyraz277@gmail.com"),
        false
    );
});

test("owner reassignment is fail-closed outside provisioning lifecycle", async () => {
    const harness = createHarness();
    harness.setStatus("active");

    await assert.rejects(
        () => harness.service.createInvite({
            context: {
                role: "platform_admin",
                actorId: "platform-admin-1"
            },
            tenantId: TENANT_ID,
            email: "canpoyraz277@gmail.com",
            requestId: "request-reassign-create"
        }),
        error => error?.code === "TENANT_OWNER_REASSIGNMENT_INVALID_STATE"
    );
    assert.equal(harness.calls.createInvite.length, 0);
});

test("reassignment rejects unverified or platform-admin target identity", async () => {
    const unverified = createHarness();
    const invite = await unverified.service.createInvite({
        context: {
            role: "platform_admin",
            actorId: "platform-admin-1"
        },
        tenantId: TENANT_ID,
        email: "canpoyraz277@gmail.com",
        requestId: "request-reassign-create"
    });
    unverified.identity.decoded.email_verified = false;

    await assert.rejects(
        () => unverified.service.acceptInvite({
            tenantId: TENANT_ID,
            inviteToken: invite.inviteToken,
            idToken: "firebase-id-token",
            requestId: "request-reassign-accept"
        }),
        error => error?.code === "OWNER_REASSIGNMENT_IDENTITY_NOT_ELIGIBLE"
    );

    const platformAdmin = createHarness();
    const invite2 = await platformAdmin.service.createInvite({
        context: {
            role: "platform_admin",
            actorId: "platform-admin-1"
        },
        tenantId: TENANT_ID,
        email: "canpoyraz277@gmail.com",
        requestId: "request-reassign-create-2"
    });
    platformAdmin.identity.decoded.platformAdmin = true;
    platformAdmin.identity.user.customClaims.platformAdmin = true;

    await assert.rejects(
        () => platformAdmin.service.acceptInvite({
            tenantId: TENANT_ID,
            inviteToken: invite2.inviteToken,
            idToken: "firebase-id-token",
            requestId: "request-reassign-accept-2"
        }),
        error => error?.code === "OWNER_REASSIGNMENT_IDENTITY_NOT_ELIGIBLE"
    );
});

test("Firestore reassignment swaps owner atomically and revokes old member only after invite validation", () => {
    const source = fs.readFileSync(
        path.join(
            __dirname,
            "../src/firestore/firestore-provisioning-owner-reassignment-repository.js"
        ),
        "utf8"
    );

    assert.match(source, /db\.runTransaction/);
    assert.match(source, /expectedOwnerSubjectRef/);
    assert.match(source, /state: "revoked"/);
    assert.match(source, /transaction\.set\(\s*current\.oldMemberRef/);
    assert.match(source, /transaction\.create\(\s*newMemberRef/);
    assert.match(source, /transaction\.set\(\s*baseRefs\.ownerSlotRef/);
    assert.match(source, /transaction\.set\(\s*baseRefs\.evidenceRef/);
    assert.match(source, /transaction\.delete\(baseRefs\.inviteRef\)/);
    assert.match(source, /TENANT_OWNER_REASSIGNMENT_SAME_SUBJECT/);
    assert.match(source, /TENANT_OWNER_REASSIGNMENT_TARGET_EXISTS/);
});

test("admin and owner clients keep reassignment secret out of query and storage", () => {
    const adminHtml = fs.readFileSync(
        path.join(__dirname, "../public/admin/quick-setup.html"),
        "utf8"
    );
    const adminClient = fs.readFileSync(
        path.join(__dirname, "../public/admin/owner-reassignment.js"),
        "utf8"
    );
    const acceptClient = fs.readFileSync(
        path.join(__dirname, "../public/owner/accept-invite.js"),
        "utf8"
    );
    const endpointSource = fs.readFileSync(
        path.join(
            __dirname,
            "../src/http/attach-tenant-member-identity-endpoints.js"
        ),
        "utf8"
    );

    assert.match(adminHtml, /İlk Owner'ı Değiştir/);
    assert.match(adminHtml, /src="\/admin\/owner-reassignment\.js"/);
    assert.match(adminClient, /owner-reassignment-invite/);
    assert.match(adminClient, /fragment\.set\("flow", "owner_reassignment"\)/);
    assert.match(adminClient, /sendSignInLinkToEmail/);
    assert.doesNotMatch(
        adminClient,
        /searchParams\.set\("inviteToken"/
    );
    assert.match(acceptClient, /owner-reassignment\/accept/);
    assert.match(acceptClient, /flow === "owner_reassignment"/);
    assert.match(
        endpointSource,
        /admin-bootstrap\/owner-reassignment-invite/
    );
    assert.match(
        endpointSource,
        /owner-reassignment\/accept/
    );

    for (const source of [adminClient, acceptClient]) {
        assert.doesNotMatch(source, /localStorage|sessionStorage/);
        assert.doesNotMatch(source, /innerHTML\s*=/);
        assert.doesNotMatch(source, /console\./);
    }
});
