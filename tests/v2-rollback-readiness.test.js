const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("rollback drill V2 production runtime için exact SHA ve non-production artifact doğrular", () => {
    const workflow = fs.readFileSync(
        path.join(__dirname, "../.github/workflows/rollback-drill.yml"),
        "utf8"
    );

    assert.match(workflow, /schedule:\s*\n\s*- cron: "23 3 \* \* 0"/);
    assert.match(workflow, /git rev-parse --verify "HEAD\^1"/);
    assert.match(workflow, /git checkout --detach/);
    assert.match(workflow, /test -f platform-v2\/server\.js/);
    assert.match(workflow, /npm run ci/);
    assert.match(workflow, /npm run security:dependencies/);
    assert.match(workflow, /node --check platform-v2\/server\.js/);
    assert.match(workflow, /cp -R platform-v2 rollback-v2\//);
    assert.match(workflow, /platform-v2-rollback\.tar\.gz/);
    assert.match(workflow, /production_mutation=false/);

    assert.doesNotMatch(workflow, /backup\/pre-security-v1/);
    assert.doesNotMatch(workflow, /rollback-site/);
    assert.doesNotMatch(workflow, /render deploy|deploy_hook|curl .*render/i);

    for (const mutable of [
        /actions\/checkout@v\d+/,
        /actions\/setup-node@v\d+/,
        /actions\/upload-artifact@v\d+/
    ]) {
        assert.doesNotMatch(workflow, mutable);
    }
});
