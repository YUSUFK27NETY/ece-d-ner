"use strict";

const PRODUCTION_FRONTEND_ORIGIN =
    "https://yusufk27nety.github.io";

function normalizeHttpOrigin(value) {
    try {
        const url = new URL(String(value).trim());

        if (url.protocol !== "https:" && url.protocol !== "http:") {
            return null;
        }

        return url.origin;
    } catch {
        return null;
    }
}

function getAllowedOrigins(configuredOrigins = "") {
    const origins = new Set([
        PRODUCTION_FRONTEND_ORIGIN
    ]);

    String(configuredOrigins)
        .split(",")
        .map(normalizeHttpOrigin)
        .filter(Boolean)
        .forEach(origin => origins.add(origin));

    return origins;
}

function createOriginValidator(configuredOrigins = "") {
    const allowedOrigins =
        getAllowedOrigins(configuredOrigins);

    return function validateOrigin(origin, callback) {
        // Sunucudan sunucuya istekler ve sağlık kontrolleri Origin göndermez.
        if (!origin) {
            return callback(null, true);
        }

        if (allowedOrigins.has(origin)) {
            return callback(null, true);
        }

        return callback(
            new Error("CORS engellendi.")
        );
    };
}

module.exports = {
    PRODUCTION_FRONTEND_ORIGIN,
    getAllowedOrigins,
    createOriginValidator
};
