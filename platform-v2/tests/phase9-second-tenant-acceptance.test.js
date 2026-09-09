const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    authorizeTenantAction
} = require("../src/auth/authorize-tenant-action");
const {
    loadPlatformGuardrailsConfig
} = require("../src/config/platform-guardrails-config");
const {
    createCommercialPlanPreviewService
} = require("../src/entitlements/commercial-plan-preview-service");
const {
    createEntitlementService
} = require("../src/entitlements/entitlement-service");
const {
    ACTIVATION_READINESS_SOURCES,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    createDomainReadinessService
} = require("../src/onboarding/domain-readiness-service");
const {
    createTenantMemberBootstrapService
} = require("../src/onboarding/tenant-member-bootstrap-service");
const {
    createInMemorySecurityAlertSink
} = require("../src/security/in-memory-security-alert-sink");
const {
    createSecurityPostureService
} = require("../src/security/security-posture-service");
const {
    assertTenantPathBelongsTo
} = require("../src/tenant/tenant-boundary");
const {
    createTenantContext
} = require("../src/tenant/tenant-context");
const {
    createTenantManagementService
} = require("../src/tenant/tenant-management-service");
const {
    createTenantLifecycleService
} = require("../src/tenant/tenant-lifecycle-service");
const {
    createTenantOperationsService
} = require("../src/operations/tenant-operations-service");
const {
    createTenantOnboardingService
} = require("../src/tenant/onboarding-service");
const {
    TENANT_STATUSES,
    createTenantRecord
} = require("../src/tenant/tenant-record");
const {
    TENANT_COLLECTIONS,
    tenantDocument,
    tenantRoot
} = require("../src/firestore/tenant-paths");

const FIRST_TENANT_ID = "synthetic-first-tenant";
const SECOND_TENANT_ID = "synthetic-second-tenant";
const PLATFORM_ACTOR_ID = "synthetic-platform-operator";
const CREATED_AT = new Date("2026-09-09T08:00:00.000Z");
const OBSERVED_AT = "2026-09-09T08:30:00.000Z";
const EVALUATED_AT_MS = Date.parse("2026-09-09T09:00:00.000Z");

function platformContext() {
    return createTenantContext({
        role: "platform_admin",
        actorId: PLATFORM_ACTOR_ID
    });
}

function tenantFixture(tenantId, overrides = {}) {
    return createTenantRecord({
        tenantId,
        displayName: tenantId === FIRST_TENANT_ID
            ? "Synthetic First Restaurant"
            : "Synthetic Second Restaurant",
        sector: "restaurant",
        plan: "synthetic-base",
        features: {
            catalog: true,
            orders: true
        },
        profile: {
            brandName: tenantId === FIRST_TENANT_ID
                ? "Synthetic First"
                : "Synthetic Second",
            timezone: "Europe/Istanbul"
        },
        createdBy: PLATFORM_ACTOR_ID,
        now: CREATED_AT,
        ...overrides
    });
}

function createRegistry(initialTenants = []) {
    const records = new Map(
        initialTenants.map(tenant => [tenant.tenantId, tenant])
    );
    const operations = [];

    const registry = Object.freeze({
        async getById(tenantId) {
            return records.get(tenantId) || null;
        },
        async list({ limit = 100 } = {}) {
            return [...records.values()].slice(0, limit);
        },
        async create(tenant) {
            if (records.has(tenant.tenantId)) {
                const error = new Error("Synthetic registry duplicate.");
                error.code = "TENANT_ALREADY_EXISTS";
                throw error;
            }
            records.set(tenant.tenantId, tenant);
            operations.push(Object.freeze({
                operation: "create",
                tenantId: tenant.tenantId
            }));
            return tenant;
        },
        async update(tenantId, tenant) {
            if (!records.has(tenantId)) {
                const error = new Error("Synthetic registry tenant missing.");
                error.code = "TENANT_NOT_FOUND";
                throw error;
            }
            if (tenant.tenantId !== tenantId) {
                const error = new Error("Synthetic registry scope mismatch.");
                error.code = "TENANT_BOUNDARY_VIOLATION";
                throw error;
            }
            records.set(tenantId, tenant);
            operations.push(Object.freeze({ operation: "update", tenantId }));
            return tenant;
        }
    });

    return { records, operations, registry };
}

function onboardingInput(overrides = {}) {
    return {
        tenantId: SECOND_TENANT_ID,
        displayName: "Synthetic Second Restaurant",
        sector: "restaurant",
        plan: "synthetic-base",
        features: { catalog: true, orders: true },
        profile: {
            brandName: "Synthetic Second",
            timezone: "Europe/Istanbul"
        },
        createdBy: PLATFORM_ACTOR_ID,
        requestId: "p9-6-create-second",
        now: CREATED_AT,
        ...overrides
    };
}

function readyAdapter(source) {
    return Object.freeze({
        async evaluate({ tenantId }) {
            return Object.freeze({
                source,
                tenantId,
                status: "ready",
                code: null,
                observedAt: OBSERVED_AT
            });
        }
    });
}

function allReadyAdapters() {
    return Object.fromEntries(
        ACTIVATION_READINESS_SOURCES.map(source => [source, readyAdapter(source)])
    );
}

function createReadyService() {
    return createCustomerReadinessService({
        sourceAdapters: allReadyAdapters(),
        clock: () => EVALUATED_AT_MS
    });
}

function createPlanConfig() {
    return loadPlatformGuardrailsConfig(JSON.stringify({
        plans: {
            "synthetic-base": {
                allowedFeatures: ["catalog", "orders"],
                softRequestLimit: 100,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            },
            "synthetic-expanded": {
                allowedFeatures: [
                    "catalog",
                    "orders",
                    "reservations",
                    "inventory"
                ],
                softRequestLimit: 200,
                warningThreshold: 0.8,
                dedicatedReviewThreshold: 1
            }
        }
    }));
}

test("shared onboarding ikinci sentetik tenantı ilk tenantı değiştirmeden oluşturur", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, { status: "active" });
    const state = createRegistry([firstTenant]);
    const audit = [];
    const service = createTenantOnboardingService({
        tenantRegistry: state.registry,
        auditWriter: {
            async write(event) { audit.push(event); }
        }
    });

    const secondTenant = await service.onboard(onboardingInput());

    assert.equal(state.records.size, 2);
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
    assert.strictEqual(state.records.get(SECOND_TENANT_ID), secondTenant);
    assert.equal(secondTenant.status, "provisioning");
    assert.deepEqual(state.operations, [
        { operation: "create", tenantId: SECOND_TENANT_ID }
    ]);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenantId, SECOND_TENANT_ID);
    assert.equal(audit[0].actorId, PLATFORM_ACTOR_ID);
    assert.equal(audit[0].requestId, "p9-6-create-second");
    assert.equal(audit[0].action, "tenant.created");
});

test("duplicate second-tenant create fail-closed kalır ve kayıtları overwrite etmez", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, { status: "active" });
    const state = createRegistry([firstTenant]);
    const audit = [];
    const service = createTenantOnboardingService({
        tenantRegistry: state.registry,
        auditWriter: {
            async write(event) { audit.push(event); }
        }
    });

    const created = await service.onboard(onboardingInput());
    await assert.rejects(
        () => service.onboard(onboardingInput({
            displayName: "Synthetic Overwrite Attempt"
        })),
        error => error?.code === "TENANT_ALREADY_EXISTS"
    );

    assert.equal(state.records.size, 2);
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
    assert.strictEqual(state.records.get(SECOND_TENANT_ID), created);
    assert.equal(state.operations.length, 1);
    assert.equal(audit.length, 1);
});

test("forged cross-tenant authorization ve path girişimleri exact scope'ta reddedilir", () => {
    const secondOwner = createTenantContext({
        tenantId: SECOND_TENANT_ID,
        role: "tenant_owner",
        actorId: "synthetic-second-owner"
    });
    const firstOrderPath = tenantDocument(
        FIRST_TENANT_ID,
        TENANT_COLLECTIONS.orders,
        "synthetic-order-1"
    );

    assert.equal(authorizeTenantAction({
        context: secondOwner,
        tenantId: SECOND_TENANT_ID,
        permission: "orders.manage"
    }), true);
    assert.throws(
        () => authorizeTenantAction({
            context: secondOwner,
            tenantId: FIRST_TENANT_ID,
            permission: "orders.manage"
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.throws(
        () => assertTenantPathBelongsTo(SECOND_TENANT_ID, firstOrderPath),
        error => error?.code === "TENANT_BOUNDARY_VIOLATION"
    );
});

test("tenant update yalnız ikinci tenantı değiştirir ve yapısal kimliği korur", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, { status: "active" });
    const secondTenant = tenantFixture(SECOND_TENANT_ID);
    const state = createRegistry([firstTenant, secondTenant]);
    const audit = [];
    const service = createTenantManagementService({
        tenantRegistry: state.registry,
        auditWriter: {
            async write(event) { audit.push(event); }
        }
    });

    const updated = await service.update({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-update-second",
        now: new Date("2026-09-09T09:05:00.000Z"),
        patch: {
            displayName: "Synthetic Second Updated",
            profile: {
                brandName: "Synthetic Second Updated",
                timezone: "Europe/Istanbul"
            }
        }
    });

    assert.equal(updated.tenantId, SECOND_TENANT_ID);
    assert.equal(updated.displayName, "Synthetic Second Updated");
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenantId, SECOND_TENANT_ID);
    assert.equal(audit[0].requestId, "p9-6-update-second");

    await assert.rejects(
        () => service.update({
            tenantId: SECOND_TENANT_ID,
            patch: { tenantId: FIRST_TENANT_ID }
        }),
        TypeError
    );
    assert.equal(state.operations.length, 1);
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
});

test("bağlı olmayan readiness kaynakları sahte ready üretmez", async () => {
    const tenant = tenantFixture(SECOND_TENANT_ID);
    const service = createCustomerReadinessService({
        sourceAdapters: {},
        clock: () => EVALUATED_AT_MS
    });

    const readiness = await service.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant
    });

    assert.equal(readiness.activationReadiness, "unavailable");
    assert.equal(readiness.canActivate, false);
    for (const source of ACTIVATION_READINESS_SOURCES) {
        assert.deepEqual(readiness.checks[source], {
            status: "unavailable",
            code: null,
            observedAt: null
        });
    }
});

test("genuine ready kaynaklar canActivate'i yalnız provisioning tenant için açar", async () => {
    const service = createReadyService();
    const provisioning = tenantFixture(SECOND_TENANT_ID);
    const active = tenantFixture(SECOND_TENANT_ID, { status: "active" });

    const ready = await service.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant: provisioning
    });
    const alreadyActive = await service.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant: active
    });

    assert.equal(ready.activationReadiness, "ready");
    assert.equal(ready.canActivate, true);
    assert.equal(alreadyActive.activationReadiness, "ready");
    assert.equal(alreadyActive.canActivate, false);
    await assert.rejects(
        () => service.evaluate({
            tenantId: SECOND_TENANT_ID,
            tenant: tenantFixture(FIRST_TENANT_ID)
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("commercial plan preview config-driven ve read-only kalır; unknown target kapanır", () => {
    const config = createPlanConfig();
    const entitlementService = createEntitlementService({ config });
    const service = createCommercialPlanPreviewService({
        config,
        entitlementService
    });
    const tenant = tenantFixture(SECOND_TENANT_ID);
    const before = JSON.stringify(tenant);
    const context = platformContext();
    const catalog = service.getCatalog({ context });

    assert.deepEqual(catalog.planIds, [
        "default", "synthetic-base", "synthetic-expanded"
    ]);
    const preview = service.preview({
        context,
        tenantId: SECOND_TENANT_ID,
        tenant,
        targetPlan: "synthetic-expanded"
    });

    assert.equal(preview.currentPlan, "synthetic-base");
    assert.equal(preview.targetPlan, "synthetic-expanded");
    assert.equal(preview.automaticApply, false);
    assert.equal(JSON.stringify(tenant), before);
    assert.equal(tenant.plan, "synthetic-base");
    assert.throws(
        () => service.preview({
            context,
            tenantId: SECOND_TENANT_ID,
            tenant,
            targetPlan: "synthetic-unknown"
        }),
        error => error?.code === "TARGET_PLAN_NOT_CONFIGURED"
    );
    assert.equal(tenant.plan, "synthetic-base");
});

test("member bootstrap contract-only kalır ve identity-provider mutationı çağırmaz", async () => {
    const intents = new Map();
    const audit = [];
    const service = createTenantMemberBootstrapService({
        registry: {
            async create(intent) {
                intents.set(intent.bootstrapId, intent);
            }
        },
        auditWriter: {
            async write(event) { audit.push(event); }
        },
        clock: () => new Date("2026-09-09T09:10:00.000Z")
    });
    const command = {
        context: {
            role: "platform_admin",
            actorId: PLATFORM_ACTOR_ID
        },
        tenantId: SECOND_TENANT_ID,
        subjectRef: "synthetic_subject_0001",
        kind: "initial_owner",
        role: "tenant_owner",
        requestId: "p9-6-bootstrap-second"
    };

    const intent = await service.createIntent(command);

    assert.equal(intent.tenantId, SECOND_TENANT_ID);
    assert.equal(intent.status, "external_identity_required");
    assert.equal(intent.externalIdentityWorkRequired, true);
    assert.equal(Object.hasOwn(intent, "subjectRef"), false);
    assert.equal(intents.size, 1);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].tenantId, SECOND_TENANT_ID);

    let providerCalls = 0;
    await assert.rejects(
        () => service.createIntent({
            ...command,
            identityProvider: {
                async invite() { providerCalls += 1; }
            }
        }),
        TypeError
    );
    assert.equal(providerCalls, 0);
    assert.equal(intents.size, 1);
});

test("configured domain stringi evidence olmadan verified sayılmaz", async () => {
    const tenant = tenantFixture(SECOND_TENANT_ID, {
        profile: {
            brandName: "Synthetic Second",
            timezone: "Europe/Istanbul",
            customDomain: "menu.synthetic.invalid"
        }
    });
    const service = createDomainReadinessService();

    const readiness = await service.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant
    });

    assert.deepEqual(readiness, {
        schemaVersion: 1,
        tenantId: SECOND_TENANT_ID,
        domain: "menu.synthetic.invalid",
        state: "unavailable",
        observedAt: null
    });
    assert.notEqual(readiness.state, "verified");
});

test("Security Alerts exact tenant; Security Posture platform scope ve read-only kalır", async () => {
    const sink = createInMemorySecurityAlertSink();
    const secondOwner = createTenantContext({
        tenantId: SECOND_TENANT_ID,
        role: "tenant_owner",
        actorId: "synthetic-second-owner"
    });

    assert.deepEqual(await sink.list({
        context: secondOwner,
        tenantId: SECOND_TENANT_ID,
        limit: 20
    }), []);
    await assert.rejects(
        () => sink.list({
            context: secondOwner,
            tenantId: FIRST_TENANT_ID,
            limit: 20
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );

    const postureReads = [];
    const postureService = createSecurityPostureService({
        securityAlertReader: {
            async list(input) {
                postureReads.push(input);
                return [];
            }
        },
        clock: () => EVALUATED_AT_MS
    });
    const posture = await postureService.getPlatformPosture({
        context: {
            role: "platform_admin",
            actorId: PLATFORM_ACTOR_ID
        }
    });

    assert.equal(posture.alerts.sourceState, "active");
    assert.equal(posture.alerts.recentVisibleCount, 0);
    assert.equal(postureReads.length, 1);
    assert.equal(postureReads[0].tenantId, null);

    const appSource = fs.readFileSync(
        path.resolve(__dirname, "../src/http/create-platform-app.js"),
        "utf8"
    );
    assert.match(appSource,
        /app\.get\("\/api\/platform\/tenants\/:tenantId\/security-alerts"/);
    assert.match(appSource,
        /app\.get\("\/api\/platform\/security-posture"/);
    assert.doesNotMatch(appSource,
        /app\.(?:post|patch|delete)\("\/api\/platform\/tenants\/:tenantId\/security-alerts"/);
    assert.doesNotMatch(appSource,
        /app\.(?:post|patch|delete)\("\/api\/platform\/security-posture"/);
});

test("operations ve backup görünürlüğü exact ikinci tenant projection'ında kalır", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, { status: "active" });
    const secondTenant = tenantFixture(SECOND_TENANT_ID);
    const state = createRegistry([firstTenant, secondTenant]);
    const calls = [];
    const usageTelemetry = {
        async getAggregate({ tenantId, period }) {
            calls.push({ dependency: `usage-${period}`, tenantId });
            return {
                requestCount: 0,
                errorCount: 0,
                latencyAverageMs: 0,
                latencyMaxMs: 0,
                providerUsage: {},
                backup: {}
            };
        }
    };
    const service = createTenantOperationsService({
        tenantRegistry: state.registry,
        usageTelemetry,
        entitlementService: {
            evaluate({ tenant }) {
                return {
                    featureEnabled: true,
                    plan: tenant.plan,
                    usedDefaultPlanPolicy: false,
                    limit: {
                        softLimit: 100,
                        usage: 0,
                        usageRatio: 0,
                        status: "ok",
                        warning: false
                    }
                };
            }
        },
        finOpsService: {
            async getTenantEstimate({ tenantId }) {
                calls.push({ dependency: "finops", tenantId });
                return { monthlyCost: 0 };
            }
        },
        securitySignals: {
            async listTenant({ tenantId }) {
                calls.push({ dependency: "security", tenantId });
                return [];
            }
        },
        backupEvidenceProvider: {
            async getStatus({ tenantId }) {
                calls.push({ dependency: "backup", tenantId });
                return {
                    sizeBytes: 64,
                    objectCount: 1,
                    verifiedAt: OBSERVED_AT,
                    restoreDrillAt: null,
                    restoreDrillStatus: "unknown",
                    providerPayload: "synthetic-private-provider-field",
                    authMaterial: "synthetic-private-auth-field"
                };
            }
        }
    });

    const overview = await service.getOverview({
        context: platformContext(),
        tenantId: SECOND_TENANT_ID,
        at: new Date("2026-09-09T09:12:00.000Z")
    });
    assert.equal(overview.tenantId, SECOND_TENANT_ID);
    assert.equal(overview.backup.objectCount, 1);
    assert.equal(overview.backup.verifiedAt, OBSERVED_AT);
    assert.equal(JSON.stringify(overview).includes("synthetic-private"), false);
    assert.equal(calls.every(call => call.tenantId === SECOND_TENANT_ID), true);

    const callCount = calls.length;
    await assert.rejects(
        () => service.getOverview({
            context: createTenantContext({
                tenantId: SECOND_TENANT_ID,
                role: "tenant_owner",
                actorId: "synthetic-second-owner"
            }),
            tenantId: FIRST_TENANT_ID
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.equal(calls.length, callCount);
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
});

test("suspend resume ve archive yalnız mevcut lifecycle durumlarını kullanır", async () => {
    const firstTenant = tenantFixture(FIRST_TENANT_ID, { status: "active" });
    const secondTenant = tenantFixture(SECOND_TENANT_ID);
    const state = createRegistry([firstTenant, secondTenant]);
    const audit = [];
    const management = createTenantManagementService({ tenantRegistry: state.registry });
    const readiness = createReadyService();
    const times = [15, 16, 17, 18, 19].map(minute =>
        new Date(`2026-09-09T09:${minute}:00.000Z`)
    );
    const lifecycle = createTenantLifecycleService({
        tenantRegistry: state.registry,
        customerReadinessService: readiness,
        auditWriter: {
            async write(event) { audit.push(event); }
        },
        clock: () => times.shift()
    });

    const activationGate = await readiness.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant: secondTenant
    });
    assert.equal(activationGate.canActivate, true);

    await assert.rejects(() => management.update({
        tenantId: SECOND_TENANT_ID,
        patch: { status: "active" }
    }), error => error?.code === "TENANT_LIFECYCLE_ACTION_REQUIRED");

    const active = await lifecycle.activate({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-activate-second"
    });
    const suspended = await lifecycle.suspend({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-suspend-second"
    });
    assert.equal(active.status, "active");
    assert.equal((await readiness.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant: suspended
    })).canActivate, false);

    const resumed = await lifecycle.resume({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-resume-second"
    });
    assert.equal(resumed.status, "active");

    await lifecycle.suspend({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-resuspend-second"
    });
    const archived = await lifecycle.archive({
        tenantId: SECOND_TENANT_ID,
        actorId: PLATFORM_ACTOR_ID,
        requestId: "p9-6-archive-second"
    });
    assert.equal((await readiness.evaluate({
        tenantId: SECOND_TENANT_ID,
        tenant: archived
    })).canActivate, false);
    assert.strictEqual(state.records.get(FIRST_TENANT_ID), firstTenant);
    for (const action of ["activate", "suspend", "resume", "archive"]) {
        await assert.rejects(
            () => lifecycle[action]({
                tenantId: SECOND_TENANT_ID,
                actorId: PLATFORM_ACTOR_ID
            }),
            error => error?.code === "TENANT_LIFECYCLE_INVALID_TRANSITION"
        );
    }
    assert.equal(audit.length, 5);
    assert.deepEqual(audit.map(event => event.requestId), [
        "p9-6-activate-second",
        "p9-6-suspend-second",
        "p9-6-resume-second",
        "p9-6-resuspend-second",
        "p9-6-archive-second"
    ]);

    assert.deepEqual(Array.from(TENANT_STATUSES), [
        "provisioning", "active", "suspended", "archived"
    ]);
    for (const unsupportedStatus of ["ready", "rollback", "restored"]) {
        await assert.rejects(
            () => management.update({
                tenantId: SECOND_TENANT_ID,
                patch: { status: unsupportedStatus }
            }),
            TypeError
        );
    }
    assert.equal(state.records.get(SECOND_TENANT_ID).status, "archived");
});

test("catalog order ve admin smoke aynı tenant permission ve path sınırını kullanır", () => {
    const secondOwner = createTenantContext({
        tenantId: SECOND_TENANT_ID,
        role: "tenant_owner",
        actorId: "synthetic-second-owner"
    });
    const secondProductPath = tenantDocument(
        SECOND_TENANT_ID,
        TENANT_COLLECTIONS.products,
        "synthetic-product-1"
    );
    const secondOrderPath = tenantDocument(
        SECOND_TENANT_ID,
        TENANT_COLLECTIONS.orders,
        "synthetic-order-1"
    );
    const secondMemberPath = tenantDocument(
        SECOND_TENANT_ID,
        TENANT_COLLECTIONS.members,
        "synthetic-member-1"
    );

    for (const permission of [
        "catalog.manage", "orders.manage", "members.manage"
    ]) {
        assert.equal(authorizeTenantAction({
            context: secondOwner,
            tenantId: SECOND_TENANT_ID,
            permission
        }), true);
    }
    for (const tenantPath of [
        secondProductPath, secondOrderPath, secondMemberPath
    ]) {
        assert.equal(
            assertTenantPathBelongsTo(SECOND_TENANT_ID, tenantPath),
            tenantPath
        );
        assert.throws(
            () => assertTenantPathBelongsTo(FIRST_TENANT_ID, tenantPath),
            error => error?.code === "TENANT_BOUNDARY_VIOLATION"
        );
    }
});

test("iki tenant aynı merkezi path/runtime modelini kullanır ve V1 izolasyonu korunur", () => {
    assert.equal(tenantRoot(FIRST_TENANT_ID),
        `tenants/${FIRST_TENANT_ID}`);
    assert.equal(tenantRoot(SECOND_TENANT_ID),
        `tenants/${SECOND_TENANT_ID}`);

    const platformRoot = path.resolve(__dirname, "..");
    const serverSource = fs.readFileSync(
        path.join(platformRoot, "server.js"),
        "utf8"
    );
    const phase9Sources = [
        "src/onboarding/customer-readiness-service.js",
        "src/onboarding/customer-readiness-adapters.js",
        "src/onboarding/tenant-member-bootstrap-contract.js",
        "src/onboarding/tenant-member-bootstrap-service.js",
        "src/onboarding/domain-readiness-service.js",
        "src/entitlements/commercial-plan-preview-service.js",
        "src/tenant/tenant-lifecycle-service.js"
    ].map(file => fs.readFileSync(path.join(platformRoot, file), "utf8"))
        .join("\n");

    assert.doesNotMatch(serverSource,
        /synthetic-first-tenant|synthetic-second-tenant/);
    assert.doesNotMatch(phase9Sources,
        /ece-d.ner|v1\/|\.\.\/\.\.\/(?:server|script)/iu);
    assert.doesNotMatch(phase9Sources,
        /inviteUser|enrollUser|createRecord|cloudflare|aws-sdk/iu);
});

test("runbook repo staging ve controlled-external gate'leri açıkça ayırır", () => {
    const platformRoot = path.resolve(__dirname, "..");
    const runbookName = "SECOND-TENANT-ACCEPTANCE-LAUNCH-RUNBOOK.md";
    const runbook = fs.readFileSync(
        path.join(platformRoot, runbookName),
        "utf8"
    );
    const readme = fs.readFileSync(
        path.join(platformRoot, "README.md"),
        "utf8"
    );

    assert.match(readme, new RegExp(runbookName));
    for (const heading of [
        "## Repo-automated acceptance gates",
        "## Live staging second-tenant checklist",
        "## Abort ve rollback kriterleri",
        "## Controlled external operations — bu paket çalıştırmaz"
    ]) {
        assert.equal(runbook.includes(heading), true, heading);
    }
    for (const requiredText of [
        "node --test platform-v2/tests/phase9-second-tenant-acceptance.test.js",
        "npm run ci",
        "npm audit",
        "npm run security:secrets",
        "tracked files ile Git history",
        "tam private-key block",
        "tenant-specific repo",
        "canActivate=false",
        "chat, log, issue"
    ]) {
        assert.equal(runbook.includes(requiredText), true, requiredText);
    }
});
