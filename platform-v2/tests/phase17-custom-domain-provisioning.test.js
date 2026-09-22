"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createAuditEvent } = require("../src/audit/audit-event");
const {
    createFirestorePublicRouteWriter
} = require("../src/firestore/firestore-public-route-writer");
const {
    createPublicRouteAttestationVerifier,
    createPublicRouteSignature
} = require("../src/routing/public-route-attestation");
const {
    createPublicRouteProvisioningService
} = require("../src/routing/public-route-provisioning-service");
const {
    loadConfig,
    probeDeployment
} = require("../scripts/verify-and-register-public-route");

const TENANT_ID = "custom-domain-tenant";
const DOMAIN = "menu.example.com";
const OTHER_DOMAIN = "other.example.com";
const KEY = "k".repeat(48);
const TIMESTAMP = "2026-09-22T18:45:00.000Z";
const COMMIT = "a".repeat(40);

function tenant({
    status = "active",
    customDomain = DOMAIN
} = {}) {
    return {
        tenantId: TENANT_ID,
        displayName: "Custom Domain Tenant",
        sector: "restaurant",
        status,
        plan: "starter",
        features: {},
        profile: {
            customDomain,
            timezone: "Europe/Istanbul"
        }
    };
}

function signedInput(domain = DOMAIN) {
    return {
        tenantId: TENANT_ID,
        domain,
        timestamp: TIMESTAMP,
        signature: createPublicRouteSignature({
            key: KEY,
            method: "GET",
            path: "/api/public/deployment",
            domain,
            timestamp: TIMESTAMP
        }),
        actorId: "public-route-verifier",
        requestId: "route-request-1"
    };
}

test("attested exact custom domain active route olarak yazılır ve audit metadata sınırlı kalır", async () => {
    const writes = [];
    const service = createPublicRouteProvisioningService({
        tenantRegistry: {
            async getById(id) {
                assert.equal(id, TENANT_ID);
                return tenant();
            }
        },
        routeWriter: {
            async commitVerifiedRoute(input) {
                writes.push(input);
                return {
                    schemaVersion: 1,
                    domain: input.domain,
                    tenantId: input.tenantId,
                    state: "active",
                    observedAt: input.observedAt
                };
            }
        },
        attestationVerifier: createPublicRouteAttestationVerifier({
            key: KEY,
            clock: () => Date.parse(TIMESTAMP)
        })
    });

    const route = await service.verifyAndActivate(signedInput());

    assert.equal(route.domain, DOMAIN);
    assert.equal(route.tenantId, TENANT_ID);
    assert.equal(route.state, "active");
    assert.equal(writes.length, 1);
    assert.equal(writes[0].observedAt, TIMESTAMP);
    assert.equal(writes[0].auditEvent.action, "tenant.public_route.verified");
    assert.deepEqual(writes[0].auditEvent.metadata, {
        domain: DOMAIN,
        verification: "deployment_probe"
    });

    const serialized = JSON.stringify(writes[0]);
    assert.equal(serialized.includes(KEY), false);
    assert.equal(serialized.includes(signedInput().signature), false);
});

test("tenant profile domain mismatch veya tenant state geçersizse route writer çağrılmaz", async () => {
    for (const currentTenant of [
        tenant({ customDomain: OTHER_DOMAIN }),
        tenant({ status: "suspended" }),
        tenant({ status: "archived" })
    ]) {
        let calls = 0;
        const service = createPublicRouteProvisioningService({
            tenantRegistry: {
                async getById() {
                    return currentTenant;
                }
            },
            routeWriter: {
                async commitVerifiedRoute() {
                    calls += 1;
                    throw new Error("çağrılmamalı");
                }
            },
            attestationVerifier: createPublicRouteAttestationVerifier({
                key: KEY,
                clock: () => Date.parse(TIMESTAMP)
            })
        });

        await assert.rejects(
            () => service.verifyAndActivate(signedInput()),
            error => new Set([
                "PUBLIC_ROUTE_PROFILE_MISMATCH",
                "PUBLIC_ROUTE_TENANT_STATE_INVALID"
            ]).has(error?.code)
        );
        assert.equal(calls, 0);
    }
});

test("deployment probe yalnız HTTPS custom domain ve exact expected production commit kabul eder", async () => {
    const calls = [];
    const result = await probeDeployment({
        domain: DOMAIN,
        expectedCommit: COMMIT,
        fetchImpl: async (url, options) => {
            calls.push({ url, options });
            return {
                status: 200,
                async json() {
                    return {
                        success: true,
                        deployment: { commit: COMMIT }
                    };
                }
            };
        }
    });

    assert.equal(result.commit, COMMIT);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `https://${DOMAIN}/api/public/deployment`);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[0].options.redirect, "error");
    assert.ok(calls[0].options.signal instanceof AbortSignal);

    await assert.rejects(
        () => probeDeployment({
            domain: DOMAIN,
            expectedCommit: COMMIT,
            fetchImpl: async () => ({
                status: 200,
                async json() {
                    return {
                        success: true,
                        deployment: { commit: "b".repeat(40) }
                    };
                }
            })
        }),
        /beklenen production commitine yönlenmiyor/
    );

    await assert.rejects(
        () => probeDeployment({
            domain: DOMAIN,
            expectedCommit: COMMIT,
            fetchImpl: async () => ({
                status: 503,
                async json() {
                    return {};
                }
            })
        }),
        /production deployment endpointine ulaşmıyor/
    );
});

test("route CLI config private/local host, kısa key ve belirsiz commit ile çalışmaz", () => {
    const valid = {
        PLATFORM_PUBLIC_ROUTE_TENANT_ID: TENANT_ID,
        PLATFORM_PUBLIC_ROUTE_DOMAIN: DOMAIN,
        PLATFORM_PUBLIC_ROUTE_ATTESTATION_KEY: KEY,
        PLATFORM_PUBLIC_ROUTE_EXPECTED_COMMIT: COMMIT
    };
    assert.deepEqual(loadConfig(valid), {
        tenantId: TENANT_ID,
        domain: DOMAIN,
        key: KEY,
        expectedCommit: COMMIT
    });

    for (const badDomain of [
        "127.0.0.1",
        "localhost",
        "dev.local",
        "service.internal",
        "router.lan"
    ]) {
        assert.throws(
            () => loadConfig({
                ...valid,
                PLATFORM_PUBLIC_ROUTE_DOMAIN: badDomain
            })
        );
    }
    assert.throws(
        () => loadConfig({
            ...valid,
            PLATFORM_PUBLIC_ROUTE_ATTESTATION_KEY: "short"
        })
    );
    assert.throws(
        () => loadConfig({
            ...valid,
            PLATFORM_PUBLIC_ROUTE_EXPECTED_COMMIT: ""
        })
    );
});

function createFakeFirestore(initialEntries = []) {
    const docs = new Map(initialEntries);
    const ref = path => ({
        path,
        id: path.split("/").at(-1)
    });

    return {
        docs,
        collection(name) {
            return {
                doc(id) {
                    return ref(`${name}/${id}`);
                }
            };
        },
        doc(path) {
            return ref(path);
        },
        async runTransaction(callback) {
            const pending = [];
            const transaction = {
                async get(docRef) {
                    const value = docs.get(docRef.path);
                    return {
                        exists: value !== undefined,
                        id: docRef.id,
                        data() {
                            return value;
                        }
                    };
                },
                create(docRef, value) {
                    pending.push(["create", docRef.path, { ...value }]);
                },
                set(docRef, value) {
                    pending.push(["set", docRef.path, { ...value }]);
                }
            };

            const result = await callback(transaction);
            for (const [operation, path, value] of pending) {
                if (operation === "create" && docs.has(path)) {
                    throw new Error("already exists");
                }
                docs.set(path, value);
            }
            return result;
        }
    };
}

test("Firestore public route writer route ve audit kaydını aynı transactionda yazar", async () => {
    const db = createFakeFirestore();
    const writer = createFirestorePublicRouteWriter({ db });
    const auditEvent = createAuditEvent({
        tenantId: TENANT_ID,
        action: "tenant.public_route.verified",
        actorId: "public-route-verifier",
        requestId: "route-request-1",
        metadata: {
            domain: DOMAIN,
            verification: "deployment_probe"
        },
        now: new Date(TIMESTAMP)
    });

    const route = await writer.commitVerifiedRoute({
        tenantId: TENANT_ID,
        domain: DOMAIN,
        observedAt: TIMESTAMP,
        auditEvent
    });

    assert.equal(route.state, "active");
    assert.deepEqual(
        db.docs.get(`platformTenantPublicRoutes/${DOMAIN}`),
        {
            schemaVersion: 1,
            domain: DOMAIN,
            tenantId: TENANT_ID,
            state: "active",
            observedAt: TIMESTAMP
        }
    );
    assert.deepEqual(
        db.docs.get(`tenants/${TENANT_ID}/audit/${auditEvent.eventId}`),
        auditEvent
    );
});

test("Firestore public route writer başka tenantın active domain routeunu devralmaz ve partial audit yazmaz", async () => {
    const db = createFakeFirestore([
        [
            `platformTenantPublicRoutes/${DOMAIN}`,
            {
                schemaVersion: 1,
                domain: DOMAIN,
                tenantId: "other-tenant",
                state: "active",
                observedAt: TIMESTAMP
            }
        ]
    ]);
    const writer = createFirestorePublicRouteWriter({ db });
    const auditEvent = createAuditEvent({
        tenantId: TENANT_ID,
        action: "tenant.public_route.verified",
        actorId: "public-route-verifier",
        requestId: "route-request-2",
        metadata: {
            domain: DOMAIN,
            verification: "deployment_probe"
        },
        now: new Date(TIMESTAMP)
    });

    await assert.rejects(
        () => writer.commitVerifiedRoute({
            tenantId: TENANT_ID,
            domain: DOMAIN,
            observedAt: TIMESTAMP,
            auditEvent
        }),
        error => error?.code === "PUBLIC_ROUTE_DOMAIN_CONFLICT"
    );

    assert.equal(
        db.docs.has(`tenants/${TENANT_ID}/audit/${auditEvent.eventId}`),
        false
    );
    assert.equal(
        db.docs.get(`platformTenantPublicRoutes/${DOMAIN}`).tenantId,
        "other-tenant"
    );
});
