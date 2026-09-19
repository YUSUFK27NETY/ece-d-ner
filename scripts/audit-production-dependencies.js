"use strict";

const fs = require("node:fs");
const path = require("node:path");

const NPM_BULK_ADVISORY_ENDPOINT =
    "https://registry.npmjs.org/-/npm/v1/security/advisories/bulk";
const AUDIT_THRESHOLD = "moderate";
const SEVERITY_RANK = Object.freeze({
    info: 0,
    low: 1,
    moderate: 2,
    high: 3,
    critical: 4
});

function fail(message, code = "DEPENDENCY_AUDIT_FAILED") {
    const error = new Error(message);
    error.code = code;
    throw error;
}

function isPlainObject(value) {
    return Boolean(value) &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function packageNameFromLockPath(location) {
    if (typeof location !== "string" || !location) return null;
    const marker = "node_modules/";
    const index = location.lastIndexOf(marker);
    if (index < 0) return null;
    const tail = location.slice(index + marker.length);
    const parts = tail.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    if (parts[0].startsWith("@")) {
        if (parts.length < 2) return null;
        return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
}

function buildBulkAdvisoryPayload(lockfile) {
    if (!isPlainObject(lockfile) ||
        ![2, 3].includes(lockfile.lockfileVersion) ||
        !isPlainObject(lockfile.packages)) {
        fail("package-lock.json desteklenen npm lockfile sözleşmesinde değil.");
    }

    const versionsByPackage = new Map();
    for (const [location, descriptor] of Object.entries(lockfile.packages)) {
        if (!location || !isPlainObject(descriptor) ||
            descriptor.dev === true || descriptor.optional === true) {
            continue;
        }
        const name = packageNameFromLockPath(location);
        const version = descriptor.version;
        if (!name || typeof version !== "string" || !version ||
            version.length > 128) {
            continue;
        }
        if (!versionsByPackage.has(name)) versionsByPackage.set(name, new Set());
        versionsByPackage.get(name).add(version);
    }

    if (versionsByPackage.size === 0) {
        fail("Audit edilecek production dependency bulunamadı.");
    }

    return Object.freeze(Object.fromEntries(
        [...versionsByPackage.entries()]
            .sort(([left], [right]) => left.localeCompare(right, "en"))
            .map(([name, versions]) => [
                name,
                Object.freeze([...versions].sort((left, right) =>
                    left.localeCompare(right, "en")))
            ])
    ));
}

function chunkBulkAdvisoryPayload(payload, batchSize = 50) {
    if (!isPlainObject(payload) || Object.keys(payload).length === 0 ||
        !Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) {
        fail("Dependency audit batch ayarı geçersiz.");
    }

    const entries = Object.entries(payload);
    const batches = [];
    for (let index = 0; index < entries.length; index += batchSize) {
        batches.push(Object.freeze(Object.fromEntries(
            entries.slice(index, index + batchSize)
        )));
    }
    return Object.freeze(batches);
}

function normalizeBulkResponse(value, payload) {
    if (!isPlainObject(value)) {
        fail("npm Bulk Advisory yanıtı geçersiz.");
    }

    const findings = [];
    for (const [packageName, advisories] of Object.entries(value)) {
        if (!Object.hasOwn(payload, packageName) || !Array.isArray(advisories)) {
            fail("npm Bulk Advisory yanıt kapsamı geçersiz.");
        }

        for (const advisory of advisories) {
            if (!isPlainObject(advisory) ||
                typeof advisory.severity !== "string" ||
                !Object.hasOwn(SEVERITY_RANK, advisory.severity)) {
                fail("npm Bulk Advisory kaydı geçersiz.");
            }
            const id = ["string", "number"].includes(typeof advisory.id)
                ? String(advisory.id)
                : null;
            if (!id || id.length > 160) {
                fail("npm Bulk Advisory kimliği geçersiz.");
            }
            findings.push(Object.freeze({
                packageName,
                advisoryId: id,
                severity: advisory.severity
            }));
        }
    }

    return Object.freeze(findings);
}

function isRetryableAuditStatus(status) {
    return status === 408 || status === 429 ||
        Number.isInteger(status) && status >= 500 && status <= 599;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function queryBulkAdvisories({
    payload,
    fetchImplementation = globalThis.fetch,
    endpoint = NPM_BULK_ADVISORY_ENDPOINT,
    timeoutMs = 20_000,
    attempts = 3,
    retryDelayMs = 500,
    sleepImplementation = sleep
} = {}) {
    if (!isPlainObject(payload) || Object.keys(payload).length === 0) {
        fail("npm Bulk Advisory payload geçersiz.");
    }
    if (typeof fetchImplementation !== "function") {
        fail("Dependency audit fetch desteği bulunamadı.");
    }
    if (endpoint !== NPM_BULK_ADVISORY_ENDPOINT) {
        fail("Dependency audit endpointi değiştirilemez.");
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) {
        fail("Dependency audit timeout geçersiz.");
    }
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 5 ||
        !Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 5_000 ||
        typeof sleepImplementation !== "function") {
        fail("Dependency audit retry ayarı geçersiz.");
    }

    let lastStatus = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let response = null;
        let networkFailed = false;

        try {
            response = await fetchImplementation(endpoint, {
                method: "POST",
                redirect: "error",
                signal: controller.signal,
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "User-Agent": "business-platform-v2-dependency-audit/1.0"
                },
                body: JSON.stringify(payload)
            });
        } catch {
            networkFailed = true;
        } finally {
            clearTimeout(timer);
        }

        if (networkFailed) {
            if (attempt < attempts) {
                await sleepImplementation(retryDelayMs);
                continue;
            }
            fail("npm Bulk Advisory servisine ulaşılamadı.");
        }

        lastStatus = response?.status ?? null;
        if (!response || response.ok !== true || response.status !== 200) {
            if (isRetryableAuditStatus(lastStatus) && attempt < attempts) {
                await sleepImplementation(retryDelayMs);
                continue;
            }
            fail(`npm Bulk Advisory HTTP ${lastStatus ?? "yanıt yok"}.`);
        }

        let body;
        try {
            body = await response.json();
        } catch {
            fail("npm Bulk Advisory JSON yanıtı okunamadı.");
        }
        return normalizeBulkResponse(body, payload);
    }

    fail(`npm Bulk Advisory HTTP ${lastStatus ?? "yanıt yok"}.`);
}

function enforceAuditThreshold(findings, threshold = AUDIT_THRESHOLD) {
    if (!Array.isArray(findings) || !Object.hasOwn(SEVERITY_RANK, threshold)) {
        fail("Dependency audit severity sözleşmesi geçersiz.");
    }

    const blocked = findings.filter(finding =>
        isPlainObject(finding) &&
        Object.hasOwn(SEVERITY_RANK, finding.severity) &&
        SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[threshold]
    );
    if (blocked.length > 0) {
        const summary = blocked
            .slice(0, 20)
            .map(item => `${item.packageName}:${item.advisoryId}:${item.severity}`)
            .join(", ");
        fail(
            `Production dependency advisory bulundu (${blocked.length}): ${summary}`,
            "DEPENDENCY_VULNERABILITIES_FOUND"
        );
    }

    return Object.freeze({
        threshold,
        advisoryCount: findings.length,
        blockedCount: 0
    });
}

async function auditProductionDependencies({
    lockfilePath = path.join(process.cwd(), "package-lock.json"),
    fetchImplementation = globalThis.fetch
} = {}) {
    let lockfile;
    try {
        lockfile = JSON.parse(fs.readFileSync(lockfilePath, "utf8"));
    } catch {
        fail("package-lock.json okunamadı.");
    }

    const payload = buildBulkAdvisoryPayload(lockfile);
    const batches = chunkBulkAdvisoryPayload(payload);
    const findings = [];
    for (const batch of batches) {
        findings.push(...await queryBulkAdvisories({
            payload: batch,
            fetchImplementation
        }));
    }
    const result = enforceAuditThreshold(findings);

    return Object.freeze({
        ...result,
        packageCount: Object.keys(payload).length,
        requestCount: batches.length,
        endpoint: NPM_BULK_ADVISORY_ENDPOINT
    });
}

async function main() {
    try {
        const result = await auditProductionDependencies();
        process.stdout.write(JSON.stringify({
            event: "production_dependency_audit",
            success: true,
            packageCount: result.packageCount,
            advisoryCount: result.advisoryCount,
            requestCount: result.requestCount,
            threshold: result.threshold
        }) + "\n");
    } catch (error) {
        process.stderr.write(JSON.stringify({
            event: "production_dependency_audit_failed",
            success: false,
            code: error?.code || "DEPENDENCY_AUDIT_FAILED",
            message: error?.message || "Dependency audit başarısız."
        }) + "\n");
        process.exitCode = 1;
    }
}

if (require.main === module) {
    void main();
}

module.exports = {
    AUDIT_THRESHOLD,
    NPM_BULK_ADVISORY_ENDPOINT,
    SEVERITY_RANK,
    auditProductionDependencies,
    buildBulkAdvisoryPayload,
    chunkBulkAdvisoryPayload,
    enforceAuditThreshold,
    isRetryableAuditStatus,
    normalizeBulkResponse,
    packageNameFromLockPath,
    queryBulkAdvisories
};
