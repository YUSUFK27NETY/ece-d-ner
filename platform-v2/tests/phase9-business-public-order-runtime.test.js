const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    PUBLIC_ROUTE_HMAC_ENV_KEY,
    attachConfiguredPublicOrderRuntime,
    createConfiguredPublicTenantResolver
} = require("../src/http/attach-configured-public-order-runtime");
const {
    PUBLIC_ORDER_PATH,
    PUBLIC_ROUTE_HEADERS
} = require("../src/http/attach-public-order-endpoint");
const {
    createPublicRouteSignature
} = require("../src/routing/public-route-attestation");

const NOW = new Date("2026-09-09T20:00:00.000Z");
const DOMAIN = "second.example.com";
const KEY = `runtime-public-route-${"k".repeat(32)}`;

function fakeDb(route = null) {
    return {
        collection(name) {
            assert.equal(name, "platformTenantPublicRoutes");
            return {
                doc(domain) {
                    return {
                        async get() {
                            if (!route) return { exists: false, id: domain };
                            return {
                                exists: true,
                                id: domain,
                                data() { return route; }
                            };
                        }
                    };
                }
            };
        }
    };
}

function tenantRegistry() {
    return {
        async getById(tenantId) {
            if (tenantId !== "second-tenant") return null;
            return {
                tenantId,
                status: "active",
                profile: { customDomain: DOMAIN }
            };
        }
    };
}

test("missing public-route HMAC env public endpointi attach etmez", () => {
    let postCalls = 0;
    const result = attachConfiguredPublicOrderRuntime({
        app: { post() { postCalls += 1; } },
        db: null,
        tenantRegistry: null,
        orderService: null,
        env: {}
    });
    assert.deepEqual(result, { enabled: false });
    assert.equal(postCalls, 0);
});

test("configured malformed HMAC key startup/configuration yolunda fail-closed olur", () => {
    assert.throws(
        () => createConfiguredPublicTenantResolver({
            db: fakeDb(),
            tenantRegistry: tenantRegistry(),
            env: { [PUBLIC_ROUTE_HMAC_ENV_KEY]: "short-key" },
            clock: () => NOW.getTime()
        }),
        error => error?.code === "PUBLIC_ROUTE_ATTESTATION_REQUIRED"
    );

    assert.throws(
        () => createConfiguredPublicTenantResolver({
            db: fakeDb(),
            tenantRegistry: tenantRegistry(),
            env: { [PUBLIC_ROUTE_HMAC_ENV_KEY]: ` ${KEY}` },
            clock: () => NOW.getTime()
        }),
        TypeError
    );
});

test("configured runtime signed durable route ile trusted tenant resolution üretir", async () => {
    const route = {
        schemaVersion: 1,
        domain: DOMAIN,
        tenantId: "second-tenant",
        state: "active",
        observedAt: NOW.toISOString()
    };
    const resolver = createConfiguredPublicTenantResolver({
        db: fakeDb(route),
        tenantRegistry: tenantRegistry(),
        env: { [PUBLIC_ROUTE_HMAC_ENV_KEY]: KEY },
        clock: () => NOW.getTime()
    });
    const timestamp = NOW.toISOString();
    const signature = createPublicRouteSignature({
        key: KEY,
        method: "POST",
        path: PUBLIC_ORDER_PATH,
        domain: DOMAIN,
        timestamp
    });
    const resolution = await resolver.resolve({
        method: "POST",
        path: PUBLIC_ORDER_PATH,
        domain: DOMAIN,
        timestamp,
        signature
    });
    assert.equal(resolution.tenantId, "second-tenant");
    assert.equal(resolution.source, "trusted_route");
});

test("configured attach yalnız public order routeunu ekler ve key projection yapmaz", () => {
    const route = {
        schemaVersion: 1,
        domain: DOMAIN,
        tenantId: "second-tenant",
        state: "active",
        observedAt: NOW.toISOString()
    };
    const registrations = [];
    const result = attachConfiguredPublicOrderRuntime({
        app: {
            post(routePath, ...handlers) {
                registrations.push({ routePath, handlers });
            }
        },
        db: fakeDb(route),
        tenantRegistry: tenantRegistry(),
        orderService: { async createCustomerOrder() {} },
        env: { [PUBLIC_ROUTE_HMAC_ENV_KEY]: KEY },
        clock: () => NOW.getTime(),
        rateLimiter: (_req, _res, next) => next()
    });
    assert.deepEqual(result, { enabled: true });
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].routePath, PUBLIC_ORDER_PATH);
    assert.equal(JSON.stringify(result).includes(KEY), false);
});

test("server runtime helperı additive bağlar, V1 veya hardcoded secret import etmez", () => {
    const serverSource = fs.readFileSync(
        path.join(__dirname, "..", "server.js"),
        "utf8"
    );
    assert.match(serverSource, /attachConfiguredPublicOrderRuntime/);
    assert.match(serverSource, /attachOrderAdminEndpoints/);
    assert.equal(serverSource.includes("order-request.js"), false);
    assert.equal(serverSource.includes("order-pricing.js"), false);
    assert.equal(serverSource.includes(KEY), false);
    assert.equal(serverSource.includes(PUBLIC_ROUTE_HEADERS.signature), false);
});
