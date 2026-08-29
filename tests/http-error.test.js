"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    classifyHttpError
} = require("../http-error");

test("bozuk JSON isteğini 400 olarak sınıflandırır", () => {
    assert.deepEqual(
        classifyHttpError({ type: "entity.parse.failed" }),
        {
            status: 400,
            message: "Geçersiz JSON verisi."
        }
    );
});

test("büyük gövdeyi 413 ve CORS hatasını 403 yapar", () => {
    assert.equal(
        classifyHttpError({ type: "entity.too.large" }).status,
        413
    );
    assert.equal(
        classifyHttpError({ message: "CORS engellendi." }).status,
        403
    );
});

test("beklenmeyen ayrıntıyı istemciye sızdırmaz", () => {
    assert.deepEqual(
        classifyHttpError({ message: "secret database detail" }),
        {
            status: 500,
            message: "Sunucu hatası oluştu."
        }
    );
});
