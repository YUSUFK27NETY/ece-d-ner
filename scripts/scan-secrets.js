"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
    execFileSync
} = require("node:child_process");
const {
    DEFAULT_PUBLIC_VALUES,
    scanText
} = require("../secret-scanner");

const ROOT = path.resolve(__dirname, "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function git(args, options = {}) {
    return execFileSync(
        "git",
        args,
        {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
            ...options
        }
    );
}

function getTrackedFiles() {
    return git([
        "ls-files",
        "-z"
    ])
        .split("\0")
        .filter(Boolean);
}

function scanTrackedFiles() {
    const findings = [];

    for (const relativePath of getTrackedFiles()) {
        const absolutePath = path.join(ROOT, relativePath);
        const stats = fs.statSync(absolutePath);

        if (stats.size > MAX_FILE_BYTES) {
            continue;
        }

        const buffer = fs.readFileSync(absolutePath);

        if (buffer.includes(0)) {
            continue;
        }

        findings.push(
            ...scanText(
                buffer.toString("utf8"),
                relativePath,
                DEFAULT_PUBLIC_VALUES
            )
        );
    }

    return findings;
}

function scanHistory() {
    const history = git([
        "log",
        "--all",
        "-p",
        "--no-ext-diff",
        "--unified=0",
        "--format=commit %H"
    ]);

    return scanText(
        history,
        "git-geçmişi",
        DEFAULT_PUBLIC_VALUES
    );
}

function main() {
    const includeHistory =
        process.argv.includes("--history");

    const findings = [
        ...scanTrackedFiles(),
        ...(includeHistory ? scanHistory() : [])
    ];

    if (findings.length > 0) {
        console.error(
            "Gizli bilgi taraması başarısız oldu:"
        );

        findings.forEach(finding => {
            console.error(
                `- ${finding.source}:${finding.line} ` +
                `${finding.detector} (${finding.preview})`
            );
        });

        process.exitCode = 1;
        return;
    }

    console.log(
        `Gizli bilgi taraması başarılı${
            includeHistory
                ? " (takip edilen dosyalar + git geçmişi)"
                : ""
        }.`
    );
}

main();
