"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    NPM_BULK_ADVISORY_ENDPOINT,
    buildBulkAdvisoryPayload,
    enforceAuditThreshold,
    normalizeBulkResponse,
    packageNameFromLockPath,
    queryBulkAdvisories
} = require("../scripts/audit-production-dependencies");

function response({ status = 200, body = {} } = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return body;
        }
    };
}

test("package-lock v3 production ve optional paketleri bulk advisory payloadına taşır", () => {
    const payload = buildBulkAdvisoryPayload({
        lockfileVersion: 3,
        packages: {
            "": {
                name: "app",
                version: "1.0.0",
                dependencies: { prod: "1.0.0" }
            },
            "node_modules/prod": {
                version: "1.2.3"
            },
            "node_modules/optional-prod": {
                version: "2.0.0",
                optional: true
            },
            "node_modules/dev-only": {
                version: "3.0.0",
                dev: true
            },
            "node_modules/parent/node_modules/prod": {
                version: "1.2.4"
            },
            "node_modules/@scope/tool": {
                version: "4.5.6"
            }
        }
    });

    assert.deepEqual(payload, {
        "@scope/tool": ["4.5.6"],
        "optional-prod": ["2.0.0"],
        "prod": ["1.2.3", "1.2.4"]
    });
    assert.equal(Object.hasOwn(payload, "dev-only"), false);
});

test("lock path package adını nested ve scoped node_modules yollarından güvenli çıkarır", () => {
    assert.equal(packageNameFromLockPath("node_modules/express"), "express");
    assert.equal(
        packageNameFromLockPath("node_modules/a/node_modules/@scope/pkg"),
        "@scope/pkg"
    );
    assert.equal(packageNameFromLockPath(""), null);
    assert.equal(packageNameFromLockPath("packages/local"), null);
});

test("bulk advisory sorgusu yalnız sabit npm endpointine JSON POST yapar", async () => {
    const payload = { express: ["5.2.1"] };
    const calls = [];
    const findings = await queryBulkAdvisories({
        payload,
        fetchImplementation: async (url, options) => {
            calls.push({ url, options });
            return response({ body: {} });
        }
    });

    assert.deepEqual(findings, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, NPM_BULK_ADVISORY_ENDPOINT);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.redirect, "error");
    assert.equal(calls[0].options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(calls[0].options.body), payload);

    await assert.rejects(
        queryBulkAdvisories({
            payload,
            endpoint: "https://example.com/audit",
            fetchImplementation: async () => response()
        }),
        /endpointi değiştirilemez/
    );
});

test("moderate, high ve critical advisory audit eşiğini fail-closed durdurur", () => {
    const findings = normalizeBulkResponse({
        express: [
            { id: 1001, severity: "low" },
            { id: 1002, severity: "moderate" },
            { id: 1003, severity: "critical" }
        ]
    }, {
        express: ["5.2.1"]
    });

    assert.equal(findings.length, 3);
    assert.throws(
        () => enforceAuditThreshold(findings),
        error => error.code === "DEPENDENCY_VULNERABILITIES_FOUND" &&
            /moderate/.test(error.message) &&
            /critical/.test(error.message)
    );

    assert.deepEqual(
        enforceAuditThreshold([{
            packageName: "express",
            advisoryId: "1001",
            severity: "low"
        }]),
        {
            threshold: "moderate",
            advisoryCount: 1,
            blockedCount: 0
        }
    );
});

test("bulk advisory geçici 5xx sonrasında aynı payload ile retry edip başarılı olur", async () => {
    const payload = { express: ["5.2.1"] };
    let calls = 0;
    const sleeps = [];

    const findings = await queryBulkAdvisories({
        payload,
        attempts: 3,
        retryDelayMs: 25,
        sleepImplementation: async ms => {
            sleeps.push(ms);
        },
        fetchImplementation: async () => {
            calls += 1;
            if (calls < 3) return response({ status: 503 });
            return response({ body: {} });
        }
    });

    assert.deepEqual(findings, []);
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [25, 25]);
});

test("bulk advisory HTTP, network ve bozuk response hataları fail-closed kalır", async () => {
    const payload = { express: ["5.2.1"] };

    await assert.rejects(
        queryBulkAdvisories({
            payload,
            attempts: 1,
            fetchImplementation: async () => response({ status: 503 })
        }),
        /HTTP 503/
    );

    await assert.rejects(
        queryBulkAdvisories({
            payload,
            attempts: 1,
            fetchImplementation: async () => {
                throw new Error("network marker");
            }
        }),
        /ulaşılamadı/
    );

    await assert.rejects(
        queryBulkAdvisories({
            payload,
            fetchImplementation: async () => response({
                body: { unknown: [{ id: 1, severity: "high" }] }
            })
        }),
        /yanıt kapsamı geçersiz/
    );

    await assert.rejects(
        queryBulkAdvisories({
            payload,
            fetchImplementation: async () => response({
                body: { express: [{ id: 1, severity: "mystery" }] }
            })
        }),
        /kaydı geçersiz/
    );
});
