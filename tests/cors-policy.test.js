"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    PRODUCTION_FRONTEND_ORIGIN,
    getAllowedOrigins,
    createOriginValidator
} = require("../cors-policy");

function validate(validator, origin) {
    return new Promise(resolve => {
        validator(origin, (error, allowed) => {
            resolve({ error, allowed });
        });
    });
}

test("canlı GitHub Pages origin'i varsayılan olarak izinlidir", () => {
    const origins = getAllowedOrigins();

    assert.equal(
        origins.has(PRODUCTION_FRONTEND_ORIGIN),
        true
    );
});

test("ortam değişkenindeki URL yollarını origin biçimine dönüştürür", () => {
    const origins = getAllowedOrigins(
        "https://example.com/menu, http://localhost:5500/test"
    );

    assert.equal(origins.has("https://example.com"), true);
    assert.equal(origins.has("http://localhost:5500"), true);
});

test("rastgele tarayıcı origin'ini reddeder", async () => {
    const result = await validate(
        createOriginValidator(),
        "https://example.invalid"
    );

    assert.equal(result.allowed, undefined);
    assert.match(result.error.message, /CORS/);
});

test("Origin göndermeyen sunucu isteklerine izin verir", async () => {
    const result = await validate(
        createOriginValidator(),
        undefined
    );

    assert.equal(result.error, null);
    assert.equal(result.allowed, true);
});
