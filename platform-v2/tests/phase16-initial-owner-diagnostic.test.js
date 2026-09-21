const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    createFirestoreInitialOwnerDiagnosticReader
} = require("../src/firestore/firestore-initial-owner-diagnostic-reader");
const {
    createInitialOwnerDiagnosticService
} = require("../src/onboarding/initial-owner-diagnostic-service");
const {
    attachInitialOwnerDiagnosticEndpoint
} = require("../src/http/attach-initial-owner-diagnostic-endpoint");

const TENANT_ID = "doydoy-doner";
const SUBJECT_REF = "firebase:" + "a".repeat(64);
const NOW = Date.parse("2026-09-21T13:00:00.000Z");

function fakeFirestore() {
    const docs = new Map();
    function ref(path) {
        return {
            path,
            async get() {
                const value = docs.get(path);
                return value === undefined
                    ? { exists: false }
                    : { exists: true, data: () => value };
            }
        };
    }
    return { docs, doc: ref };
}

function tenant(status = "provisioning") {
    return {
        id: TENANT_ID,
        tenantId: TENANT_ID,
        displayName: "Doydoy Döner",
        sector: "restaurant",
        status
    };
}

function ownerSlot() {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        subjectRef: SUBJECT_REF,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt: "2026-09-21T12:00:00.000Z"
    };
}

function ownerMember() {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        subjectRef: SUBJECT_REF,
        role: "tenant_owner",
        source: "firebase_auth",
        state: "active",
        createdAt: "2026-09-21T12:00:00.000Z",
        updatedAt: "2026-09-21T12:00:00.000Z"
    };
}

function evidence() {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state: "verified",
        observedAt: "2026-09-21T12:00:00.000Z"
    };
}

function invite(expiresAt = "2026-09-21T13:30:00.000Z") {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        emailHash: "b".repeat(64),
        tokenHash: "c".repeat(64),
        role: "tenant_owner",
        state: "pending",
        delivery: "firebase_email_link",
        createdAt: "2026-09-21T12:30:00.000Z",
        expiresAt
    };
}

function harness(status = "provisioning") {
    const db = fakeFirestore();
    const reader = createFirestoreInitialOwnerDiagnosticReader({
        db,
        clock: () => NOW
    });
    const service = createInitialOwnerDiagnosticService({
        tenantRegistry: {
            async getById(id) {
                return id === TENANT_ID ? tenant(status) : null;
            }
        },
        stateReader: reader
    });
    return { db, reader, service };
}

test("diagnostic exposes only safe owner onboarding state and never hashes/subjectRef", async () => {
    const { db, service } = harness();
    db.docs.set(`tenants/${TENANT_ID}/settings/initial-owner-invite`, invite());

    const diagnostic = await service.diagnose({
        context: { role: "platform_admin", actorId: "admin-1" },
        tenantId: TENANT_ID
    });

    assert.equal(diagnostic.code, "INVITE_PENDING");
    assert.equal(diagnostic.inviteCreate.wouldPassRepositoryPreconditions, true);
    assert.equal(diagnostic.artifacts.invite.exists, true);
    const serialized = JSON.stringify(diagnostic);
    assert.equal(serialized.includes("b".repeat(64)), false);
    assert.equal(serialized.includes("c".repeat(64)), false);
    assert.equal(serialized.includes(SUBJECT_REF), false);
});

test("existing owner slot with missing member/evidence is classified as partial and blocks new invite", async () => {
    const { db, service } = harness();
    db.docs.set(`tenants/${TENANT_ID}/settings/initial-owner-binding`, ownerSlot());

    const diagnostic = await service.diagnose({
        context: { role: "platform_admin", actorId: "admin-1" },
        tenantId: TENANT_ID
    });

    assert.equal(diagnostic.code, "OWNER_BINDING_PARTIAL");
    assert.equal(diagnostic.inviteCreate.lifecycleEligible, true);
    assert.equal(diagnostic.inviteCreate.blockedByOwnerBinding, true);
    assert.equal(diagnostic.inviteCreate.wouldPassRepositoryPreconditions, false);
    assert.equal(diagnostic.artifacts.member.checked, true);
    assert.equal(diagnostic.artifacts.member.exists, false);
    assert.equal(diagnostic.artifacts.evidence.exists, false);
});

test("complete owner artifacts classify as consistent without leaking identity", async () => {
    const { db, service } = harness();
    db.docs.set(`tenants/${TENANT_ID}/settings/initial-owner-binding`, ownerSlot());
    db.docs.set(`tenants/${TENANT_ID}/members/${SUBJECT_REF}`, ownerMember());
    db.docs.set(`tenants/${TENANT_ID}/settings/admin-bootstrap-readiness`, evidence());

    const diagnostic = await service.diagnose({
        context: { role: "platform_admin", actorId: "admin-1" },
        tenantId: TENANT_ID
    });

    assert.equal(diagnostic.code, "OWNER_BOUND_CONSISTENT");
    assert.equal(diagnostic.artifacts.member.valid, true);
    assert.equal(diagnostic.artifacts.evidence.state, "verified");
    assert.equal(JSON.stringify(diagnostic).includes(SUBJECT_REF), false);
});

test("expired pending invite is distinguished from active invite", async () => {
    const { db, service } = harness();
    db.docs.set(
        `tenants/${TENANT_ID}/settings/initial-owner-invite`,
        invite("2026-09-21T12:59:59.000Z")
    );

    const diagnostic = await service.diagnose({
        context: { role: "platform_admin", actorId: "admin-1" },
        tenantId: TENANT_ID
    });
    assert.equal(diagnostic.code, "INVITE_EXPIRED");
    assert.equal(diagnostic.artifacts.invite.expired, true);
});

test("HTTP diagnostic is GET-only in effect, rejects query input, and returns safe service projection", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.platformActor = { role: "platform_admin", uid: "admin-1" };
        next();
    });
    attachInitialOwnerDiagnosticEndpoint({
        app,
        diagnosticService: {
            async diagnose(input) {
                assert.deepEqual(input, {
                    context: { role: "platform_admin", actorId: "admin-1" },
                    tenantId: TENANT_ID
                });
                return {
                    tenantId: TENANT_ID,
                    tenantStatus: "provisioning",
                    code: "READY_FOR_INVITE"
                };
            }
        }
    });

    const server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        let response = await fetch(
            `${base}/api/platform/tenants/${TENANT_ID}/admin-bootstrap/initial-owner-diagnostic`
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).diagnostic.code, "READY_FOR_INVITE");

        response = await fetch(
            `${base}/api/platform/tenants/${TENANT_ID}/admin-bootstrap/initial-owner-diagnostic?x=1`
        );
        assert.equal(response.status, 400);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
