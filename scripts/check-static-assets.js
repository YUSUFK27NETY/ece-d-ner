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

function checkCssBraces(fileName) {
    const css = read(fileName);
    let balance = 0;
    let quote = null;
    let inComment = false;

    for (let index = 0; index < css.length; index++) {
        const current = css[index];
        const next = css[index + 1];

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
            `${fileName}: CSS süslü parantez dengesi bozuk (${balance}).`
        );
    }
}

[
    "script.js",
    "server.js",
    "order-pricing.js",
    "cors-policy.js",
    "order-request.js"
].forEach(fileName => {
    checkJavaScript(fileName, read(fileName));
});

[
    "index.html",
    "admin.html"
].forEach(fileName => {
    checkInlineScripts(fileName);
    checkDuplicateIds(fileName);
});

checkCssBraces("style.css");

console.log(
    "JavaScript, HTML kimlikleri ve CSS yapısı geçerli."
);
