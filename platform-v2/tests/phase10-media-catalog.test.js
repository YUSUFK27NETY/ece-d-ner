const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createInMemoryProductImageStorageAdapter,
    createProductMediaUploadService,
    createConfiguredProductMediaUploadService
} = require("../src/media/product-media-upload-service");

function jpegBytes() {
    return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
}

function pngBytes() {
    return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function webpBytes() {
    return Buffer.from("RIFFxxxxWEBP", "ascii");
}

test("media upload exact tenant/product key üretir, type/size/signature sınırlarını uygular", async () => {
    const storage = createInMemoryProductImageStorageAdapter();
    const service = createProductMediaUploadService({ storage });

    for (const [contentType, body] of [
        ["image/jpeg", jpegBytes()],
        ["image/png", pngBytes()],
        ["image/webp", webpBytes()]
    ]) {
        const productId = contentType.split("/")[1];
        const result = await service.uploadProductImage({
            tenantId: "ela-doner",
            productId,
            body,
            contentType
        });
        assert.equal(result.tenantId, "ela-doner");
        assert.equal(result.productId, productId);
        assert.equal(result.contentType, contentType);
        assert.equal(result.bytes, body.length);
        assert.match(result.imageUrl, new RegExp(`^/media/ela-doner/products/${productId}$`));
    }

    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "bad-type",
        body: Buffer.from("GIF89a"),
        contentType: "image/gif"
    }), error => error?.code === "MEDIA_TYPE_UNSUPPORTED");

    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "bad-signature",
        body: Buffer.from("not-a-png"),
        contentType: "image/png"
    }), error => error?.code === "MEDIA_SIGNATURE_INVALID");

    const tinyLimitService = createProductMediaUploadService({ storage, maxBytes: 8 });
    await assert.rejects(() => tinyLimitService.uploadProductImage({
        tenantId: "ela-doner",
        productId: "too-large",
        body: jpegBytes(),
        contentType: "image/jpeg"
    }), error => error?.code === "MEDIA_SIZE_INVALID");
});

test("media storage exact tenant isolation korur ve overwrite aynı exact key ile sınırlıdır", async () => {
    const storage = createInMemoryProductImageStorageAdapter();
    const service = createProductMediaUploadService({ storage });

    const first = jpegBytes();
    const second = Buffer.concat([jpegBytes(), Buffer.from([0x01])]);
    await service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: first,
        contentType: "image/jpeg"
    });
    await service.uploadProductImage({
        tenantId: "baska-isletme",
        productId: "p1",
        body: pngBytes(),
        contentType: "image/png"
    });
    await service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: second,
        contentType: "image/jpeg"
    });

    const tenantOne = await service.readProductImage({ tenantId: "ela-doner", productId: "p1" });
    const tenantTwo = await service.readProductImage({ tenantId: "baska-isletme", productId: "p1" });
    assert.deepEqual(tenantOne.body, second);
    assert.equal(tenantOne.contentType, "image/jpeg");
    assert.deepEqual(tenantTwo.body, pngBytes());
    assert.equal(tenantTwo.contentType, "image/png");

    await assert.rejects(() => service.readProductImage({
        tenantId: "ucuncu-isletme",
        productId: "p1"
    }), error => error?.code === "MEDIA_NOT_FOUND");
});

test("configured media service tam config ister ve private provider hatasını sanitize eder", async () => {
    const storage = {
        async putObject() {
            const error = new Error("private-provider-marker");
            error.code = "R2_HTTP_500";
            throw error;
        },
        async getObject() {
            const error = new Error("private-provider-marker");
            error.code = "R2_HTTP_500";
            throw error;
        }
    };
    const service = createProductMediaUploadService({
        storage,
        publicBaseUrl: "https://media.example.com"
    });
    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: jpegBytes(),
        contentType: "image/jpeg"
    }), error => error?.code === "MEDIA_STORAGE_UNAVAILABLE" &&
        !error.message.includes("private-provider-marker"));
});

test("media config tamamen yoksa özellik pasif kalır; kısmi config sessiz fallback yapmaz", () => {
    assert.equal(createConfiguredProductMediaUploadService({ env: {} }), null);
    assert.throws(() => createConfiguredProductMediaUploadService({
        env: { PLATFORM_MEDIA_R2_ENDPOINT: "https://example.r2.cloudflarestorage.com" }
    }), /PLATFORM_MEDIA_R2_BUCKET/);
});

test("owner media UI ve storefront media decorator güvenli static contract taşır", () => {
    const ownerPanel = fs.readFileSync(path.join(__dirname, "../public/owner/panel.html"), "utf8");
    const mediaHtml = fs.readFileSync(path.join(__dirname, "../public/owner/media.html"), "utf8");
    const mediaJs = fs.readFileSync(path.join(__dirname, "../public/owner/media.js"), "utf8");
    const storefrontHtml = fs.readFileSync(path.join(__dirname, "../public/storefront/index.html"), "utf8");
    const storefrontMedia = fs.readFileSync(path.join(__dirname, "../public/storefront/media.js"), "utf8");

    assert.match(ownerPanel, /href="\/owner\/media\.html"/);
    assert.match(mediaJs, /input\.accept\s*=\s*"image\/jpeg,image\/png,image\/webp"/);
    assert.match(mediaJs, /media\/products\/\$\{encodeURIComponent\(product\.productId\)\}\/image/);
    assert.match(mediaJs, /getIdToken\(\)/);
    assert.doesNotMatch(mediaJs, /innerHTML\s*=/);
    assert.doesNotMatch(mediaJs, /localStorage/);
    assert.doesNotMatch(mediaJs, /setItem\([^\n]*(password|token)/i);

    assert.match(storefrontHtml, /\/m\/media\.css/);
    assert.match(storefrontHtml, /\/m\/media\.js/);
    assert.match(storefrontMedia, /createElement\("img"\)/);
    assert.doesNotMatch(storefrontMedia, /innerHTML\s*=/);
});
