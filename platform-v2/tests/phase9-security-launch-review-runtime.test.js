const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createFirestoreSecurityReviewEvidenceWriter
} = require("../src/firestore/firestore-security-review-evidence-writer");
const {
    createSecurityLaunchReviewService
} = require("../src/onboarding/security-launch-review-service");

const TENANT_ID = "second-tenant";
const NOW = new Date("2026-09-10T21:00:00.000Z");

function tenantRecord(status = "provisioning") {
    return {
        id: TENANT_ID,
        tenantId: TENANT_ID,
        displayName: "Second Tenant",
        sector: "restaurant",
        plan: "default",
        status,
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

function makeAlert(severity = "info", index = 0) {
    return {
        schemaVersion: 1,
        alertId: `alert-${index}`,
        dedupeKey: `dedupe-${index}`,
        eventType: "auth.failure",
        severity,
        tenantId: TENANT_ID,
        actorId: null,
        requestId: null,
        correlationId: `corr-${index}`,
        source: "runtime",
        occurredAt: NOW.toISOString(),
        reasonCode: "AUTH_FAILURE",
        operation: "login",
        eventCount: 1,
        duplicateCount: 0,
        rollingCount: 1,
        firstSeenAt: NOW.toISOString(),
        lastSeenAt: NOW.toISOString()
    };
}

function createHarness({ alerts = [], status = "provisioning" } = {}) {
    const db = fakeFirestore();
    const tenant = tenantRecord(status);
    const { id, ...persisted } = tenant;
    db.docs.set(`platformTenants/${TENANT_ID}`, persisted);
    const writer = createFirestoreSecurityReviewEvidenceWriter({ db });
    const calls = [];
    const securityAlertReader = {
        async list(input) {
            calls.push(input);
            return alerts;
        }
    };
    const service = createSecurityLaunchReviewService({
        tenantRegistry: {
            async getById(tenantId) {
                return tenantId === TENANT_ID ? tenant : null;
            }
        },
        securityAlertReader,
        evidenceWriter: writer,
        clock: () => new Date(NOW)
    });
    return { db, service, calls };
}

function reviewInput() {
    return {
        context: { role: "platform_admin", actorId: "platform-admin-1" },
        tenantId: TENANT_ID,
        requestId: "request-security-review-1"
    };
}

test("launch security review atomically writes verified evidence + audit when current alert visibility is clean", async () => {
    const harness = createHarness({ alerts: [makeAlert("info")] });
    const result = await harness.service.completeReview(reviewInput());

    assert.deepEqual(result, {
        tenantId: TENANT_ID,
        state: "verified",
        securityReview: "verified",
        reviewedAlertCount: 1,
        observedAt: NOW.toISOString()
    });
    assert.deepEqual(harness.calls, [{
        context: { role: "platform_admin" },
        tenantId: TENANT_ID,
        limit: 200
    }]);

    assert.deepEqual(
        harness.db.docs.get(`tenants/${TENANT_ID}/settings/security-launch-readiness`),
        {
            schemaVersion: 1,
            tenantId: TENANT_ID,
            reviewKind: "launch_security_review",
            source: "controlled_external_security_review",
            state: "verified",
            observedAt: NOW.toISOString()
        }
    );
    const audits = [...harness.db.docs.entries()].filter(([path]) =>
        path.startsWith(`tenants/${TENANT_ID}/audit/`));
    assert.equal(audits.length, 1);
    assert.equal(audits[0][1].action, "tenant.security_launch_review.verified");
    assert.equal(audits[0][1].actorId, "platform-admin-1");
    assert.equal(audits[0][1].requestId, "request-security-review-1");
    assert.deepEqual(audits[0][1].metadata, {
        reviewKind: "launch_security_review",
        source: "controlled_external_security_review",
        reviewedAlertCount: 1,
        infoAlertCount: 1
    });
});

test("warning/high/critical alert varken verified evidence üretilmez", async () => {
    for (const severity of ["warning", "high", "critical"]) {
        const harness = createHarness({ alerts: [makeAlert(severity)] });
        await assert.rejects(
            () => harness.service.completeReview(reviewInput()),
            error => error?.code === "SECURITY_REVIEW_HAS_UNRESOLVED_ALERTS"
        );
        assert.equal(
            harness.db.docs.has(`tenants/${TENANT_ID}/settings/security-launch-readiness`),
            false
        );
        assert.equal([...harness.db.docs.keys()].some(path =>
            path.startsWith(`tenants/${TENANT_ID}/audit/`)), false);
    }
});

test("200-alert visibility sınırı fail-closed ve write yok", async () => {
    const alerts = Array.from({ length: 200 }, (_, index) => makeAlert("info", index));
    const harness = createHarness({ alerts });
    await assert.rejects(
        () => harness.service.completeReview(reviewInput()),
        error => error?.code === "SECURITY_REVIEW_VISIBILITY_TRUNCATED"
    );
    assert.equal(
        harness.db.docs.has(`tenants/${TENANT_ID}/settings/security-launch-readiness`),
        false
    );
});

test("yalnız provisioning tenant launch security review tamamlayabilir", async () => {
    const harness = createHarness({ status: "active" });
    await assert.rejects(
        () => harness.service.completeReview(reviewInput()),
        error => error?.code === "SECURITY_REVIEW_INVALID_STATE"
    );
    assert.equal(harness.calls.length, 0);
});

test("security evidence mevcutsa ikinci review partial audit üretmez", async () => {
    const harness = createHarness();
    harness.db.docs.set(`tenants/${TENANT_ID}/settings/security-launch-readiness`, {
        existing: true
    });
    await assert.rejects(
        () => harness.service.completeReview(reviewInput()),
        error => error?.code === "SECURITY_REVIEW_ALREADY_RECORDED"
    );
    const audits = [...harness.db.docs.keys()].filter(path =>
        path.startsWith(`tenants/${TENANT_ID}/audit/`));
    assert.equal(audits.length, 0);
});

test("platform_admin olmayan actor security review başlatamaz", async () => {
    const harness = createHarness();
    await assert.rejects(
        () => harness.service.completeReview({
            context: { role: "tenant_owner", actorId: "owner-1" },
            tenantId: TENANT_ID
        }),
        TypeError
    );
    assert.equal(harness.calls.length, 0);
});
