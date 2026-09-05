"use strict";

const DEFAULT_PUBLIC_VALUES = [
    "AIzaSyCfPqMm1Azo6ZS9ee4NNd1y-bFzPv9JaCU"
];

const DETECTORS = [
    {
        name: "özel anahtar",
        // Require a complete private-key block rather than a header-only
        // sentinel. This avoids false positives from security-validation
        // code while still detecting actual committed key material.
        pattern:
            /-----BEGIN ((?:RSA |EC |OPENSSH )?)PRIVATE KEY-----[\s\S]{40,}?-----END \1PRIVATE KEY-----/g
    },
    {
        name: "GitHub erişim anahtarı",
        pattern:
            /gh[pousr]_[A-Za-z0-9]{20,}/g
    },
    {
        name: "Google OAuth giriş kodu",
        pattern:
            /4\/[0-9]A[0-9A-Za-z_-]{20,}/g
    },
    {
        name: "Google API anahtarı",
        pattern:
            /AIza[0-9A-Za-z_-]{35}/g
    },
    {
        name: "AWS erişim anahtarı",
        pattern:
            /(?:AKIA|ASIA)[A-Z0-9]{16}/g
    },
    {
        name: "Slack erişim anahtarı",
        pattern:
            /xox[baprs]-[0-9A-Za-z-]{20,}/g
    },
    {
        name: "Stripe gizli anahtarı",
        pattern:
            /sk_(?:live|test)_[0-9A-Za-z]{16,}/g
    },
    {
        name: "Firebase servis hesabı özel anahtarı",
        pattern:
            /"private_key"\s*:\s*"[^"\r\n]{20,}"/g
    },
    {
        name: "kod içine yazılmış gizli değer",
        pattern:
            /(?:password|passwd|client_secret|api_secret|access_token|refresh_token)\s*[:=]\s*["'][^"'\r\n]{12,}["']/gi
    }
];

function lineNumberAt(text, index) {
    return text.slice(0, index).split("\n").length;
}

function redact(value) {
    if (value.length <= 10) {
        return "[gizlendi]";
    }

    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function scanText(
    text,
    source = "bilinmeyen",
    allowedValues = DEFAULT_PUBLIC_VALUES
) {
    const allowlist = new Set(allowedValues);
    const findings = [];

    for (const detector of DETECTORS) {
        detector.pattern.lastIndex = 0;

        for (const match of text.matchAll(detector.pattern)) {
            const value = match[0];

            if (
                Array.from(allowlist).some(
                    allowed => value.includes(allowed)
                )
            ) {
                continue;
            }

            findings.push({
                detector: detector.name,
                source,
                line: lineNumberAt(text, match.index),
                preview: redact(value)
            });
        }
    }

    return findings;
}

module.exports = {
    DEFAULT_PUBLIC_VALUES,
    scanText
};
