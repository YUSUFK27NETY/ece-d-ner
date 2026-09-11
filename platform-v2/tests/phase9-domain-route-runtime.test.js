const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createPublicRouteDomainEvidenceProvider
} = require("../src/onboarding/public-route-domain-evidence-provider");
const {
    createDomainReadinessService
} = require("../src/onboarding/domain-readiness-service");

const TENANT_ID = "phase9-domain-tenant";
const OTHER_TENANT_ID = "phase9-other-tenant";
const DOMAIN = "phase9.example.com";
const OBSERVED_AT = "2026-09-10T09:00:00.000Z";
const NOW_MS = Date.parse("2026-09-10T09:05:00.000Z");

function tenant(customDomain = DOMAIN) {
    return {
        tenantId: TENANT_ID,
        profile: { customDomain }
    };
}

function route({ tenantId = TENANT_ID, state = "active" } = {}) {
    return {
        schemaVersion: 1,
        domain: DOMAIN,
        tenantId,
        state,
        observedAt: OBSERVED_AT
    };
}

function serviceFor(routeValue) {
    const evidenceProvider = createPublicRouteDomainEvidenceProvider({
        routeReader: {
            async getByDomain(domain) {
                assert.equal(domain, DOMAIN);
                return routeValue;
            }
        }
    });
    return createDomainReadinessService({
        evidenceProvider,
        clock: () => NOW_MS
    });
}

test("active exact durable public route domain readiness'i verified yapar", async () => {
    const readiness = await serviceFor(route()).evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    });

    assert.deepEqual(Reflect.ownKeys(readiness), [
        "schemaVersion",
        "tenantId",
        "domain",
        "state",
        "observedAt"
    ]);
    assert.equal(readiness.schemaVersion, 1);
    assert.equal(readiness.tenantId, TENANT_ID);
    assert.equal(readiness.domain, DOMAIN);
    assert.equal(readiness.state, "verified");
    assert.equal(readiness.observedAt, OBSERVED_AT);
});

test("inactive durable public route verified üretmez, pending kalır", async () => {
    const readiness = await serviceFor(route({ state: "inactive" })).evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    });

    assert.equal(readiness.state, "pending");
    assert.equal(readiness.observedAt, OBSERVED_AT);
});

test("missing public route configured domain için fail-closed unavailable kalır", async () => {
    const readiness = await serviceFor(null).evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    });

    assert.equal(readiness.state, "unavailable");
    assert.equal(readiness.observedAt, null);
});

test("cross-tenant public route verified üretmez", async () => {
    const readiness = await serviceFor(route({ tenantId: OTHER_TENANT_ID })).evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    });

    assert.equal(readiness.state, "unavailable");
    assert.equal(readiness.observedAt, null);
});

test("provider malformed veya future evidence'i domain service üzerinden fail-closed tutar", async () => {
    const malformedProvider = createPublicRouteDomainEvidenceProvider({
        routeReader: {
            async getByDomain() {
                return {
                    schemaVersion: 1,
                    domain: DOMAIN,
                    tenantId: TENANT_ID,
                    state: "active",
                    observedAt: "not-a-time"
                };
            }
        }
    });
    const malformedService = createDomainReadinessService({
        evidenceProvider: malformedProvider,
        clock: () => NOW_MS
    });
    assert.equal((await malformedService.evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    })).state, "unavailable");

    const futureProvider = createPublicRouteDomainEvidenceProvider({
        routeReader: {
            async getByDomain() {
                return {
                    ...route(),
                    observedAt: "2026-09-10T10:00:00.000Z"
                };
            }
        }
    });
    const futureService = createDomainReadinessService({
        evidenceProvider: futureProvider,
        clock: () => NOW_MS
    });
    assert.equal((await futureService.evaluate({
        tenantId: TENANT_ID,
        tenant: tenant()
    })).state, "unavailable");
});
