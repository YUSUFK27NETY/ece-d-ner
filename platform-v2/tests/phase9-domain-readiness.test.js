const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    DOMAIN_READINESS_SOURCE_MAPPING,
    createCustomerReadinessSourceAdapters,
    createDomainReadinessAdapter
} = require("../src/onboarding/customer-readiness-adapters");
const {
    ACTIVATION_READINESS_SOURCES,
    createCustomerReadinessService
} = require("../src/onboarding/customer-readiness-service");
const {
    DOMAIN_READINESS_STATES,
    assertDomainReadiness,
    createDomainReadinessService
} = require("../src/onboarding/domain-readiness-service");
const { createTenantProfile } = require("../src/tenant/tenant-profile");
const { createTenantRecord } = require("../src/tenant/tenant-record");

const NOW_MS = Date.parse("2026-09-08T18:00:00.000Z");
const OBSERVED_AT = "2026-09-08T17:59:00.000Z";

function tenantFixture(customDomain = null) {
    return createTenantRecord({
        tenantId: "second-tenant",
        displayName: "Second Tenant",
        sector: "restaurant",
        profile: { customDomain },
        now: new Date("2026-09-08T17:00:00.000Z")
    });
}

function input(tenant = tenantFixture()) {
    return { tenantId: "second-tenant", tenant };
}

function evidenceProvider(result) {
    return {
        async getStatus() {
            return result;
        }
    };
}

function serviceWithEvidence(result) {
    return createDomainReadinessService({
        evidenceProvider: evidenceProvider(result),
        clock: () => NOW_MS
    });
}

function evidence(state, overrides = {}) {
    return {
        tenantId: "second-tenant",
        domain: "menu.example.com",
        state,
        observedAt: OBSERVED_AT,
        ...overrides
    };
}

function readyAdapter(source) {
    return {
        async evaluate({ tenantId }) {
            return {
                source,
                tenantId,
                status: "ready",
                code: null,
                observedAt: OBSERVED_AT
            };
        }
    };
}

async function aggregateWithDomain(domainAdapter, tenant) {
    const sourceAdapters = Object.fromEntries(
        ACTIVATION_READINESS_SOURCES
            .filter(source => source !== "domain")
            .map(source => [source, readyAdapter(source)])
    );
    sourceAdapters.domain = domainAdapter;
    const service = createCustomerReadinessService({
        sourceAdapters,
        clock: () => NOW_MS
    });
    return service.evaluate(input(tenant));
}

test("domain operational state allowlist server-owned ve sabittir", () => {
    assert.deepEqual(DOMAIN_READINESS_STATES, [
        "not_configured",
        "pending",
        "verified",
        "failed",
        "unavailable"
    ]);
    assert.equal(Object.isFrozen(DOMAIN_READINESS_STATES), true);
    assert.deepEqual(Object.keys(DOMAIN_READINESS_SOURCE_MAPPING),
        DOMAIN_READINESS_STATES);
});

test("customDomain yoksa truthful not_configured optional source aggregate'i gate etmez", async () => {
    let evidenceCalls = 0;
    const domainService = createDomainReadinessService({
        evidenceProvider: {
            async getStatus() {
                evidenceCalls += 1;
                return evidence("verified");
            }
        },
        clock: () => NOW_MS
    });
    const direct = await domainService.evaluate(input());
    const readiness = await aggregateWithDomain(
        createDomainReadinessAdapter({ domainReadinessService: domainService }),
        tenantFixture()
    );

    assert.deepEqual(direct, {
        schemaVersion: 1,
        tenantId: "second-tenant",
        domain: null,
        state: "not_configured",
        observedAt: null
    });
    assert.equal(assertDomainReadiness(direct), direct);
    assert.equal(evidenceCalls, 0);
    assert.deepEqual(readiness.checks.domain, {
        status: "pending",
        code: "DOMAIN_NOT_CONFIGURED",
        observedAt: null
    });
    assert.equal(readiness.activationReadiness, "ready");
    assert.equal(readiness.canActivate, true);
});

test("normalize edilmiş customDomain evidence yokken verified uydurmaz", async () => {
    const readiness = await createDomainReadinessService().evaluate(
        input(tenantFixture("menu.example.com"))
    );

    assert.deepEqual(readiness, {
        schemaVersion: 1,
        tenantId: "second-tenant",
        domain: "menu.example.com",
        state: "unavailable",
        observedAt: null
    });
    assert.notEqual(readiness.state, "verified");
});

test("yalnız trusted exact tenant ve domain evidence verified üretebilir", async () => {
    const calls = [];
    const service = createDomainReadinessService({
        evidenceProvider: {
            async getStatus(request) {
                calls.push(request);
                return evidence("verified");
            }
        },
        clock: () => NOW_MS
    });
    const direct = await service.evaluate(input(tenantFixture("menu.example.com")));
    const aggregate = await aggregateWithDomain(
        createDomainReadinessAdapter({ domainReadinessService: service }),
        tenantFixture("menu.example.com")
    );

    assert.deepEqual(calls, [
        { tenantId: "second-tenant", domain: "menu.example.com" },
        { tenantId: "second-tenant", domain: "menu.example.com" }
    ]);
    assert.equal(calls.every(Object.isFrozen), true);
    assert.equal(direct.state, "verified");
    assert.deepEqual(aggregate.checks.domain, {
        status: "ready",
        code: null,
        observedAt: OBSERVED_AT
    });
});

test("pending failed ve unavailable evidence Customer Readiness kaynağına deterministik eşlenir", async () => {
    for (const [state, expected] of [
        ["pending", { status: "pending", code: "DOMAIN_PENDING" }],
        ["failed", {
            status: "blocked",
            code: "DOMAIN_VERIFICATION_FAILED"
        }],
        ["unavailable", {
            status: "unavailable",
            code: "DOMAIN_UNAVAILABLE"
        }]
    ]) {
        const service = serviceWithEvidence(evidence(state));
        const readiness = await aggregateWithDomain(
            createDomainReadinessAdapter({ domainReadinessService: service }),
            tenantFixture("menu.example.com")
        );

        assert.deepEqual(readiness.checks.domain, {
            ...expected,
            observedAt: OBSERVED_AT
        });
        assert.equal(readiness.activationReadiness, "ready", state);
        assert.equal(readiness.canActivate, true, state);
    }
});

test("cross-tenant ve cross-domain evidence fail-closed unavailable olur", async () => {
    for (const forged of [
        evidence("verified", { tenantId: "other-tenant" }),
        evidence("verified", { domain: "other.example.com" })
    ]) {
        const result = await serviceWithEvidence(forged)
            .evaluate(input(tenantFixture("menu.example.com")));

        assert.equal(result.state, "unavailable");
        assert.equal(result.observedAt, null);
        assert.notEqual(result.state, "verified");
    }
});

test("malformed veya non-canonical domain ve evidence fail-closed reddedilir", async () => {
    const malformedTenant = { ...tenantFixture("menu.example.com") };
    malformedTenant.profile = {
        ...malformedTenant.profile,
        customDomain: "HTTPS://Menu.Example.Com/"
    };
    await assert.rejects(
        () => createDomainReadinessService().evaluate(input(malformedTenant)),
        TypeError
    );

    for (const malformedEvidence of [
        evidence("healthy"),
        evidence("verified", { domain: "HTTPS://Menu.Example.Com/" }),
        evidence("verified", { observedAt: "not-canonical" }),
        evidence("verified", {
            observedAt: new Date(NOW_MS + 1).toISOString()
        }),
        { state: "verified", observedAt: OBSERVED_AT }
    ]) {
        const result = await serviceWithEvidence(malformedEvidence)
            .evaluate(input(tenantFixture("menu.example.com")));
        assert.equal(result.state, "unavailable");
    }
});

test("provider exception safe unavailable olur ve raw hata projection'a sızmaz", async () => {
    const service = createDomainReadinessService({
        evidenceProvider: {
            async getStatus() {
                const error = new Error("raw-provider-error-marker");
                error.stack = "raw-provider-stack-marker";
                error.body = "raw-provider-body-marker";
                throw error;
            }
        },
        clock: () => NOW_MS
    });
    const result = await service.evaluate(input(tenantFixture("menu.example.com")));
    const serialized = JSON.stringify(result);

    assert.equal(result.state, "unavailable");
    for (const marker of [
        "raw-provider-error-marker",
        "raw-provider-stack-marker",
        "raw-provider-body-marker"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("hostile evidence secret PII ve raw alanları okumadan fixed projection üretir", async () => {
    let getterCalls = 0;
    const hostile = evidence("verified");
    const passwordMarker = ["synthetic", "field", "value"].join("-");
    for (const [key, value] of [
        ["token", "opaque-token-marker"],
        ["password", passwordMarker],
        ["secret", "opaque-secret-marker"],
        ["body", "opaque-body-marker"],
        ["headers", "opaque-header-marker"],
        ["email", "not-returned@example.invalid"],
        ["phone", "+000000000"],
        ["address", "not-returned-address-marker"]
    ]) {
        Object.defineProperty(hostile, key, {
            enumerable: true,
            get() {
                getterCalls += 1;
                return value;
            }
        });
    }
    const result = await serviceWithEvidence(hostile)
        .evaluate(input(tenantFixture("menu.example.com")));
    const serialized = JSON.stringify(result);

    assert.equal(result.state, "verified");
    assert.equal(getterCalls, 0);
    assert.deepEqual(Object.keys(result), [
        "schemaVersion", "tenantId", "domain", "state", "observedAt"
    ]);
    for (const marker of [
        "opaque-token-marker",
        passwordMarker,
        "opaque-secret-marker",
        "opaque-body-marker",
        "opaque-header-marker",
        "not-returned@example.invalid",
        "+000000000",
        "not-returned-address-marker"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("request ve tenant scope exact kalır; forged read model kabul edilmez", async () => {
    const service = createDomainReadinessService();
    const hostileRequest = input();
    hostileRequest[["pass", "word"].join("")] =
        ["not", "accepted"].join("-");

    await assert.rejects(
        () => service.evaluate(hostileRequest),
        TypeError
    );
    await assert.rejects(
        () => service.evaluate({ tenantId: "SECOND-TENANT", tenant: tenantFixture() }),
        TypeError
    );
    await assert.rejects(
        () => service.evaluate({ tenantId: "other-tenant", tenant: tenantFixture() }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
    assert.throws(
        () => assertDomainReadiness({
            schemaVersion: 1,
            tenantId: "second-tenant",
            domain: "menu.example.com",
            state: "verified",
            observedAt: OBSERVED_AT
        }),
        TypeError
    );
});

test("mevcut profile normalization korunur ve ikinci domain alanı oluşmaz", () => {
    const profile = createTenantProfile({
        customDomain: "HTTPS://Menu.Example.Com/"
    });

    assert.equal(profile.customDomain, "menu.example.com");
    assert.equal(Object.hasOwn(profile, "domain"), false);
    assert.throws(
        () => createTenantProfile({ customDomain: "menu.example.com/path" }),
        TypeError
    );
});

test("runtime metadata-only domain adapterını bağlar; mutation SDK/path veya V1 import etmez", () => {
    const adapters = createCustomerReadinessSourceAdapters({
        checkReadiness: async () => ({
            ready: true,
            checkedAt: OBSERVED_AT
        }),
        domainReadinessService: createDomainReadinessService()
    });
    assert.equal(Object.hasOwn(adapters, "domain"), true);

    const platformRoot = path.resolve(__dirname, "..");
    const serverSource = fs.readFileSync(
        path.join(platformRoot, "server.js"),
        "utf8"
    );
    const domainSource = fs.readFileSync(
        path.join(
            platformRoot,
            "src",
            "onboarding",
            "domain-readiness-service.js"
        ),
        "utf8"
    );

    assert.match(serverSource, /createDomainReadinessService\(\)/);
    assert.match(serverSource, /backupEvidenceProvider,[\s\S]*domainReadinessService/);
    assert.doesNotMatch(domainSource, /cloudflare|firebase-admin|aws-sdk|ece-d.ner|v1\/|\.\.\/\.\.\/server/iu);
    assert.doesNotMatch(domainSource, /\.(?:createRecord|update|patch|delete|upload|issue|provision|connect|verify)\s*\(/iu);
});
