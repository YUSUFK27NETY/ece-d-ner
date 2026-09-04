const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const express = require("express");
const { attachReadinessEndpoint } = require("../src/observability/attach-readiness-endpoint");
const { createReadinessChecker } = require("../src/observability/readiness-check");

async function withServer(checkReadiness, run) {
    const app = express();
    attachReadinessEndpoint({ app, checkReadiness });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();

    try {
        await run(`http://127.0.0.1:${port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
}

test("ready endpoint dependency sağlıklıysa 200 döner", async () => {
    await withServer(async () => ({
        ready: true,
        status: "ready",
        checkedAt: "2026-09-02T20:00:00.000Z",
        checks: { firestore: { status: "ok", durationMs: 2 } }
    }), async baseUrl => {
        const response = await fetch(`${baseUrl}/ready`);
        const body = await response.json();

        assert.equal(response.status, 200);
        assert.equal(body.success, true);
        assert.equal(body.status, "ready");
        assert.equal(body.checks.firestore.status, "ok");
    });
});

test("ready endpoint dependency arızasında 503 ve secret içermeyen cevap döner", async () => {
    await withServer(async () => ({
        ready: false,
        status: "not_ready",
        checkedAt: "2026-09-02T20:00:00.000Z",
        checks: { firestore: { status: "fail", code: "DEPENDENCY_ERROR", durationMs: 3 } }
    }), async baseUrl => {
        const response = await fetch(`${baseUrl}/ready`);
        const body = await response.json();

        assert.equal(response.status, 503);
        assert.equal(body.success, false);
        assert.equal(body.status, "not_ready");
        assert.equal(JSON.stringify(body).includes("password"), false);
    });
});

test("Firestore check exception mesajı ready 503 response içine sızmaz", async () => {
    const secretDetail = "private-key-body-must-not-leak";
    const checkReadiness = createReadinessChecker({
        checks: {
            firestore: async () => {
                throw Object.assign(new Error(secretDetail), { code: "FIRESTORE_UNAVAILABLE" });
            }
        }
    });

    await withServer(checkReadiness, async baseUrl => {
        const response = await fetch(`${baseUrl}/ready`);
        const rawBody = await response.text();
        const body = JSON.parse(rawBody);

        assert.equal(response.status, 503);
        assert.equal(body.status, "not_ready");
        assert.equal(body.checks.firestore.code, "FIRESTORE_UNAVAILABLE");
        assert.equal(rawBody.includes(secretDetail), false);
    });
});
