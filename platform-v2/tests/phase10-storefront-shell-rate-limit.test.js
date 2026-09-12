const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { once } = require("node:events");

const {
    attachPublicStorefrontRuntime
} = require("../src/http/attach-public-storefront-runtime");

async function withServer(rateLimiter, run) {
    const app = express();
    attachPublicStorefrontRuntime({
        app,
        storefrontService: {
            async get() {
                return { tenant: { tenantId: "ela-doner" }, products: [] };
            }
        },
        rateLimiter
    });

    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.close();
        await once(server, "close");
    }
}

test("storefront HTML shell route'ları sendFile öncesinde rate limiter çalıştırır", async () => {
    const seen = [];
    const blockingLimiter = (req, res) => {
        seen.push(req.path);
        return res.status(429).json({ success: false, message: "rate-limited" });
    };

    await withServer(blockingLimiter, async baseUrl => {
        const storefront = await fetch(`${baseUrl}/m/ela-doner`);
        assert.equal(storefront.status, 429);

        const appointments = await fetch(`${baseUrl}/m/ela-doner/appointments`);
        assert.equal(appointments.status, 429);
    });

    assert.deepEqual(seen, ["/m/ela-doner", "/m/ela-doner/appointments"]);
});
