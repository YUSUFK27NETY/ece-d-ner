const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    deriveFirebaseSubjectRef
} = require("../src/auth/tenant-member-subject");
const {
    createFirestoreTenantMemberBindingRepository
} = require("../src/firestore/firestore-tenant-member-binding-repository");
const {
    createTenantInitialOwnerBootstrapService
} = require("../src/onboarding/tenant-initial-owner-bootstrap-service");
const {
    attachTenantMemberIdentityEndpoints
} = require("../src/http/attach-tenant-member-identity-endpoints");

const TENANT_ID = "second-tenant";
const UID = "firebase-user-second-owner";
const NOW = new Date("2026-09-10T18:30:00.000Z");

function tenantRecord() {
    return {
        id: TENANT_ID,
        tenantId: TENANT_ID,
        displayName: "Second Tenant",
        sector: "restaurant",
        plan: "default",
        status: "provisioning",
        features: { catalog: true, orders: true }
    };
}

function fakeFirestore() {
    const docs = new Map();
    function makeRef(path) {
        const id = path.split("/").at(-1);
        return {
            path,
            id,
            async get() {
                const value = docs.get(path);
                return value === undefined
                    ? { exists: false, id }
                    : { exists: true, id, data: () => value };
            }
        };
    }
    return {
        docs,
        doc: makeRef,
        collection(name) {
            return { doc(id) { return makeRef(`${name}/${id}`); } };
        },
        async runTransaction(callback) {
            const pending = [];
            const transaction = {
                async get(ref) { return ref.get(); },
                create(ref, data) { pending.push([ref.path, { ...data }]); }
            };
            const result = await callback(transaction);
            for (const [path, value] of pending) {
                if (docs.has(path)) throw new Error(`duplicate write: ${path}`);
                docs.set(path, value);
            }
            return result;
        }
    };
}

function createHarness({ userRecord } = {}) {
    const db = fakeFirestore();
    const tenant = tenantRecord();
    const { id, ...persisted } = tenant;
    db.docs.set(`platformTenants/${TENANT_ID}`, persisted);
    const bindingRepository = createFirestoreTenantMemberBindingRepository({ db });
    let getUserCalls = 0;
    const auth = {
        async getUser(uid) {
            getUserCalls += 1;
            if (userRecord) return userRecord(uid);
            return { uid, disabled: false, customClaims: {} };
        }
    };
    const service = createTenantInitialOwnerBootstrapService({
        auth,
        tenantRegistry: {
            async getById(tenantId) {
                return tenantId === TENANT_ID ? tenant : null;
            }
        },
        bindingRepository,
        clock: () => new Date(NOW)
    });
    return { db, bindingRepository, service, get getUserCalls() { return getUserCalls; } };
}

test("initial owner bootstrap verifies external identity then atomically writes binding evidence and audit", async () => {
    const harness = createHarness();
    const result = await harness.service.bindInitialOwner({
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: TENANT_ID,
        firebaseUid: UID,
        requestId: "request-bootstrap-1"
    });

    assert.deepEqual(result, {
        tenantId: TENANT_ID,
        role: "tenant_owner",
        state: "active",
        adminBootstrap: "verified",
        observedAt: NOW.toISOString()
    });
    assert.equal(harness.getUserCalls, 1);
    assert.equal(JSON.stringify(result).includes(UID), false);

    const subjectRef = deriveFirebaseSubjectRef(UID);
    const memberPath = `tenants/${TENANT_ID}/members/${subjectRef}`;
    assert.deepEqual(harness.db.docs.get(memberPath), {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        subjectRef,
        role: "tenant_owner",
        source: "firebase_auth",
        state: "active",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString()
    });
    assert.deepEqual(
        harness.db.docs.get(`tenants/${TENANT_ID}/settings/admin-bootstrap-readiness`),
        {
            schemaVersion: 1,
            tenantId: TENANT_ID,
            kind: "initial_owner",
            role: "tenant_owner",
            source: "controlled_external_identity",
            state: "verified",
            observedAt: NOW.toISOString()
        }
    );
    const auditEntries = [...harness.db.docs.entries()].filter(([path]) =>
        path.startsWith(`tenants/${TENANT_ID}/audit/`));
    assert.equal(auditEntries.length, 1);
    assert.equal(auditEntries[0][1].action, "tenant.initial_owner.bound");
    assert.equal(JSON.stringify(auditEntries[0][1]).includes(UID), false);

    const binding = await harness.bindingRepository.getBySubject({ tenantId: TENANT_ID, subjectRef });
    assert.equal(binding.role, "tenant_owner");
    assert.equal(binding.state, "active");
});

test("disabled veya platform-admin Firebase identity initial owner olamaz ve write oluşmaz", async () => {
    for (const userRecord of [
        uid => ({ uid, disabled: true, customClaims: {} }),
        uid => ({ uid, disabled: false, customClaims: { platformAdmin: true } })
    ]) {
        const harness = createHarness({ userRecord });
        await assert.rejects(
            () => harness.service.bindInitialOwner({
                context: { role: "platform_admin", actorId: "platform-admin-1" },
                tenantId: TENANT_ID,
                firebaseUid: UID
            }),
            error => error?.code === "EXTERNAL_IDENTITY_NOT_ELIGIBLE"
        );
        assert.equal([...harness.db.docs.keys()].some(path =>
            path.startsWith(`tenants/${TENANT_ID}/members/`)), false);
        assert.equal(harness.db.docs.has(
            `tenants/${TENANT_ID}/settings/admin-bootstrap-readiness`), false);
    }
});

test("unknown external identity safe not-found üretir ve raw provider error sızdırmaz", async () => {
    const harness = createHarness({
        userRecord() {
            const error = new Error("raw firebase provider marker");
            error.code = "auth/user-not-found";
            throw error;
        }
    });
    await assert.rejects(
        () => harness.service.bindInitialOwner({
            context: { role: "platform_admin", actorId: "platform-admin-1" },
            tenantId: TENANT_ID,
            firebaseUid: UID
        }),
        error => error?.code === "EXTERNAL_IDENTITY_NOT_FOUND" &&
            !error.message.includes("raw firebase")
    );
});

test("existing owner slot conflict transactionda partial member/evidence/audit write üretmez", async () => {
    const harness = createHarness();
    harness.db.docs.set(`tenants/${TENANT_ID}/settings/initial-owner-binding`, {
        existing: true
    });
    await assert.rejects(
        () => harness.service.bindInitialOwner({
            context: { role: "platform_admin", actorId: "platform-admin-1" },
            tenantId: TENANT_ID,
            firebaseUid: UID
        }),
        error => error?.code === "TENANT_INITIAL_OWNER_ALREADY_BOUND"
    );
    const subjectRef = deriveFirebaseSubjectRef(UID);
    assert.equal(harness.db.docs.has(`tenants/${TENANT_ID}/members/${subjectRef}`), false);
    assert.equal(harness.db.docs.has(
        `tenants/${TENANT_ID}/settings/admin-bootstrap-readiness`), false);
    assert.equal([...harness.db.docs.keys()].some(path =>
        path.startsWith(`tenants/${TENANT_ID}/audit/`)), false);
});

test("tenant member session Firebase token + exact tenant binding ile çözülür; cross-tenant fail-closed", async () => {
    const subjectRef = deriveFirebaseSubjectRef(UID);
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.requestId = "request-http-1";
        if (req.path.startsWith("/api/platform")) {
            req.platformActor = { role: "platform_admin", uid: "platform-admin-1" };
        }
        next();
    });
    const auth = {
        async verifyIdToken(token) {
            if (token === "owner-token") return { uid: UID, platformAdmin: false };
            if (token === "platform-token") return { uid: "platform-admin-1", platformAdmin: true };
            throw new Error("invalid token marker");
        }
    };
    const bindingReader = {
        async getBySubject({ tenantId, subjectRef: requestedSubject }) {
            if (tenantId !== TENANT_ID || requestedSubject !== subjectRef) return null;
            return {
                schemaVersion: 1,
                tenantId,
                subjectRef,
                role: "tenant_owner",
                source: "firebase_auth",
                state: "active",
                createdAt: NOW.toISOString(),
                updatedAt: NOW.toISOString()
            };
        }
    };
    attachTenantMemberIdentityEndpoints({
        app,
        auth,
        bindingReader,
        initialOwnerBootstrapService: {
            async bindInitialOwner() { throw new Error("not used"); }
        }
    });
    const server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        let response = await fetch(`${base}/api/tenant/tenants/${TENANT_ID}/session`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            success: true,
            session: { tenantId: TENANT_ID, role: "tenant_owner" }
        });

        response = await fetch(`${base}/api/tenant/tenants/first-tenant/session`, {
            headers: { Authorization: "Bearer owner-token" }
        });
        assert.equal(response.status, 403);

        response = await fetch(`${base}/api/tenant/tenants/${TENANT_ID}/session`, {
            headers: { Authorization: "Bearer platform-token" }
        });
        assert.equal(response.status, 403);

        response = await fetch(`${base}/api/tenant/tenants/${TENANT_ID}/session`);
        assert.equal(response.status, 401);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});

test("Platform Admin bootstrap HTTP yalnız firebaseUid alır ve UID response'a yansımaz", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.requestId = "request-http-bootstrap";
        req.platformActor = { role: "platform_admin", uid: "platform-admin-1" };
        next();
    });
    const calls = [];
    attachTenantMemberIdentityEndpoints({
        app,
        auth: { async verifyIdToken() { throw new Error("not used"); } },
        bindingReader: { async getBySubject() { return null; } },
        initialOwnerBootstrapService: {
            async bindInitialOwner(input) {
                calls.push(input);
                return {
                    tenantId: TENANT_ID,
                    role: "tenant_owner",
                    state: "active",
                    adminBootstrap: "verified",
                    observedAt: NOW.toISOString()
                };
            }
        }
    });
    const server = app.listen(0);
    await new Promise(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
        const response = await fetch(
            `${base}/api/platform/tenants/${TENANT_ID}/admin-bootstrap/initial-owner`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ firebaseUid: UID })
            }
        );
        assert.equal(response.status, 201);
        const body = await response.json();
        assert.equal(body.success, true);
        assert.equal(JSON.stringify(body).includes(UID), false);
        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0], {
            context: { role: "platform_admin", actorId: "platform-admin-1" },
            tenantId: TENANT_ID,
            firebaseUid: UID,
            requestId: "request-http-bootstrap"
        });
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
