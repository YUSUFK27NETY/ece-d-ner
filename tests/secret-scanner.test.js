"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    DEFAULT_PUBLIC_VALUES,
    scanText
} = require("../secret-scanner");

test("erişim anahtarı ve özel anahtar başlığını yakalar", () => {
    const githubToken =
        "ghp_" + "A".repeat(32);
    const privateKey =
        "-----BEGIN " + "PRIVATE KEY-----";

    const findings = scanText(
        `${githubToken}\n${privateKey}`,
        "fixture"
    );

    assert.equal(findings.length, 2);
    assert.equal(
        findings.some(
            finding => /GitHub/.test(finding.detector)
        ),
        true
    );
    assert.equal(
        findings.some(
            finding => /özel anahtar/.test(finding.detector)
        ),
        true
    );
});

test("Firebase tarayıcı kimliğini bilinen açık değer olarak kabul eder", () => {
    const findings = scanText(
        `apiKey: "${DEFAULT_PUBLIC_VALUES[0]}"`,
        "script.js"
    );

    assert.deepEqual(findings, []);
});

test("kod içine yazılmış genel client secret değerini yakalar", () => {
    const source =
        "client_" +
        "secret = \"do-not-store-this-value\"";

    const findings = scanText(source, "config.js");

    assert.equal(findings.length, 1);
    assert.match(findings[0].detector, /gizli değer/);
    assert.doesNotMatch(
        findings[0].preview,
        /do-not-store-this-value/
    );
});

test("OAuth kodunu yakalayıp package-lock parçasını yanlış işaretlemez", () => {
    const oauthCode =
        "4/" + "0ATs" + "MZqC".repeat(8);

    assert.equal(
        scanText(oauthCode, "auth.txt").length,
        1
    );
    assert.equal(
        scanText(
            "sha512-4/QZabcdefghijklmnopqrstuv",
            "package-lock.json"
        ).length,
        0
    );
});
