"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function readJson(file) {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function isVulnerableUuid(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(version || ""));
    if (!match) return true;

    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);

    if (major < 11) return true;
    if (major === 11) return minor < 1 || (minor === 1 && patch < 1);
    if (major === 12) return minor === 0 && patch === 0;
    if (major === 13) return minor === 0 && patch === 0;
    return false;
}

test("production dependency graph contains no uuid version affected by GHSA-w5hq-g745-h8pq", () => {
    const lock = readJson("package-lock.json");
    const vulnerable = [];

    for (const [location, descriptor] of Object.entries(lock.packages || {})) {
        if (!location || !descriptor || descriptor.dev === true) continue;
        const packageName = location.split("node_modules/").pop();
        if (packageName !== "uuid") continue;
        if (isVulnerableUuid(descriptor.version)) {
            vulnerable.push({
                location,
                version: descriptor.version,
                optional: descriptor.optional === true
            });
        }
    }

    assert.deepEqual(vulnerable, []);
});

test("dependency security audit includes optional production dependencies", () => {
    const pkg = readJson("package.json");
    const command = pkg.scripts?.["security:dependencies"] || "";

    assert.match(command, /npm audit --omit=dev --audit-level=moderate/);
    assert.doesNotMatch(command, /--omit=optional/);
});

test("Firebase Admin and Firestore stay on the patched aligned stack", () => {
    const pkg = readJson("package.json");
    const lock = readJson("package-lock.json");

    assert.equal(pkg.dependencies?.["firebase-admin"], "14.4.0");
    assert.equal(pkg.dependencies?.["@google-cloud/firestore"], "9.1.0");
    assert.equal(pkg.overrides?.gaxios?.uuid, "11.1.1");

    assert.equal(lock.packages?.["node_modules/firebase-admin"]?.version, "14.4.0");
    assert.equal(lock.packages?.["node_modules/@google-cloud/firestore"]?.version, "9.1.0");
    assert.equal(lock.packages?.["node_modules/@google-cloud/storage"]?.version, "8.2.0");
    assert.equal(lock.packages?.["node_modules/uuid"]?.version, "11.1.1");
});
