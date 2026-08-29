"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
    EventEmitter
} = require("node:events");
const {
    requireJsonRequest,
    createSafeRequestLogger,
    configureServerTimeouts
} = require("../http-security");

test("gövde taşıyan API isteğinde JSON içerik türünü zorunlu tutar", () => {
    let nextCalled = false;
    const response = {
        statusCode: null,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };

    requireJsonRequest(
        {
            method: "POST",
            is() {
                return false;
            }
        },
        response,
        () => {
            nextCalled = true;
        }
    );

    assert.equal(nextCalled, false);
    assert.equal(response.statusCode, 415);
    assert.equal(response.body.success, false);
});

test("GET ve geçerli JSON isteklerini geçirir", () => {
    let calls = 0;
    const response = {};

    requireJsonRequest(
        {
            method: "GET",
            is() {
                return false;
            }
        },
        response,
        () => {
            calls += 1;
        }
    );

    requireJsonRequest(
        {
            method: "PATCH",
            is() {
                return true;
            }
        },
        response,
        () => {
            calls += 1;
        }
    );

    assert.equal(calls, 2);
});

test("istek günlüğüne gövde, IP veya yetkilendirme bilgisi koymaz", () => {
    const logs = [];
    const response = new EventEmitter();
    response.statusCode = 204;
    let clock = 100;

    const logger = createSafeRequestLogger({
        log: message => logs.push(message),
        now: () => {
            clock += 5;
            return clock;
        }
    });

    logger(
        {
            requestId: "request-1",
            method: "PATCH",
            path: "/api/admin/restaurant/status",
            body: { password: "hidden" },
            headers: { authorization: "Bearer hidden" },
            ip: "127.0.0.1"
        },
        response,
        () => {}
    );

    response.emit("finish");

    const entry = JSON.parse(logs[0]);

    assert.equal(entry.requestId, "request-1");
    assert.equal(entry.statusCode, 204);
    assert.equal(entry.durationMs, 5);
    assert.equal("body" in entry, false);
    assert.equal("headers" in entry, false);
    assert.equal("ip" in entry, false);
});

test("sunucuya yavaş istek sınırlarını uygular", () => {
    const server = {};

    configureServerTimeouts(server);

    assert.equal(server.headersTimeout, 10000);
    assert.equal(server.requestTimeout, 30000);
    assert.equal(server.keepAliveTimeout, 5000);
    assert.equal(server.maxRequestsPerSocket, 1000);
});
