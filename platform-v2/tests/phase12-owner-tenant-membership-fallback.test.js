const test = require("node:test");
const assert = require("node:assert/strict");

const { createRequireTenantMember } = require("../src/auth/require-tenant-member");
const { deriveFirebaseSubjectRef } = require("../src/auth/tenant-member-subject");

const TENANT_ID = "ela-doner";
const OTHER_TENANT_ID = "baska-isletme";
const UID = "owner-login-loop-regression";
const SUBJECT_REF = deriveFirebaseSubjectRef(UID);

function activeBinding(tenantId = TENANT_ID) {
    return {
        schemaVersion: 1,
        tenantId,
        subjectRef: SUBJECT_REF,
        role: "tenant_owner",
        source: "firebase_auth",
        state: "active",
        createdAt: "2026-09-14T00:00:00.000Z",
        updatedAt: "2026-09-14T00:00:00.000Z"
    };
}

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
}

function createRequest(tenantId = TENANT_ID) {
    return {
        params: { tenantId },
        headers: { authorization: "Bearer owner-token" }
    };
}

function createAuth() {
    return {
        async verifyIdToken(token, checkRevoked) {
            assert.equal(token, "owner-token");
            assert.equal(checkRevoked, true);
            return { uid: UID, platformAdmin: false };
        }
    };
}

function createTenantReader(status = "active") {
    return {
        async getById(tenantId) {
            return { tenantId, status };
        }
    };
}

async function runMiddleware({ bindingReader, tenantId = TENANT_ID, status = "active" }) {
    const middleware = createRequireTenantMember({
        auth: createAuth(),
        bindingReader,
        tenantReader: createTenantReader(status)
    });
    const req = createRequest(tenantId);
    const res = createResponse();
    let nextCalls = 0;
    await middleware(req, res, () => { nextCalls += 1; });
    return { req, res, nextCalls };
}

test("tenant-scoped owner auth exact lookup kaçırırsa common resolver binding'iyle devam eder", async () => {
    let fallbackCalls = 0;
    const result = await runMiddleware({
        bindingReader: {
            async getBySubject() { return null; },
            async findActiveBySubject({ subjectRef }) {
                fallbackCalls += 1;
                assert.equal(subjectRef, SUBJECT_REF);
                return activeBinding();
            }
        }
    });

    assert.equal(fallbackCalls, 1);
    assert.equal(result.nextCalls, 1);
    assert.equal(result.res.statusCode, 200);
    assert.deepEqual(result.req.tenantActor, {
        tenantId: TENANT_ID,
        actorId: SUBJECT_REF,
        role: "tenant_owner"
    });
});

test("compatibility fallback başka tenant binding'ini requested tenant için asla kabul etmez", async () => {
    const result = await runMiddleware({
        bindingReader: {
            async getBySubject() { return null; },
            async findActiveBySubject() { return activeBinding(OTHER_TENANT_ID); }
        }
    });

    assert.equal(result.nextCalls, 0);
    assert.equal(result.res.statusCode, 403);
    assert.equal(result.req.tenantActor, undefined);
});

test("ambiguous global owner binding fallback fail-closed 503 kalır", async () => {
    const result = await runMiddleware({
        bindingReader: {
            async getBySubject() { return null; },
            async findActiveBySubject() {
                const error = new Error("ambiguous");
                error.code = "TENANT_MEMBER_AMBIGUOUS";
                throw error;
            }
        }
    });

    assert.equal(result.nextCalls, 0);
    assert.equal(result.res.statusCode, 503);
    assert.equal(result.req.tenantActor, undefined);
});

test("exact binding bulunduğunda global fallback çağrılmaz", async () => {
    let fallbackCalls = 0;
    const result = await runMiddleware({
        bindingReader: {
            async getBySubject() { return activeBinding(); },
            async findActiveBySubject() {
                fallbackCalls += 1;
                return null;
            }
        }
    });

    assert.equal(fallbackCalls, 0);
    assert.equal(result.nextCalls, 1);
    assert.equal(result.res.statusCode, 200);
});

test("fallback üyeliği lifecycle gate'i bypass edemez", async () => {
    for (const status of ["provisioning", "suspended", "archived"]) {
        const result = await runMiddleware({
            status,
            bindingReader: {
                async getBySubject() { return null; },
                async findActiveBySubject() { return activeBinding(); }
            }
        });
        assert.equal(result.nextCalls, 0, status);
        assert.equal(result.res.statusCode, 403, status);
    }
});
