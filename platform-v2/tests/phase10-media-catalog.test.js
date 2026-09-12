const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    createProductRecord,
    applyProductPatch,
    projectProduct
} = require("../src/catalog/product-model");
const {
    MAX_MEDIA_BYTES,
    createConfiguredProductMediaUploadService,
    createProductMediaUploadService,
    matchesSignature
} = require("../src/media/product-media-upload-service");
const { projectPublicProduct } = require("../src/public/public-storefront-service");

const NOW = new Date("2026-09-12T03:00:00.000Z");

function pngBytes(extra = 16) {
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(extra)
    ]);
}

function jpegBytes(extra = 16) {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(extra)]);
}

function webpBytes(extra = 16) {
    return Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.alloc(4),
        Buffer.from("WEBP", "ascii"),
        Buffer.alloc(extra)
    ]);
}

test("catalog product imageUrl HTTPS olarak create/patch/project edilir ve boş değerle kaldırılır", () => {
    const created = createProductRecord({
        tenantId: "ela-doner",
        productId: "doner-1",
        draft: {
            name: "Ela Dürüm",
            category: "Döner",
            price: 220,
            imageUrl: "https://media.example.com/media/ela-doner/products/doner-1"
        },
        now: NOW
    });
    assert.equal(created.imageUrl, "https://media.example.com/media/ela-doner/products/doner-1");
    assert.equal(projectProduct(created).imageUrl, created.imageUrl);

    const changed = applyProductPatch(created, {
        imageUrl: "https://cdn.example.com/products/doner-1.webp"
    }, new Date(NOW.getTime() + 1000));
    assert.equal(changed.imageUrl, "https://cdn.example.com/products/doner-1.webp");

    const removed = applyProductPatch(changed, { imageUrl: "" }, new Date(NOW.getTime() + 2000));
    assert.equal(removed.imageUrl, "");

    assert.throws(() => createProductRecord({
        tenantId: "ela-doner",
        productId: "bad-http",
        draft: { name: "Bad", category: "Test", price: 1, imageUrl: "http://example.com/a.jpg" },
        now: NOW
    }), /imageUrl/);
    assert.throws(() => applyProductPatch(created, {
        imageUrl: "https://user:pass@example.com/a.jpg"
    }, NOW), /imageUrl/);
});

test("eski product kaydı imageUrl olmadan geriye uyumlu normalize edilir", () => {
    const stored = {
        schemaVersion: 1,
        tenantId: "ela-doner",
        productId: "legacy-1",
        name: "Eski Ürün",
        category: "Döner",
        price: 180,
        description: "",
        available: true,
        archived: false,
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString()
    };
    assert.equal(projectProduct(stored).imageUrl, "");
});

test("public storefront ürün projection yalnız güvenli catalog alanları ve imageUrl taşır", () => {
    const product = createProductRecord({
        tenantId: "ela-doner",
        productId: "p1",
        draft: {
            name: "Döner",
            category: "Ana",
            price: 200,
            description: "Günlük",
            imageUrl: "https://media.example.com/p1"
        },
        now: NOW
    });
    const projected = projectPublicProduct(product);
    assert.deepEqual(Object.keys(projected).sort(), [
        "category", "description", "imageUrl", "name", "price", "productId"
    ]);
    assert.equal(projected.imageUrl, "https://media.example.com/p1");
    assert.equal(Object.hasOwn(projected, "tenantId"), false);
    assert.equal(Object.hasOwn(projected, "createdAt"), false);
});

test("media signature kontrolü JPEG/PNG/WebP kabul eder ve sahte payload reddeder", () => {
    assert.equal(matchesSignature(jpegBytes(), "image/jpeg"), true);
    assert.equal(matchesSignature(pngBytes(), "image/png"), true);
    assert.equal(matchesSignature(webpBytes(), "image/webp"), true);
    assert.equal(matchesSignature(Buffer.alloc(32), "image/jpeg"), false);
    assert.equal(matchesSignature(Buffer.from("RIFF0000NOPE"), "image/webp"), false);
});

test("media upload exact tenant/product key kullanır ve public URL döndürür", async () => {
    const calls = [];
    const service = createProductMediaUploadService({
        storageProvider: {
            async putObject(args) {
                calls.push(args);
                return { etag: "etag-1" };
            }
        },
        publicBaseUrl: "https://media.example.com"
    });

    const payload = pngBytes();
    const result = await service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: payload,
        contentType: "image/png"
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].key, "media/ela-doner/products/p1");
    assert.equal(calls[0].contentType, "image/png");
    assert.equal(calls[0].body, payload);
    assert.deepEqual(calls[0].metadata, { tenant: "ela-doner", product: "p1" });
    assert.equal(result.imageUrl, "https://media.example.com/media/ela-doner/products/p1");
    assert.equal(result.size, payload.length);
});

test("media upload type/signature/size doğrulamasında fail-closed davranır", async () => {
    const service = createProductMediaUploadService({
        storageProvider: { async putObject() { throw new Error("should not run"); } },
        publicBaseUrl: "https://media.example.com"
    });

    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: pngBytes(),
        contentType: "image/gif"
    }), error => error?.code === "MEDIA_TYPE_UNSUPPORTED");

    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: Buffer.alloc(32),
        contentType: "image/png"
    }), error => error?.code === "MEDIA_SIGNATURE_INVALID");

    const tooLarge = Buffer.alloc(MAX_MEDIA_BYTES + 1);
    tooLarge.set(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 0);
    await assert.rejects(() => service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: tooLarge,
        contentType: "image/png"
    }), error => error?.code === "MEDIA_SIZE_INVALID");
});

test("media storage hatası provider detayını sızdırmadan 503 semantics üretir", async () => {
    const service = createProductMediaUploadService({
        storageProvider: {
            async putObject() {
                const error = new Error("private-provider-marker");
                error.code = "R2_HTTP_500";
                throw error;
            }
        },
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
    const ownerIndex = fs.readFileSync(path.join(__dirname, "../public/owner/index.html"), "utf8");
    const mediaHtml = fs.readFileSync(path.join(__dirname, "../public/owner/media.html"), "utf8");
    const mediaJs = fs.readFileSync(path.join(__dirname, "../public/owner/media.js"), "utf8");
    const storefrontHtml = fs.readFileSync(path.join(__dirname, "../public/storefront/index.html"), "utf8");
    const storefrontMedia = fs.readFileSync(path.join(__dirname, "../public/storefront/media.js"), "utf8");

    assert.match(ownerIndex, /href="\/owner\/media\.html"/);
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
