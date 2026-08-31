const FIREBASE_WEB_KEYS = Object.freeze([
    "apiKey",
    "authDomain",
    "projectId",
    "appId",
    "storageBucket",
    "messagingSenderId"
]);

function parseJsonObject(raw, label) {
    if (!raw) {
        return null;
    }

    let parsed;

    try {
        parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
        throw new Error(`${label} geçerli JSON olmalı.`);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`${label} JSON nesnesi olmalı.`);
    }

    return parsed;
}

function normalizeFirebaseWebConfig(rawConfig) {
    const input = parseJsonObject(rawConfig, "PLATFORM_FIREBASE_WEB_CONFIG_JSON");

    if (!input) {
        return null;
    }

    const config = {};

    for (const key of FIREBASE_WEB_KEYS) {
        if (input[key] !== undefined && input[key] !== null && input[key] !== "") {
            config[key] = String(input[key]).trim();
        }
    }

    for (const required of ["apiKey", "authDomain", "projectId", "appId"]) {
        if (!config[required]) {
            throw new Error(`Firebase web config eksik alan: ${required}`);
        }
    }

    return Object.freeze(config);
}

function normalizeAllowedOrigins(value = "") {
    if (Array.isArray(value)) {
        return Object.freeze(value.map(normalizeOrigin));
    }

    const raw = String(value || "").trim();

    if (!raw) {
        return Object.freeze([]);
    }

    return Object.freeze(
        raw.split(",")
            .map(part => part.trim())
            .filter(Boolean)
            .map(normalizeOrigin)
    );
}

function normalizeOrigin(value) {
    let url;

    try {
        url = new URL(String(value));
    } catch {
        throw new Error(`Geçersiz platform origin: ${value}`);
    }

    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
        throw new Error(`Platform origin HTTPS olmalı: ${value}`);
    }

    return url.origin;
}

module.exports = {
    FIREBASE_WEB_KEYS,
    normalizeFirebaseWebConfig,
    normalizeAllowedOrigins
};
