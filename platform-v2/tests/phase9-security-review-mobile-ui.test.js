const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const HTML = fs.readFileSync(
    path.join(__dirname, "../public/admin/security-review.html"),
    "utf8"
);
const JS = fs.readFileSync(
    path.join(__dirname, "../public/admin/security-review.js"),
    "utf8"
);

test("mobile security review page uses existing Firebase session and server-owned completion endpoint", () => {
    assert.match(HTML, /Launch Security Review/);
    assert.match(HTML, /security-review-tenant-id/);
    assert.match(HTML, /security-review-confirm/);
    assert.match(HTML, /security-review-complete/);
    assert.match(JS, /firebase\.auth\(\)\.currentUser/);
    assert.match(JS, /Authorization/);
    assert.match(JS, /\/security-alerts\?limit=200/);
    assert.match(JS, /\/readiness/);
    assert.match(JS, /\/security-review\/complete/);
    assert.match(JS, /method: "POST"/);
});

test("mobile review blocks warning high critical and truncated alert visibility", () => {
    assert.match(JS, /counts\.warning === 0/);
    assert.match(JS, /counts\.high === 0/);
    assert.match(JS, /counts\.critical === 0/);
    assert.match(JS, /alerts\.length < 200/);
    assert.match(JS, /reviewAllowed/);
    assert.equal(JS.includes("innerHTML"), false);
});

test("mobile review does not accept evidence state/source from form fields", () => {
    assert.doesNotMatch(HTML, /name=["']state["']/);
    assert.doesNotMatch(HTML, /name=["']source["']/);
    assert.doesNotMatch(HTML, /name=["']observedAt["']/);
    assert.equal(JS.includes("controlled_external_security_review"), false);
    assert.equal(JS.includes("state: \"verified\""), false);
});
