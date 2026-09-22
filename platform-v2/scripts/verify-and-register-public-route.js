"use strict";

const net = require("node:net");
const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");
const { createFirestoreTenantRegistry } = require("../src/firestore/firestore-tenant-registry");
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
const { normalizeDomain } = require("../src/tenant/tenant-profile");

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_TIMEOUT_MS = 10_000;

function fail(message) {
    throw new Error(message);
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") fail("PLATFORM_PUBLIC_ROUTE_DOMAIN gerekli.");
    const domain = normalizeDomain(value);
    if (!domain || domain !== value) {
        fail("PLATFORM_PUBLIC_ROUTE_DOMAIN canonical olmalı.");
    }
    if (net.isIP(domain) !== 0 ||
        domain === "localhost" ||
        domain.endsWith(".localhost") ||
        domain.endsWith(".local") ||
        domain.endsWith(".internal") ||
        domain.endsWith(".lan")) {
        fail("Public route domain public hostname olmalı.");
    }
    return domain;
}

function requireExpectedCommit(env) {
    const commit = String(
        env.PLATFORM_PUBLIC_ROUTE_EXPECTED_COMMIT ||
        env.RENDER_GIT_COMMIT ||
        ""
    ).trim().toLowerCase();
    if (!COMMIT_PATTERN.test(commit)) {
        fail("Beklenen production commit SHA gerekli.");
    }
    return commit;
}

function loadConfig(env = process.env) {
    const tenantId = String(env.PLATFORM_PUBLIC_ROUTE_TENANT_ID || "").trim();
    if (!tenantId) fail("PLATFORM_PUBLIC_ROUTE_TENANT_ID gerekli.");
    const domain = requireCanonicalDomain(
        String(env.PLATFORM_PUBLIC_ROUTE_DOMAIN || "").trim()
    );
    const key = String(env.PLATFORM_PUBLIC_ROUTE_ATTESTATION_KEY || "");
    if (Buffer.byteLength(key, "utf8") < 32) {
        fail("PLATFORM_PUBLIC_ROUTE_ATTESTATION_KEY en az 32 byte olmalı.");
    }
    return Object.freeze({
        tenantId,
        domain,
        key,
        expectedCommit: requireExpectedCommit(env)
    });
}

async function probeDeployment({
    domain,
    expectedCommit,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
    if (typeof fetchImpl !== "function") fail("Fetch kullanılamıyor.");
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 30_000) {
        fail("Public route probe timeout geçersiz.");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(
            `https://${domain}/api/public/deployment`,
            {
                method: "GET",
                headers: { Accept: "application/json" },
                redirect: "error",
                signal: controller.signal
            }
        );
        if (!response || response.status !== 200) {
            fail("Custom domain production deployment endpointine ulaşmıyor.");
        }

        let body;
        try {
            body = await response.json();
        } catch {
            fail("Custom domain deployment yanıtı JSON değil.");
        }
        const commit = String(body?.deployment?.commit || "").trim().toLowerCase();
        if (body?.success !== true || commit !== expectedCommit) {
            fail("Custom domain beklenen production commitine yönlenmiyor.");
        }
        return Object.freeze({ commit });
    } finally {
        clearTimeout(timer);
    }
}

async function run({
    env = process.env,
    fetchImpl = globalThis.fetch,
    now = () => new Date()
} = {}) {
    const config = loadConfig(env);
    await probeDeployment({
        domain: config.domain,
        expectedCommit: config.expectedCommit,
        fetchImpl
    });

    const observed = now();
    if (!(observed instanceof Date) || Number.isNaN(observed.getTime())) {
        fail("Public route verification zamanı geçersiz.");
    }
    const timestamp = observed.toISOString();
    const signature = createPublicRouteSignature({
        key: config.key,
        method: "GET",
        path: "/api/public/deployment",
        domain: config.domain,
        timestamp
    });

    const { db } = createPlatformFirebase();
    const service = createPublicRouteProvisioningService({
        tenantRegistry: createFirestoreTenantRegistry({ db }),
        routeWriter: createFirestorePublicRouteWriter({ db }),
        attestationVerifier: createPublicRouteAttestationVerifier({
            key: config.key,
            clock: () => observed.getTime()
        })
    });

    return service.verifyAndActivate({
        tenantId: config.tenantId,
        domain: config.domain,
        timestamp,
        signature,
        actorId: "public-route-verifier",
        requestId: null
    });
}

if (require.main === module) {
    run()
        .then(route => {
            console.log(
                `PUBLIC_ROUTE_VERIFY_OK tenant=${route.tenantId} domain=${route.domain} state=${route.state}`
            );
        })
        .catch(() => {
            console.error("PUBLIC_ROUTE_VERIFY_FAILED");
            process.exitCode = 1;
        });
}

module.exports = {
    DEFAULT_TIMEOUT_MS,
    loadConfig,
    probeDeployment,
    run
};
