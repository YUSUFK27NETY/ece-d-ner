const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "../public/admin/plan-packages.js"),
    "utf8"
);

test("plan package relabeling is idempotent before MutationObserver writes", () => {
    assert.match(source, /const expectedText = ` \\${text}`;/);
    assert.match(
        source,
        /if \(textNodes\.length === 1 && textNodes\[0\]\.textContent === expectedText\) \{\s*continue;\s*\}/
    );
    assert.match(source, /label\.append\(documentRef\.createTextNode\(expectedText\)\)/);
});
