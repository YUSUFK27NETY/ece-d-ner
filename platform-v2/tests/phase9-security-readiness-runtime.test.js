const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    addSecurityReadinessSource,
    createSecurityReadinessAdapter
} = require("../src/onboarding/security-readiness-adapter");
const {
    createFirestoreSecurityReviewEvidenceProvider
} = require("../src/firestore/firestore-security-review-evidence-provider");

const TENANT_ID = "second-tenant";
const REVIEWED_AT = "2026-09-09T17:10:00.000Z";
const BEFORE_REVIEW = "2026-09-09T17:09:00.000Z";
const AFTER_REVIEW = "2026-09-09T17:11:00.000Z";
const NOW_MS = Date.parse("2026-09-09T17:20:00.000Z");

function tenantFixture(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        status: "provisioning",
        ...overrides
    };
}

function reviewFixture(state = "verified", overrides = {}) {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        reviewKind: "launch_security_review",
        source: "controlled_external_security_review",
        state,
        observedAt: REVIEWED_AT,
        ...overrides
    };
}

function alertFixture(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        severity: "info",
        lastSeenAt: AFTER_REVIEW,
        ...overrides
    };
}

function reviewProvider(value) {
    return Object.freeze({
        async getStatus() {
            return value;
        }
    });
}

function alertReader(alerts = []) {
    const calls = [];
    return {
        calls,
        reader: Object.freeze({
            async list(input) {
                calls.push(input);
                return alerts;
            }
        })
    };
}

async function evaluateSecurity(adapter, tenant = tenantFixture()) {
    const service = createCustomerReadinessService({
        sourceAdapters: { security: adapter },
        clock: () => NOW_MS
    });
    return service.evaluate({ tenantId: TENANT_ID, tenant });
}

test("missing pending ve failed security review evidence güvenli eşlenir", async () => {
    for (const [evidence, expected] of [
        [null, {
            status: "pending",
            code: "SECURITY_REVIEW_PENDING",
            observedAt: null
        }],
        [reviewFixture("pending"), {
            status: "pending",
            code: "SECURITY_REVIEW_PENDING",
            observedAt: REVIEWED_AT
        }],
        [reviewFixture("failed"), {
            status: "blocked",
            code: "SECURITY_BLOCKED",
            observedAt: REVIEWED_AT
        }]
    ]) {
        let alertCalls = 0;
        const readiness = await evaluateSecurity(
            createSecurityReadinessAdapter({
                reviewEvidenceProvider: reviewProvider(evidence),
                securityAlertReader: Object.freeze({
                    async list() {
                        alertCalls += 1;
                        return [];
                    }
                })
            })
        );
        assert.deepEqual(readiness.checks.security, expected);
        assert.equal(alertCalls, 0);
    }
});

test("verified review + empty exact-tenant alerts positive evidence ile ready olur", async () => {
    const fixture = alertReader([]);
    const readiness = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: fixture.reader
    }));

    assert.deepEqual(readiness.checks.security, {
        status: "ready",
        code: null,
        observedAt: REVIEWED_AT
    });
    assert.equal(fixture.calls.length, 1);
    assert.equal(fixture.calls[0].tenantId, TENANT_ID);
    assert.equal(fixture.calls[0].limit, 200);
    assert.equal(fixture.calls[0].context.role, "platform_admin");
});

test("review öncesi historical blocker reviewı geçersiz kılmaz", async () => {
    const readiness = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: alertReader([
            alertFixture({ severity: "critical", lastSeenAt: BEFORE_REVIEW })
        ]).reader
    }));

    assert.equal(readiness.checks.security.status, "ready");
    assert.equal(readiness.checks.security.observedAt, REVIEWED_AT);
});

test("review anı veya sonrasındaki high/critical alert securityyi blocked yapar", async () => {
    for (const [severity, lastSeenAt] of [
        ["high", REVIEWED_AT],
        ["critical", AFTER_REVIEW]
    ]) {
        const readiness = await evaluateSecurity(createSecurityReadinessAdapter({
            reviewEvidenceProvider: reviewProvider(reviewFixture()),
            securityAlertReader: alertReader([
                alertFixture({ severity, lastSeenAt })
            ]).reader
        }));
        assert.deepEqual(readiness.checks.security, {
            status: "blocked",
            code: "SECURITY_BLOCKED",
            observedAt: lastSeenAt
        });
    }
});

test("review sonrası warning reviewı pending yapar; info tek başına ready kalır", async () => {
    const warning = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: alertReader([
            alertFixture({ severity: "warning" })
        ]).reader
    }));
    assert.deepEqual(warning.checks.security, {
        status: "pending",
        code: "SECURITY_REVIEW_PENDING",
        observedAt: AFTER_REVIEW
    });

    const info = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: alertReader([
            alertFixture({ severity: "info" })
        ]).reader
    }));
    assert.deepEqual(info.checks.security, {
        status: "ready",
        code: null,
        observedAt: REVIEWED_AT
    });
});

test("200-result görünürlüğü blocker yoksa unavailable; görünür blocker varsa blocked", async () => {
    const fullInfo = Array.from({ length: 200 }, () => alertFixture());
    const uncertain = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: alertReader(fullInfo).reader
    }));
    assert.deepEqual(uncertain.checks.security, {
        status: "unavailable",
        code: null,
        observedAt: null
    });

    const withBlocker = [...fullInfo];
    withBlocker[0] = alertFixture({ severity: "high" });
    const blocked = await evaluateSecurity(createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(reviewFixture()),
        securityAlertReader: alertReader(withBlocker).reader
    }));
    assert.deepEqual(blocked.checks.security, {
        status: "blocked",
        code: "SECURITY_BLOCKED",
        observedAt: AFTER_REVIEW
    });
});

test("malformed review evidence fail-closed unavailable olur ve raw alan sızdırmaz", async () => {
    const marker = "synthetic-security-review-private-marker";
    const badEvidence = [
        reviewFixture("verified", { tenantId: "first-tenant" }),
        reviewFixture("verified", { reviewKind: "other_review" }),
        reviewFixture("verified", { source: "other_source" }),
        reviewFixture("verified", { observedAt: "not-canonical" }),
        { ...reviewFixture(), rawProviderBody: marker }
    ];

    for (const evidence of badEvidence) {
        const readiness = await evaluateSecurity(createSecurityReadinessAdapter({
            reviewEvidenceProvider: reviewProvider(evidence),
            securityAlertReader: alertReader([]).reader
        }));
        assert.equal(readiness.checks.security.status, "unavailable");
        assert.equal(JSON.stringify(readiness).includes(marker), false);
    }
});

test("malformed cross-tenant alert veya reader exception safe unavailable olur", async () => {
    const marker = "synthetic-security-alert-reader-marker";
    const readers = [
        alertReader([
            alertFixture({ tenantId: "first-tenant" })
        ]).reader,
        alertReader([
            alertFixture({ severity: "unknown" })
        ]).reader,
        Object.freeze({
            async list() {
                throw new Error(marker);
            }
        })
    ];

    for (const securityAlertReader of readers) {
        const readiness = await evaluateSecurity(createSecurityReadinessAdapter({
            reviewEvidenceProvider: reviewProvider(reviewFixture()),
            securityAlertReader
        }));
        assert.equal(readiness.checks.security.status, "unavailable");
        assert.equal(JSON.stringify(readiness).includes(marker), false);
    }
});

test("security adapter exact canonical tenant binding kullanır", async () => {
    const adapter = createSecurityReadinessAdapter({
        reviewEvidenceProvider: reviewProvider(null),
        securityAlertReader: alertReader([]).reader
    });

    await assert.rejects(
        () => adapter.evaluate({
            tenantId: TENANT_ID,
            tenant: tenantFixture({ tenantId: "first-tenant" })
        }),
        TypeError
    );
    await assert.rejects(
        () => adapter.evaluate({
            tenantId: "Second-Tenant",
            tenant: tenantFixture()
        }),
        TypeError
    );
});

test("Firestore security review evidence fixed tenant pathinden read-only okunur", async () => {
    const calls = [];
    const provider = createFirestoreSecurityReviewEvidenceProvider({
        db: {
            doc(documentPath) {
                calls.push(documentPath);
                return {
                    async get() {
                        return {
                            exists: true,
                            data() {
                                return reviewFixture();
                            }
                        };
                    }
                };
            }
        }
    });

    assert.deepEqual(await provider.getStatus({ tenantId: TENANT_ID }),
        reviewFixture());
    assert.deepEqual(calls, [
        "tenants/second-tenant/settings/security-launch-readiness"
    ]);

    const source = fs.readFileSync(path.resolve(
        __dirname,
        "../src/firestore/firestore-security-review-evidence-provider.js"
    ), "utf8");
    assert.doesNotMatch(source,
        /\.create\(|\.set\(|\.update\(|\.delete\(|cloudflare|iam|inviteUser|enrollUser/iu);
});

test("server existing base plan adminBootstrap compositionını koruyup security ekler", () => {
    const composed = addSecurityReadinessSource({
        sourceAdapters: Object.freeze({
            plan: Object.freeze({ evaluate() {} }),
            adminBootstrap: Object.freeze({ evaluate() {} })
        }),
        reviewEvidenceProvider: reviewProvider(null),
        securityAlertReader: alertReader([]).reader
    });
    assert.deepEqual(Object.keys(composed), [
        "plan", "adminBootstrap", "security"
    ]);

    const serverSource = fs.readFileSync(
        path.resolve(__dirname, "../server.js"),
        "utf8"
    );
    assert.match(serverSource, /createFirestoreSecurityReviewEvidenceProvider/);
    assert.match(serverSource, /addSecurityReadinessSource/);
    assert.match(serverSource,
        /createCustomerReadinessSourceAdapters\(\{[\s\S]*checkReadiness,[\s\S]*backupEvidenceProvider/);
    assert.match(serverSource,
        /plan:\s*createPlanReadinessAdapter\(\{[\s\S]*guardrailsConfig,[\s\S]*entitlementService/);
    assert.match(serverSource,
        /evidenceProvider:\s*adminBootstrapEvidenceProvider/);
    assert.match(serverSource,
        /reviewEvidenceProvider:\s*securityReviewEvidenceProvider,[\s\S]*securityAlertReader/);
    assert.doesNotMatch(serverSource,
        /security:\s*createSecurityPostureService|security:\s*\{\s*status:\s*["']ready/);
});
