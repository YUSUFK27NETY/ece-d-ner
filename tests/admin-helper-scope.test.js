"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function functionEnd(source, start) {
    const paren = source.indexOf("(", start);
    assert.notEqual(paren, -1, "Function parameter list should exist");

    let parenDepth = 0;
    let paramEnd = -1;

    for (let i = paren; i < source.length; i += 1) {
        if (source[i] === "(") parenDepth += 1;
        if (source[i] === ")") {
            parenDepth -= 1;
            if (parenDepth === 0) {
                paramEnd = i + 1;
                break;
            }
        }
    }

    assert.notEqual(paramEnd, -1, "Function parameter list should close");

    const brace = source.indexOf("{", paramEnd);
    assert.notEqual(brace, -1, "Function body should exist");

    let depth = 0;
    for (let i = brace; i < source.length; i += 1) {
        if (source[i] === "{") depth += 1;
        if (source[i] === "}") {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }

    throw new Error("Function body should close");
}

test("admin fetch timeout helper is available at top-level scope", () => {
    const adminHtml = fs.readFileSync(
        path.join(__dirname, "..", "admin.html"),
        "utf8"
    );

    const setterStart = adminHtml.indexOf("function setConnectionState(");
    const helperStart = adminHtml.indexOf("async function fetchWithAdminTimeout(");

    assert.notEqual(setterStart, -1);
    assert.notEqual(helperStart, -1);
    assert.ok(
        helperStart > functionEnd(adminHtml, setterStart),
        "fetchWithAdminTimeout must not be nested inside setConnectionState"
    );

    const helperEnd = functionEnd(adminHtml, helperStart);
    const helperSource = adminHtml.slice(helperStart, helperEnd);

    assert.match(helperSource, /new AbortController\(\)/);
    assert.match(helperSource, /return await fetch\(/);
    assert.match(helperSource, /clearTimeout\(timer\);/);
});
