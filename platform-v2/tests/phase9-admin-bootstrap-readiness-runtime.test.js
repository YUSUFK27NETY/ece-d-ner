const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    addAdminBootstrapReadinessSource,
    createAdminBootstrapReadinessAdapter
} = require("../src/onboarding/admin-bootstrap-readiness-adapter");
const {
    createFirestoreAdminBootstrapEvidenceProvider
} = require("../src/firestore/firestore-admin-bootstrap-evidence-provider");

const TENANT_ID = "second-tenant";
const OBSERVED_AT = "2026-09-09T17:10:00.000Z";
const NOW_MS = Date.parse("2026-09-09T17:20:00.000Z");

function tenantFixture(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        status: "provisioning",
        ...overrides
    };
}

function evidenceFixture(state = "verified", overrides = {}) {
    return {
        schemaVersion: 1,
        tenantId: TENANT_ID,
        kind: "initial_owner",
        role: "tenant_owner",
        source: "controlled_external_identity",
        state,
        observedAt: OBSERVED_AT,
        ...overrides
    };
}

function evidenceProvider(value) {
    return Object.freeze({
        async getStatus() {
            return value;
        }
    });
}

async function evaluateAdmin(adapter, tenant = tenantFixture()) {
    const service = createCustomerReadinessService({
        sourceAdapters: { adminBootstrap: adapter },
        clock: () => NOW_MS
    });

    return service.evaluate({
        tenantId: TENANT_ID,
        tenant
    });
}

test("missing external completion evidence pending kalır", async () => {
    const readiness = await evaluateAdmin(
        createAdminBootstrapReadinessAdapter({
            evidenceProvider: evidenceProvider(null)
        })
    );

    assert.deepEqual(readiness.checks.adminBootstrap, {
        status: "pending",
        code: "ADMIN_BOOTSTRAP_PENDING",
        observedAt: null
    });
});

test("pending verified ve failed completion evidence deterministik eşlenir", async () => {
    for (const [state, expected] of [
        ["pending", {
            status: "pending",
            code: "ADMIN_BOOTSTRAP_PENDING"
        }],
        ["verified", {
            status: "ready",
            code: null
        }],
        ["failed", {
            status: "blocked",
            code: "ADMIN_BOOTSTRAP_BLOCKED"
        }]
    ]) {
        const readiness = await evaluateAdmin(
            createAdminBootstrapReadinessAdapter({
                evidenceProvider: evidenceProvider(evidenceFixture(state))
            })
        );
        assert.deepEqual(readiness.checks.adminBootstrap, {
            ...expected,
            observedAt: OBSERVED_AT
        });
    }
});

test("cross-tenant wrong role kind source timestamp veya extra evidence unavailable olur", async () => {
    const rawMarker = "synthetic-admin-evidence-private-marker";
    const badEvidence = [
        evidenceFixture("verified", { tenantId: "first-tenant" }),
        evidenceFixture("verified", { role: "tenant_admin" }),
        evidenceFixture("verified", { kind: "member" }),
        evidenceFixture("verified", { source: "other_source" }),
        evidenceFixture("verified", { observedAt: "not-canonical" }),
        evidenceFixture("verified", { schemaVersion: 2 }),
        {
            ...evidenceFixture(),
            rawProviderBody: rawMarker
        }
    ];

    for (const evidence of badEvidence) {
        const readiness = await evaluateAdmin(
            createAdminBootstrapReadinessAdapter({
                evidenceProvider: evidenceProvider(evidence)
            })
        );
        assert.deepEqual(readiness.checks.adminBootstrap, {
            status: "unavailable",
            code: null,
            observedAt: null
        });
        assert.equal(JSON.stringify(readiness).includes(rawMarker), false);
    }
});

test("provider exception safe unavailable olur ve raw ayrıntı sızdırmaz", async () => {
    const rawMarker = "synthetic-admin-provider-error-marker";
    const readiness = await evaluateAdmin(
        createAdminBootstrapReadinessAdapter({
            evidenceProvider: Object.freeze({
                async getStatus() {
                    throw new Error(rawMarker);
                }
            })
        })
    );

    assert.equal(readiness.checks.adminBootstrap.status, "unavailable");
    assert.equal(JSON.stringify(readiness).includes(rawMarker), false);
});

test("admin bootstrap adapter exact canonical tenant binding kullanır", async () => {
    const adapter = createAdminBootstrapReadinessAdapter({
        evidenceProvider: evidenceProvider(null)
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

test("Firestore evidence provider fixed tenant settings pathini read-only okur", async () => {
    const calls = [];
    const db = {
        doc(documentPath) {
            calls.push(documentPath);
            return {
                async get() {
                    return {
                        exists: true,
                        data() {
                            return evidenceFixture();
                        }
                    };
                }
            };
        }
    };
    const provider = createFirestoreAdminBootstrapEvidenceProvider({ db });

    assert.deepEqual(await provider.getStatus({ tenantId: TENANT_ID }),
        evidenceFixture());
    assert.deepEqual(calls, [
        "tenants/second-tenant/settings/admin-bootstrap-readiness"
    ]);

    const providerSource = fs.readFileSync(
        path.resolve(
            __dirname,
            "../src/firestore/firestore-admin-bootstrap-evidence-provider.js"
        ),
        "utf8"
    );
    assert.doesNotMatch(providerSource,
        /\.create\(|\.set\(|\.update\(|\.delete\(|inviteUser|enrollUser|firebase-admin\/auth/);
});

test("Firestore missing veya unsafe evidence fake ready üretmez", async () => {
    const missingProvider = createFirestoreAdminBootstrapEvidenceProvider({
        db: {
            doc() {
                return {
                    async get() {
                        return { exists: false };
                    }
                };
            }
        }
    });
    assert.equal(await missingProvider.getStatus({ tenantId: TENANT_ID }), null);

    const unsafeProvider = createFirestoreAdminBootstrapEvidenceProvider({
        db: {
            doc() {
                return {
                    async get() {
                        return {
                            exists: true,
                            data() {
                                return {
                                    ...evidenceFixture(),
                                    rawProviderBody: "synthetic-private-field"
                                };
                            }
                        };
                    }
                };
            }
        }
    });
    await assert.rejects(
        () => unsafeProvider.getStatus({ tenantId: TENANT_ID }),
        TypeError
    );
});

test("server planı koruyup adminBootstrap source ekler security ise unavailable kalır", () => {
    const base = Object.freeze({
        plan: Object.freeze({ evaluate() {} })
    });
    const composed = addAdminBootstrapReadinessSource({
        sourceAdapters: base,
        evidenceProvider: evidenceProvider(null)
    });

    assert.deepEqual(Object.keys(composed), ["plan", "adminBootstrap"]);
    assert.equal(Object.hasOwn(composed, "security"), false);

    const platformRoot = path.resolve(__dirname, "..");
    const serverSource = fs.readFileSync(
        path.join(platformRoot, "server.js"),
        "utf8"
    );
    assert.match(serverSource, /createFirestoreAdminBootstrapEvidenceProvider/);
    assert.match(serverSource, /addAdminBootstrapReadinessSource/);
    assert.match(serverSource,
        /createCustomerReadinessSourceAdapters\(\{[\s\S]*checkReadiness,[\s\S]*backupEvidenceProvider/);
    assert.match(serverSource,
        /plan:\s*createPlanReadinessAdapter\(\{[\s\S]*guardrailsConfig,[\s\S]*entitlementService/);
    assert.match(serverSource,
        /evidenceProvider:\s*adminBootstrapEvidenceProvider/);
    assert.doesNotMatch(serverSource, /security:\s*createSecurityReadiness/);
});
