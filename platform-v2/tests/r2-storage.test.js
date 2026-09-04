const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadR2BackupConfig,
    normalizeR2Endpoint
} = require("../src/config/r2-backup-config");
const {
    signRequest,
    createR2ObjectStorageProvider
} = require("../src/storage/r2-object-storage-provider");

test("R2 config eksik credential ile fail-closed olur", () => {
    assert.throws(() => loadR2BackupConfig({
        PLATFORM_BACKUP_R2_ENDPOINT: "https://example.r2.cloudflarestorage.com",
        PLATFORM_BACKUP_R2_BUCKET: "platform-v2-backups-staging"
    }), error => error.code === "R2_CONFIG_MISSING");
});

test("R2 endpoint yalnız HTTPS kabul eder", () => {
    assert.throws(() => normalizeR2Endpoint("http://example.test"), /HTTPS/);
    assert.equal(
        normalizeR2Endpoint("https://example.r2.cloudflarestorage.com/"),
        "https://example.r2.cloudflarestorage.com"
    );
});

test("R2 SigV4 imzası gerekli güvenli headerları üretir", () => {
    const url = new URL("https://example.r2.cloudflarestorage.com/test-bucket/a%20b.enc");
    const headers = signRequest({
        method: "PUT",
        url,
        headers: { "content-type": "application/octet-stream" },
        body: Buffer.from("backup"),
        accessKeyId: "ACCESS123",
        secretAccessKey: "secret-value",
        region: "auto",
        now: new Date("2026-09-03T12:00:00.000Z")
    });

    assert.equal(headers["x-amz-date"], "20260903T120000Z");
    assert.match(headers["x-amz-content-sha256"], /^[a-f0-9]{64}$/);
    assert.match(headers.Authorization, /^AWS4-HMAC-SHA256 Credential=ACCESS123\/20260903\/auto\/s3\/aws4_request,/);
    assert.ok(headers.Authorization.includes("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date"));
    assert.ok(!headers.Authorization.includes("secret-value"));
});

test("R2 provider put/get/delete işlemlerini bucket ile sınırlar", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
        calls.push({ url: String(url), options });
        if (options.method === "GET") {
            return new Response(Buffer.from("payload"), {
                status: 200,
                headers: { etag: '"etag-1"', "content-type": "application/octet-stream" }
            });
        }
        return new Response(null, { status: 200, headers: { etag: '"etag-1"' } });
    };
    const provider = createR2ObjectStorageProvider({
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "platform-v2-backups-staging",
        accessKeyId: "ACCESS123",
        secretAccessKey: "secret-value",
        region: "auto"
    }, {
        fetchImpl,
        now: () => new Date("2026-09-03T12:00:00.000Z")
    });

    await provider.putObject({
        key: "tenants/demo/backup.enc",
        body: Buffer.from("payload"),
        metadata: { tenantId: "demo" }
    });
    const fetched = await provider.getObject({ key: "tenants/demo/backup.enc" });
    await provider.deleteObject({ key: "tenants/demo/backup.enc" });

    assert.equal(fetched.body.toString("utf8"), "payload");
    assert.equal(calls.length, 3);
    for (const call of calls) {
        assert.match(call.url, /^https:\/\/account\.r2\.cloudflarestorage\.com\/platform-v2-backups-staging\/tenants\/demo\/backup\.enc$/);
        assert.ok(call.options.headers.Authorization.startsWith("AWS4-HMAC-SHA256 "));
        assert.ok(!JSON.stringify(call.options.headers).includes("secret-value"));
    }
    assert.equal(calls[0].options.headers["x-amz-meta-tenantid"], "demo");
});

test("R2 listObjects pagination sonuçlarını birleştirir", async () => {
    let count = 0;
    const fetchImpl = async (url, options) => {
        assert.equal(options.method, "GET");
        count += 1;
        if (count === 1) {
            assert.ok(String(url).includes("list-type=2"));
            assert.ok(String(url).includes("prefix=tenants%2Fdemo%2F"));
            return new Response(`<?xml version="1.0"?><ListBucketResult><Contents><Key>tenants/demo/a.enc</Key><LastModified>2026-09-03T12:00:00Z</LastModified><Size>10</Size></Contents><IsTruncated>true</IsTruncated><NextContinuationToken>next+token</NextContinuationToken></ListBucketResult>`, { status: 200 });
        }
        assert.ok(String(url).includes("continuation-token=next%2Btoken"));
        return new Response(`<?xml version="1.0"?><ListBucketResult><Contents><Key>tenants/demo/b.enc</Key><LastModified>2026-09-03T12:01:00Z</LastModified><Size>20</Size></Contents><IsTruncated>false</IsTruncated></ListBucketResult>`, { status: 200 });
    };
    const provider = createR2ObjectStorageProvider({
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "platform-v2-backups-staging",
        accessKeyId: "ACCESS123",
        secretAccessKey: "secret-value",
        region: "auto"
    }, { fetchImpl });

    const result = await provider.listObjects({ prefix: "tenants/demo/" });
    assert.deepEqual(result.objects.map(item => item.key), ["tenants/demo/a.enc", "tenants/demo/b.enc"]);
    assert.deepEqual(result.objects.map(item => item.size), [10, 20]);
});

test("R2 HTTP hata mesajı response body veya secret sızdırmaz", async () => {
    const provider = createR2ObjectStorageProvider({
        endpoint: "https://account.r2.cloudflarestorage.com",
        bucket: "platform-v2-backups-staging",
        accessKeyId: "ACCESS123",
        secretAccessKey: "SUPER-SECRET",
        region: "auto"
    }, {
        fetchImpl: async () => new Response("provider internal sensitive detail", { status: 403 })
    });

    await assert.rejects(
        provider.getObject({ key: "tenants/demo/a.enc" }),
        error => error.code === "R2_HTTP_403" &&
            !error.message.includes("SUPER-SECRET") &&
            !error.message.includes("sensitive detail")
    );
});
