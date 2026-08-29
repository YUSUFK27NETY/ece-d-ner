"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const projectRoot = path.join(__dirname, "..");

function read(fileName) {
    return fs.readFileSync(
        path.join(projectRoot, fileName),
        "utf8"
    );
}

function checkJavaScript(fileName, source) {
    new vm.Script(source, {
        filename: fileName
    });
}

function checkInlineScripts(fileName) {
    const html = read(fileName);
    const scriptPattern =
        /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

    let match;
    let inlineIndex = 0;

    while ((match = scriptPattern.exec(html)) !== null) {
        const attributes = match[1];
        const source = match[2];

        if (/\bsrc\s*=/i.test(attributes)) {
            continue;
        }

        inlineIndex++;

        if (source.trim()) {
            checkJavaScript(
                `${fileName} inline script ${inlineIndex}`,
                source
            );
        }
    }
}

function checkDuplicateIds(fileName) {
    const html = read(fileName);
    const idPattern =
        /\bid\s*=\s*(["'])(.*?)\1/gi;
    const ids = new Set();
    const duplicates = new Set();

    let match;

    while ((match = idPattern.exec(html)) !== null) {
        const id = match[2];

        if (ids.has(id)) {
            duplicates.add(id);
        }

        ids.add(id);
    }

    if (duplicates.size > 0) {
        throw new Error(
            `${fileName}: yinelenen id: ${Array.from(duplicates).join(", ")}`
        );
    }
}

function checkHtmlSafety(fileName) {
    const html = read(fileName);

    if (/\bsrc\s*=\s*(["'])\s*\1/i.test(html)) {
        throw new Error(
            `${fileName}: boş src özelliği ağ isteğine neden olabilir.`
        );
    }

    const hiddenDialogPattern =
        /<[^>]+role\s*=\s*(["'])dialog\1[^>]+aria-hidden\s*=\s*(["'])true\2[^>]*>/gi;

    let match;

    while ((match = hiddenDialogPattern.exec(html)) !== null) {
        if (!/\binert\b/i.test(match[0])) {
            throw new Error(
                `${fileName}: gizli dialog inert olmalıdır.`
            );
        }
    }
}

function checkBalancedBraces(fileName) {
    const source = read(fileName);
    let balance = 0;
    let quote = null;
    let inComment = false;

    for (let index = 0; index < source.length; index++) {
        const current = source[index];
        const next = source[index + 1];

        if (inComment) {
            if (current === "*" && next === "/") {
                inComment = false;
                index++;
            }

            continue;
        }

        if (quote) {
            if (current === "\\") {
                index++;
                continue;
            }

            if (current === quote) {
                quote = null;
            }

            continue;
        }

        if (current === "/" && next === "*") {
            inComment = true;
            index++;
            continue;
        }

        if (current === "\"" || current === "'") {
            quote = current;
            continue;
        }

        if (current === "{") {
            balance++;
        } else if (current === "}") {
            balance--;

            if (balance < 0) {
                throw new Error(
                    `${fileName}: fazladan kapanış süslü parantezi var.`
                );
            }
        }
    }

    if (balance !== 0) {
                throw new Error(
                    `${fileName}: süslü parantez dengesi bozuk (${balance}).`
                );
    }
}

[
    "script.js",
    "server.js",
    "order-pricing.js",
    "cors-policy.js",
    "order-request.js",
    "order-idempotency.js",
    "http-error.js",
    "admin-auth.js",
    "order-identifier.js",
    "scripts/set-admin-claim.js"
].forEach(fileName => {
    checkJavaScript(fileName, read(fileName));
});

[
    "index.html",
    "admin.html"
].forEach(fileName => {
    checkInlineScripts(fileName);
    checkDuplicateIds(fileName);
    checkHtmlSafety(fileName);
});

checkBalancedBraces("style.css");
checkBalancedBraces("firestore.rules");

JSON.parse(read("firebase.json"));

console.log(
    "JavaScript, HTML kimlikleri, CSS ve Firebase yapı dosyaları geçerli."
);
