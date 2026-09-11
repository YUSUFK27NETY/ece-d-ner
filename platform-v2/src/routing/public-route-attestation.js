const crypto = require("node:crypto");
const { normalizeDomain } = require("../tenant/tenant-profile");

const PUBLIC_ROUTE_ATTESTATION_VERSION = "v1";
const DEFAULT_PUBLIC_ROUTE_MAX_SKEW_MS = 60_000;
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/;
const ISSUED_ATTESTATIONS = new WeakSet();

function fail() {
    const error = new Error("Public route attestation gerekli.");
    error.code = "PUBLIC_ROUTE_ATTESTATION_REQUIRED";
    throw error;
}

function requireKey(value) {
    const key = typeof value === "string"
        ? Buffer.from(value, "utf8")
        : Buffer.isBuffer(value)
            ? Buffer.from(value)
            : null;
    if (!key || key.length < 32 || key.length > 1024) fail();
    return key;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") fail();
    let domain;
    try {
        domain = normalizeDomain(value);
    } catch {
        fail();
    }
    if (!domain || domain !== value) fail();
    return domain;
}

function requireMethod(value) {
    if (typeof value !== "string" || !/^[A-Z]{3,10}$/.test(value)) fail();
    return value;
}

function requirePath(value) {
    if (typeof value !== "string" || value.length < 1 || value.length > 512 ||
        !value.startsWith("/") || value.includes("?") || value.includes("#") ||
        /[\u0000-\u001f]/.test(value)) {
        fail();
    }
    return value;
}

function requireTimestamp(value) {
    if (typeof value !== "string") fail();
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) fail();
    return { value, ms };
}

function requireSignature(value) {
    if (typeof value !== "string" || !SIGNATURE_PATTERN.test(value)) fail();
    return value;
}

function canonicalPayload({ method, path, domain, timestamp }) {
    return [
        PUBLIC_ROUTE_ATTESTATION_VERSION,
        timestamp,
        method,
        path,
        domain
    ].join("\n");
}

function createPublicRouteSignature({ key, method, path, domain, timestamp } = {}) {
    const safeKey = requireKey(key);
    const safeMethod = requireMethod(method);
    const safePath = requirePath(path);
    const safeDomain = requireCanonicalDomain(domain);
    const safeTimestamp = requireTimestamp(timestamp).value;
    return crypto
        .createHmac("sha256", safeKey)
        .update(canonicalPayload({
            method: safeMethod,
            path: safePath,
            domain: safeDomain,
            timestamp: safeTimestamp
        }), "utf8")
        .digest("hex");
}

function createPublicRouteAttestationVerifier({
    key,
    clock = Date.now,
    maxSkewMs = DEFAULT_PUBLIC_ROUTE_MAX_SKEW_MS
} = {}) {
    const safeKey = requireKey(key);
    if (typeof clock !== "function") fail();
    const safeMaxSkewMs = Number(maxSkewMs);
    if (!Number.isSafeInteger(safeMaxSkewMs) || safeMaxSkewMs < 1_000 ||
        safeMaxSkewMs > 300_000) {
        fail();
    }

    return Object.freeze({
        verify(input = {}) {
            if (!input || typeof input !== "object" || Array.isArray(input) ||
                Object.getPrototypeOf(input) !== Object.prototype) {
                fail();
            }
            const allowed = ["method", "path", "domain", "timestamp", "signature"];
            const keys = Reflect.ownKeys(input);
            if (keys.length !== allowed.length || keys.some(keyName =>
                typeof keyName !== "string" || !allowed.includes(keyName))) {
                fail();
            }
            for (const keyName of keys) {
                const descriptor = Object.getOwnPropertyDescriptor(input, keyName);
                if (!descriptor || !Object.hasOwn(descriptor, "value")) fail();
            }

            const method = requireMethod(input.method);
            const path = requirePath(input.path);
            const domain = requireCanonicalDomain(input.domain);
            const timestamp = requireTimestamp(input.timestamp);
            const signature = requireSignature(input.signature);
            const now = clock();
            if (!Number.isSafeInteger(now) || now <= 0 ||
                Math.abs(now - timestamp.ms) > safeMaxSkewMs) {
                fail();
            }

            const expected = createPublicRouteSignature({
                key: safeKey,
                method,
                path,
                domain,
                timestamp: timestamp.value
            });
            const expectedBuffer = Buffer.from(expected, "hex");
            const actualBuffer = Buffer.from(signature, "hex");
            if (expectedBuffer.length !== actualBuffer.length ||
                !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
                fail();
            }

            const attestation = Object.freeze({
                schemaVersion: 1,
                domain,
                observedAt: timestamp.value,
                method,
                path
            });
            ISSUED_ATTESTATIONS.add(attestation);
            return attestation;
        }
    });
}

function assertPublicRouteAttestation(value) {
    if (!value || typeof value !== "object" ||
        !ISSUED_ATTESTATIONS.has(value)) {
        fail();
    }
    return value;
}

module.exports = {
    DEFAULT_PUBLIC_ROUTE_MAX_SKEW_MS,
    PUBLIC_ROUTE_ATTESTATION_VERSION,
    assertPublicRouteAttestation,
    createPublicRouteAttestationVerifier,
    createPublicRouteSignature
};
