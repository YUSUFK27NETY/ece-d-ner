const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("private media proxy never exposes arbitrary object keys or backup prefix", () => {
    const runtime = fs.readFileSync(
        path.join(__dirname, "../src/http/attach-tenant-owner-runtime.js"),
        "utf8"
    );
    const mediaService = fs.readFileSync(
        path.join(__dirname, "../src/media/product-media-upload-service.js"),
        "utf8"
    );

    assert.match(runtime, /PUBLIC_MEDIA_PATH\s*=\s*"\/media\/:tenantId\/products\/:productId"/);
    assert.match(runtime, /readProductImage\(\{/);
    assert.match(runtime, /X-Content-Type-Options/);
    assert.match(runtime, /Cross-Origin-Resource-Policy/);
    assert.doesNotMatch(runtime, /req\.(?:query|params)\.(?:key|objectKey|prefix)/);

    assert.match(mediaService, /`media\/\$\{tenantId\}\/products\/\$\{productId\}`/);
    assert.doesNotMatch(mediaService, /`backups\/\$\{tenantId\}/);
});
