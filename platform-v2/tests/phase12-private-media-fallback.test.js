const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createConfiguredProductMediaUploadService,
    createProductMediaUploadService,
    mediaObjectKey
} = require("../src/media/product-media-upload-service");
const {
    PUBLIC_MEDIA_PATH,
    attachTenantOwnerRuntime
} = require("../src/http/attach-tenant-owner-runtime");

function pngBytes(extra = 16) {
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(extra)
    ]);
}

function backupEnv(overrides = {}) {
    return {
        PLATFORM_BACKUP_R2_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
        PLATFORM_BACKUP_R2_BUCKET: "ece-platform-backups",
        PLATFORM_BACKUP_R2_ACCESS_KEY_ID: "test-access-key",
        PLATFORM_BACKUP_R2_SECRET_ACCESS_KEY: "test-secret-key",
        PLATFORM_BACKUP_R2_REGION: "auto",
        RENDER_EXTERNAL_URL: "https://business-platform-v2-production.onrender.com",
        ...overrides
    };
}

test("private backup R2 config enables media when dedicated media config is absent", () => {
    const service = createConfiguredProductMediaUploadService({ env: backupEnv() });

    assert.ok(service);
    assert.equal(typeof service.uploadProductImage, "function");
    assert.equal(typeof service.readProductImage, "function");
    assert.equal(mediaObjectKey("ela-doner", "p1"), "media/ela-doner/products/p1");
});

test("dedicated media config remains fail-closed and does not silently fall back", () => {
    assert.throws(() => createConfiguredProductMediaUploadService({
        env: backupEnv({ PLATFORM_MEDIA_R2_ENDPOINT: "https://media.r2.cloudflarestorage.com" })
    }), /PLATFORM_MEDIA_R2_BUCKET/);
});

test("private media service writes and reads only the canonical media object key", async () => {
    const objects = new Map();
    const storageProvider = {
        async putObject({ key, body, contentType, metadata }) {
            objects.set(key, { body: Buffer.from(body), contentType, metadata });
            return { etag: '"test"' };
        },
        async getObject({ key }) {
            const object = objects.get(key);
            if (!object) {
                const error = new Error("not found");
                error.code = "NOT_FOUND";
                throw error;
            }
            return {
                body: Buffer.from(object.body),
                contentType: object.contentType,
                etag: '"test"'
            };
        }
    };
    const service = createProductMediaUploadService({
        storageProvider,
        publicBaseUrl: "https://platform.example.com"
    });
    const payload = pngBytes();

    const uploaded = await service.uploadProductImage({
        tenantId: "ela-doner",
        productId: "p1",
        body: payload,
        contentType: "image/png"
    });
    assert.equal(
        uploaded.imageUrl,
        "https://platform.example.com/media/ela-doner/products/p1"
    );
    assert.deepEqual(objects.get("media/ela-doner/products/p1").metadata, {
        tenant: "ela-doner",
        product: "p1"
    });

    const read = await service.readProductImage({
        tenantId: "ela-doner",
        productId: "p1"
    });
    assert.equal(read.contentType, "image/png");
    assert.deepEqual(read.body, payload);
});

test("private media read maps missing and provider failures to safe media errors", async () => {
    const missingService = createProductMediaUploadService({
        storageProvider: {
            async putObject() {},
            async getObject() {
                const error = new Error("provider-private-detail");
                error.code = "NOT_FOUND";
                throw error;
            }
        },
        publicBaseUrl: "https://platform.example.com"
    });
    await assert.rejects(
        () => missingService.readProductImage({ tenantId: "ela-doner", productId: "p1" }),
        error => error?.code === "MEDIA_NOT_FOUND" && !error.message.includes("provider-private-detail")
    );

    const failedService = createProductMediaUploadService({
        storageProvider: {
            async putObject() {},
            async getObject() {
                throw new Error("provider-private-detail");
            }
        },
        publicBaseUrl: "https://platform.example.com"
    });
    await assert.rejects(
        () => failedService.readProductImage({ tenantId: "ela-doner", productId: "p1" }),
        error => error?.code === "MEDIA_STORAGE_UNAVAILABLE" &&
            !error.message.includes("provider-private-detail")
    );
});

test("owner runtime exposes a fixed public media route and requires read capability", () => {
    assert.equal(PUBLIC_MEDIA_PATH, "/media/:tenantId/products/:productId");

    const app = {
        use() {},
        get() {},
        post() {},
        patch() {}
    };
    const tenantRegistry = { async getById() { return null; } };
    const catalogService = {
        async list() { return []; },
        async create() {},
        async update() {},
        async archive() {}
    };
    const orderService = {
        async listAdmin() { return []; },
        async getAdmin() {},
        async updateStatus() {}
    };

    assert.throws(() => attachTenantOwnerRuntime({
        app,
        tenantRegistry,
        catalogService,
        orderService,
        mediaUploadService: { async uploadProductImage() {} }
    }), /media upload service/);
});
