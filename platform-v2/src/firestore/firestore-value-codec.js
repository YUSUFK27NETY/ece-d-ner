const { Timestamp, GeoPoint } = require("@google-cloud/firestore");
const { assertTenantPathBelongsTo } = require("../tenant/tenant-boundary");

const TYPE_KEY = "__platformV2Type";

function encodeFirestoreValue(value, { tenantId = null } = {}) {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        if (!Number.isFinite(value)) {
            throw new TypeError("Firestore backup içinde sonlu olmayan sayı desteklenmiyor.");
        }
        return value;
    }

    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new TypeError("Geçersiz Date backup'a yazılamaz.");
        }
        return { [TYPE_KEY]: "date", value: value.toISOString() };
    }

    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return {
            [TYPE_KEY]: "bytes",
            value: Buffer.from(value).toString("base64")
        };
    }

    if (isTimestamp(value)) {
        return {
            [TYPE_KEY]: "timestamp",
            seconds: Number(value.seconds),
            nanoseconds: Number(value.nanoseconds)
        };
    }

    if (isGeoPoint(value)) {
        return {
            [TYPE_KEY]: "geopoint",
            latitude: Number(value.latitude),
            longitude: Number(value.longitude)
        };
    }

    if (isDocumentReference(value)) {
        const path = String(value.path);
        if (tenantId && path.startsWith("tenants/")) {
            assertTenantPathBelongsTo(tenantId, path);
        }
        return {
            [TYPE_KEY]: "document-reference",
            path
        };
    }

    if (Array.isArray(value)) {
        return value.map(item => encodeFirestoreValue(item, { tenantId }));
    }

    if (value && typeof value === "object") {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(`Desteklenmeyen Firestore backup nesnesi: ${value.constructor?.name || "unknown"}`);
        }
        const output = {};

        for (const [key, item] of Object.entries(value)) {
            if (key === TYPE_KEY) {
                throw new TypeError(`Firestore document alan adı ${TYPE_KEY} backup codec için ayrılmıştır.`);
            }

            if (item === undefined) {
                continue;
            }

            output[key] = encodeFirestoreValue(item, { tenantId });
        }

        return output;
    }

    throw new TypeError(`Desteklenmeyen Firestore backup değeri: ${typeof value}`);
}

function decodeFirestoreValue(value, { db, tenantId = null } = {}) {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map(item => decodeFirestoreValue(item, { db, tenantId }));
    }

    if (!value || typeof value !== "object") {
        throw new TypeError("Geçersiz Firestore backup değeri.");
    }

    if (Object.prototype.hasOwnProperty.call(value, TYPE_KEY)) {
        return decodeTaggedValue(value, { db, tenantId });
    }

    const output = {};

    for (const [key, item] of Object.entries(value)) {
        output[key] = decodeFirestoreValue(item, { db, tenantId });
    }

    return output;
}

function decodeTaggedValue(value, { db, tenantId }) {
    switch (value[TYPE_KEY]) {
        case "date": {
            const date = new Date(value.value);
            if (Number.isNaN(date.getTime())) throw new TypeError("Backup Date değeri geçersiz.");
            return date;
        }
        case "bytes": {
            const raw = String(value.value ?? "");
            if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw)) throw new TypeError("Backup bytes değeri geçersiz.");
            return Buffer.from(raw, "base64");
        }
        case "timestamp": {
            const seconds = Number(value.seconds);
            const nanoseconds = Number(value.nanoseconds);
            if (!Number.isInteger(seconds) || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds > 999_999_999) {
                throw new TypeError("Backup Timestamp değeri geçersiz.");
            }
            return new Timestamp(seconds, nanoseconds);
        }
        case "geopoint": {
            const latitude = Number(value.latitude);
            const longitude = Number(value.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new TypeError("Backup GeoPoint değeri geçersiz.");
            return new GeoPoint(latitude, longitude);
        }
        case "document-reference": {
            const path = String(value.path ?? "").trim();
            if (!db || typeof db.doc !== "function" || !path || path.startsWith("/") || path.endsWith("/") || path.includes("//")) {
                throw new TypeError("Backup DocumentReference değeri için geçerli db/path gerekli.");
            }
            if (tenantId && path.startsWith("tenants/")) {
                assertTenantPathBelongsTo(tenantId, path);
            }
            return db.doc(path);
        }
        default:
            throw new TypeError("Bilinmeyen Firestore backup type etiketi.");
    }
}

function isTimestamp(value) {
    return value && value.constructor?.name === "Timestamp" &&
        Number.isInteger(Number(value.seconds)) && Number.isInteger(Number(value.nanoseconds));
}

function isGeoPoint(value) {
    return value && value.constructor?.name === "GeoPoint" &&
        Number.isFinite(Number(value.latitude)) && Number.isFinite(Number(value.longitude));
}

function isDocumentReference(value) {
    return value && value.constructor?.name === "DocumentReference" && typeof value.path === "string";
}

module.exports = {
    TYPE_KEY,
    encodeFirestoreValue,
    decodeFirestoreValue
};
