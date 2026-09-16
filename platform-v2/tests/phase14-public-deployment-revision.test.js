const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    PUBLIC_DEPLOYMENT_API,
    attachPublicStorefrontRuntime,
    deploymentRevision
} = require("../src/http/attach-public-storefront-runtime");

const COMMIT = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

async function withServer(callback) {
    const app = express();
    attachPublicStorefrontRuntime({
        app,
        storefrontService: { async get() { throw new Error("unused"); } },
        rateLimiter(req, res, next) { next(); }
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
        server.once("listening", resolve);
        server.once("error", reject);
    });
    try {
        const address = server.address();
        await callback(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

test("deploymentRevision yalnız canonical 40 hex Render commit döndürür", () => {
    assert.equal(deploymentRevision({ RENDER_GIT_COMMIT: COMMIT.toUpperCase() }), COMMIT);
    assert.equal(deploymentRevision({ RENDER_GIT_COMMIT: "deadbeef" }), null);
    assert.equal(deploymentRevision({}), null);
});

test("public deployment endpoint runtime commit SHA'yı read-only döndürür", async () => {
    const previous = process.env.RENDER_GIT_COMMIT;
    process.env.RENDER_GIT_COMMIT = COMMIT;
    try {
        await withServer(async baseUrl => {
            const response = await fetch(`${baseUrl}${PUBLIC_DEPLOYMENT_API}`);
            assert.equal(response.status, 200);
            assert.deepEqual(await response.json(), {
                success: true,
                deployment: { commit: COMMIT }
            });
        });
    } finally {
        if (previous === undefined) delete process.env.RENDER_GIT_COMMIT;
        else process.env.RENDER_GIT_COMMIT = previous;
    }
});

test("public deployment endpoint query parametresini reddeder", async () => {
    await withServer(async baseUrl => {
        const response = await fetch(`${baseUrl}${PUBLIC_DEPLOYMENT_API}?debug=1`);
        assert.equal(response.status, 400);
        assert.deepEqual(await response.json(), {
            success: false,
            message: "Deployment sorgu parametresi kabul etmez."
        });
    });
});
