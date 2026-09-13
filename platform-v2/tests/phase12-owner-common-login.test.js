const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { deriveFirebaseSubjectRef } = require("../src/auth/tenant-member-subject");
const {
    createFirestoreTenantMemberBindingRepository
} = require("../src/firestore/firestore-tenant-member-binding-repository");

function read(relativePath) {
    return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

function bindingRecord(tenantId, subjectRef, state = "active") {
    return {
        schemaVersion: 1,
        tenantId,
        subjectRef,
        role: "tenant_owner",
        source: "firebase_auth",
        state,
        createdAt: "2026-09-13T10:00:00.000Z",
        updatedAt: "2026-09-13T10:00:00.000Z"
    };
}

function fallbackRepository(records) {
    const db = {
        doc() {
            return { async get() { return { exists: false }; } };
        },
        collection() {
            return { doc() { return {}; } };
        },
        async runTransaction() {
            throw new Error("not used");
        },
        collectionGroup(name) {
            assert.equal(name, "members");
            return {
                where(field, op) {
                    assert.equal(field, "subjectRef");
                    assert.equal(op, "==");
                    return {
                        async get() {
                            const error = new Error("missing collection-group index");
                            error.code = 9;
                            throw error;
                        }
                    };
                },
                async get() {
                    return {
                        docs: records.map(record => ({ data: () => record }))
                    };
                }
            };
        }
    };
    return createFirestoreTenantMemberBindingRepository({ db });
}

test("owner sabit giriş sayfası yalnız işletme girişini gösterir", () => {
    const html = read("public/owner/index.html");
    assert.match(html, /<h1>İşletme Girişi<\/h1>/);
    assert.match(html, /src="\/owner\/login\.js"/);
    assert.match(html, /id="owner-email"/);
    assert.match(html, /id="owner-password"/);
    assert.doesNotMatch(html, /href="\/admin\//);
    assert.doesNotMatch(html, /Giriş Merkezi/);
    assert.doesNotMatch(html, /customer-entry/);
    assert.doesNotMatch(html, /İşletme kodu/);
    assert.doesNotMatch(html, /tenant-id/);
});

test("ortak owner login authenticated hesabı server session ile tenant'a çözer", () => {
    const source = read("public/owner/login.js");
    assert.match(source, /fetch\("\/api\/tenant\/session"/);
    assert.match(source, /session\?\.tenantId/);
    assert.match(source, /signInWithEmailAndPassword/);
    assert.match(source, /\/owner\/panel\.html\?tenant=/);
    assert.match(source, /platformOwnerTenantId/);
    assert.doesNotMatch(source, /localStorage/);
    assert.doesNotMatch(source, /\/admin\//);
});

test("internal owner panel tenant değerini görünür form alanı olarak istemez", () => {
    const html = read("public/owner/panel.html");
    assert.match(html, /<input id="tenant-id" type="hidden">/);
    assert.doesNotMatch(html, /<label>\s*İşletme kodu/);
    assert.match(html, /src="\/owner\/owner\.js"/);
});

test("tenant session resolver yalnız tek aktif owner-admin binding döndürür", () => {
    const runtime = read("src/http/attach-tenant-member-identity-endpoints.js");
    const repo = read("src/firestore/firestore-tenant-member-binding-repository.js");
    assert.match(runtime, /TENANT_MEMBER_RESOLVE_SESSION_PATH\s*=\s*"\/api\/tenant\/session"/);
    assert.match(runtime, /findActiveBySubject/);
    assert.match(runtime, /tenant_owner/);
    assert.match(runtime, /tenant_admin/);
    assert.match(runtime, /decoded\.platformAdmin\s*===\s*true/);
    assert.match(repo, /collectionGroup\(TENANT_COLLECTIONS\.members\)/);
    assert.match(repo, /where\("subjectRef",\s*"==",\s*subjectRef\)/);
    assert.match(repo, /TENANT_MEMBER_AMBIGUOUS/);
});

test("owner binding lookup collection-group index yoksa filtersiz scan ile exact subject'i çözer", async () => {
    const subjectRef = deriveFirebaseSubjectRef("owner-index-fallback");
    const otherSubjectRef = deriveFirebaseSubjectRef("other-owner");
    const repository = fallbackRepository([
        bindingRecord("baska-isletme", otherSubjectRef),
        bindingRecord("ela-doner", subjectRef),
        bindingRecord("revoked-isletme", subjectRef, "revoked")
    ]);

    const binding = await repository.findActiveBySubject({ subjectRef });
    assert.equal(binding.tenantId, "ela-doner");
    assert.equal(binding.subjectRef, subjectRef);
    assert.equal(binding.state, "active");
});

test("owner binding fallback birden fazla active tenant bulursa fail-closed kalır", async () => {
    const subjectRef = deriveFirebaseSubjectRef("owner-ambiguous-fallback");
    const repository = fallbackRepository([
        bindingRecord("ela-doner", subjectRef),
        bindingRecord("baska-isletme", subjectRef)
    ]);

    await assert.rejects(
        () => repository.findActiveBySubject({ subjectRef }),
        error => error?.code === "TENANT_MEMBER_AMBIGUOUS"
    );
});
