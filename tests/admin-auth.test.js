"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    hasAdminClaim
} = require("../admin-auth");

test("yalnızca açıkça admin claim'i olan tokenı kabul eder", () => {
    assert.equal(hasAdminClaim({ admin: true }), true);
    assert.equal(hasAdminClaim({ admin: false }), false);
    assert.equal(hasAdminClaim({ uid: "normal-user" }), false);
    assert.equal(hasAdminClaim(null), false);
});
