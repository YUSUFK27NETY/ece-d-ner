const crypto = require("node:crypto");
const { ObjectStorageProvider } = require("./object-storage-provider");

function sha256Hex(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value, encoding) {
    return crypto.createHmac("sha256", key).update(value, "utf8").digest(encoding);
}

function awsEncode(value) {
    return encodeURIComponent(String(value)).replace(/[!'()*]/g, char =>
        `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function encodeObjectPath(key) {
    return String(key).split("/").map(awsEncode).join("/");
}

function requireObjectKey(value) {
    const key = String(value ?? "");
    if (!key || key.includes("\0") || Buffer.byteLength(key, "utf8") > 1024) {
        throw new TypeError("R2 object key geçersiz.");
    }
    return key;
}

function normalizeHeaderValue(value) {
    return String(value).trim().replace(/\s+/g, " ");
}

function buildCanonicalQuery(entries = []) {
    return entries
        .map(([key, value]) => [awsEncode(key), awsEncode(value)])
        .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
}

function amzDateParts(date = new Date()) {
    const iso = date.toISOString();
    return {
        amzDate: iso.replace(/[:-]|\.\d{3}/g, ""),
        dateStamp: iso.slice(0, 10).replace(/-/g, "")
    };
}

function signRequest({
    method,
    url,
    headers = {},
    body = Buffer.alloc(0),
    accessKeyId,
    secretAccessKey,
    region = "auto",
    now = new Date()
}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
    const payloadHash = sha256Hex(payload);
    const { amzDate, dateStamp } = amzDateParts(now);
    const normalizedHeaders = new Map();

    normalizedHeaders.set("host", url.host);
    normalizedHeaders.set("x-amz-content-sha256", payloadHash);
    normalizedHeaders.set("x-amz-date", amzDate);

    for (const [key, value] of Object.entries(headers)) {
        normalizedHeaders.set(String(key).toLowerCase(), normalizeHeaderValue(value));
    }

    const sortedHeaders = [...normalizedHeaders.entries()].sort(([a], [b]) => a.localeCompare(b));
    const canonicalHeaders = sortedHeaders.map(([key, value]) => `${key}:${value}\n`).join("");
    const signedHeaders = sortedHeaders.map(([key]) => key).join(";");
    const canonicalRequest = [
        method.toUpperCase(),
        url.pathname || "/",
        url.search ? url.search.slice(1) : "",
        canonicalHeaders,
        signedHeaders,
        payloadHash
    ].join("\n");
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
        "AWS4-HMAC-SHA256",
        amzDate,
        credentialScope,
        sha256Hex(Buffer.from(canonicalRequest, "utf8"))
    ].join("\n");
    const dateKey = hmac(Buffer.from(`AWS4${secretAccessKey}`, "utf8"), dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, "s3");
    const signingKey = hmac(serviceKey, "aws4_request");
    const signature = hmac(signingKey, stringToSign, "hex");

    const outputHeaders = {
        ...headers,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    };

    return outputHeaders;
}

function decodeXml(value) {
    return String(value)
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

function xmlTagValues(xml, tag) {
    const expression = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "g");
    return [...String(xml).matchAll(expression)].map(match => decodeXml(match[1]));
}

function xmlFirst(xml, tag) {
    return xmlTagValues(xml, tag)[0] ?? null;
}

function createStorageError(response, operation) {
    const error = new Error(`R2 ${operation} isteği başarısız (${response.status}).`);
    error.code = response.status === 404 ? "NOT_FOUND" : `R2_HTTP_${response.status}`;
    error.status = response.status;
    return error;
}

class R2ObjectStorageProvider extends ObjectStorageProvider {
    constructor({
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
        region = "auto",
        fetchImpl = globalThis.fetch,
        now = () => new Date()
    }) {
        super();

        if (typeof fetchImpl !== "function") {
            throw new TypeError("R2 provider için fetch gerekli.");
        }

        const parsed = new URL(String(endpoint));
        if (parsed.protocol !== "https:") throw new TypeError("R2 endpoint HTTPS olmalı.");

        this.endpoint = parsed.toString().replace(/\/$/, "");
        this.bucket = String(bucket ?? "").trim();
        this.accessKeyId = String(accessKeyId ?? "").trim();
        this.secretAccessKey = String(secretAccessKey ?? "").trim();
        this.region = String(region ?? "auto").trim() || "auto";
        this.fetchImpl = fetchImpl;
        this.now = now;

        if (!this.bucket || !this.accessKeyId || !this.secretAccessKey) {
            throw new TypeError("R2 provider bucket ve credential bilgileri eksik.");
        }
    }

    objectUrl(key, queryEntries = []) {
        const url = new URL(`${this.endpoint}/${awsEncode(this.bucket)}/${encodeObjectPath(requireObjectKey(key))}`);
        const query = buildCanonicalQuery(queryEntries);
        if (query) url.search = query;
        return url;
    }

    bucketUrl(queryEntries = []) {
        const url = new URL(`${this.endpoint}/${awsEncode(this.bucket)}`);
        const query = buildCanonicalQuery(queryEntries);
        if (query) url.search = query;
        return url;
    }

    async request({ method, url, body = Buffer.alloc(0), headers = {}, operation }) {
        const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
        const signedHeaders = signRequest({
            method,
            url,
            headers,
            body: payload,
            accessKeyId: this.accessKeyId,
            secretAccessKey: this.secretAccessKey,
            region: this.region,
            now: this.now()
        });
        const response = await this.fetchImpl(url, {
            method,
            headers: signedHeaders,
            body: method === "GET" || method === "HEAD" ? undefined : payload
        });

        if (!response.ok) throw createStorageError(response, operation);
        return response;
    }

    async putObject({ key, body, contentType = "application/octet-stream", metadata = {} }) {
        const payload = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
        const headers = { "content-type": String(contentType) };

        for (const [rawKey, rawValue] of Object.entries(metadata ?? {})) {
            const metaKey = String(rawKey).trim().toLowerCase();
            if (!/^[a-z0-9][a-z0-9-]*$/.test(metaKey)) {
                throw new TypeError("R2 metadata key geçersiz.");
            }
            headers[`x-amz-meta-${metaKey}`] = normalizeHeaderValue(rawValue);
        }

        const response = await this.request({
            method: "PUT",
            url: this.objectUrl(key),
            body: payload,
            headers,
            operation: "putObject"
        });

        return { etag: response.headers?.get?.("etag") ?? null };
    }

    async getObject({ key }) {
        const response = await this.request({
            method: "GET",
            url: this.objectUrl(key),
            operation: "getObject"
        });
        const body = Buffer.from(await response.arrayBuffer());

        return {
            body,
            etag: response.headers?.get?.("etag") ?? null,
            contentType: response.headers?.get?.("content-type") ?? null
        };
    }

    async deleteObject({ key }) {
        await this.request({
            method: "DELETE",
            url: this.objectUrl(key),
            operation: "deleteObject"
        });
        return { deleted: true, key: requireObjectKey(key) };
    }

    async listObjects({ prefix = "" } = {}) {
        const objects = [];
        let continuationToken = null;

        for (let page = 0; page < 100; page += 1) {
            const query = [["list-type", "2"], ["prefix", String(prefix ?? "")]];
            if (continuationToken) query.push(["continuation-token", continuationToken]);

            const response = await this.request({
                method: "GET",
                url: this.bucketUrl(query),
                operation: "listObjects"
            });
            const xml = await response.text();
            const keys = xmlTagValues(xml, "Key");
            const sizes = xmlTagValues(xml, "Size");
            const modified = xmlTagValues(xml, "LastModified");

            keys.forEach((key, index) => {
                objects.push({
                    key,
                    size: sizes[index] === undefined ? null : Number(sizes[index]),
                    lastModified: modified[index] ?? null
                });
            });

            const truncated = String(xmlFirst(xml, "IsTruncated") ?? "false").toLowerCase() === "true";
            if (!truncated) return { objects };

            continuationToken = xmlFirst(xml, "NextContinuationToken");
            if (!continuationToken) {
                const error = new Error("R2 list response continuation token eksik.");
                error.code = "R2_INVALID_LIST_RESPONSE";
                throw error;
            }
        }

        const error = new Error("R2 list pagination güvenlik sınırını aştı.");
        error.code = "R2_LIST_PAGE_LIMIT";
        throw error;
    }
}

function createR2ObjectStorageProvider(config, options = {}) {
    return new R2ObjectStorageProvider({ ...config, ...options });
}

module.exports = {
    awsEncode,
    buildCanonicalQuery,
    signRequest,
    R2ObjectStorageProvider,
    createR2ObjectStorageProvider
};
