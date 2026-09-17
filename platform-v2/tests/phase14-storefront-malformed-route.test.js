const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const guardSource = fs.readFileSync(
    path.join(__dirname, "../public/storefront/route-guard.js"),
    "utf8"
);
const storefrontHtml = fs.readFileSync(
    path.join(__dirname, "../public/storefront/index.html"),
    "utf8"
);

function runGuard(pathname, search = "", hash = "") {
    const replacements = [];
    const context = {
        window: {
            location: { pathname, search, hash },
            history: {
                replaceState(_state, _title, url) {
                    replacements.push(url);
                }
            }
        },
        decodeURIComponent
    };
    vm.runInNewContext(guardSource, context);
    return replacements;
}

test("malformed storefront tenant path is converted into a safe invalid route", () => {
    assert.deepEqual(
        runGuard("/m/%E0%A4%A", "?src=qr", "#top"),
        ["/m/x?src=qr#top"]
    );
});

test("valid storefront tenant path is left untouched", () => {
    assert.deepEqual(runGuard("/m/ela-doner"), []);
});

test("route guard loads before storefront path readers", () => {
    const guardIndex = storefrontHtml.indexOf('/m/route-guard.js');
    const timeoutIndex = storefrontHtml.indexOf('/m/request-timeout.js');
    const storefrontIndex = storefrontHtml.indexOf('/m/storefront.js');

    assert.ok(guardIndex >= 0, "route guard script must be included");
    assert.ok(guardIndex < timeoutIndex, "route guard must run before request timeout bridge");
    assert.ok(guardIndex < storefrontIndex, "route guard must run before storefront runtime");
});
