"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    initializeApp,
    cert,
    deleteApp
} = require("firebase-admin/app");
const {
    getAuth
} = require("firebase-admin/auth");
const {
    getFirestore
} = require("firebase-admin/firestore");

test("Firebase Admin 14 modüler API yüzeyi hazırdır", () => {
    assert.equal(typeof initializeApp, "function");
    assert.equal(typeof cert, "function");
    assert.equal(typeof deleteApp, "function");
    assert.equal(typeof getAuth, "function");
    assert.equal(typeof getFirestore, "function");
});
