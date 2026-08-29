"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    checkLiveEndpoints
} = require("../live-health");

function response({
    ok = true,
    status = 200,
    text = "",
    json = {}
} = {}) {
    return {
        ok,
        status,
        async text() {
            return text;
        },
        async json() {
            return json;
        }
    };
}

test("müşteri, backend ve Firestore durum uçlarını doğrular", async () => {
    const fetchImplementation = async url => {
        if (url === "frontend") {
            return response({ text: "<h1>ECE DÖNER</h1>" });
        }

        if (url === "health") {
            return response({
                json: {
                    success: true,
                    status: "ok",
                    service: "qr-menu-pro"
                }
            });
        }

        return response({
            json: {
                success: true,
                isOpen: false
            }
        });
    };

    const result = await checkLiveEndpoints({
        fetchImplementation,
        frontendUrl: "frontend",
        backendHealthUrl: "health",
        backendStatusUrl: "status"
    });

    assert.equal(result.success, true);
    assert.equal(result.endpoints, 3);
});

test("backend sağlık cevabı bozuksa kontrolü başarısız yapar", async () => {
    const fetchImplementation = async url => {
        if (url === "frontend") {
            return response({ text: "ECE DÖNER" });
        }

        if (url === "health") {
            return response({
                json: {
                    success: true,
                    status: "degraded"
                }
            });
        }

        return response({
            json: {
                success: true,
                isOpen: true
            }
        });
    };

    await assert.rejects(
        checkLiveEndpoints({
            fetchImplementation,
            frontendUrl: "frontend",
            backendHealthUrl: "health",
            backendStatusUrl: "status"
        }),
        /beklenen biçimde değil/
    );
});

test("başarısız HTTP durumunu reddeder", async () => {
    const fetchImplementation = async url => {
        if (url === "frontend") {
            return response({ ok: false, status: 503 });
        }

        return response();
    };

    await assert.rejects(
        checkLiveEndpoints({
            fetchImplementation,
            frontendUrl: "frontend",
            backendHealthUrl: "health",
            backendStatusUrl: "status"
        }),
        /HTTP 503/
    );
});
