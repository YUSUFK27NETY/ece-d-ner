const fs = require("node:fs");
const path = require("node:path");
const {
    initializeApp,
    cert,
    getApps,
    getApp
} = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");

const PLATFORM_FIREBASE_APP_NAME = "platform-v2";

function readServiceAccount(serviceAccountPath) {
    const resolvedPath = path.resolve(String(serviceAccountPath || ""));

    if (!serviceAccountPath || !fs.existsSync(resolvedPath)) {
        throw new Error("Platform Firebase service account dosyası bulunamadı.");
    }

    return JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
}

function createPlatformFirebase({
    serviceAccount = null,
    serviceAccountPath = process.env.PLATFORM_FIREBASE_SERVICE_ACCOUNT_PATH,
    appName = PLATFORM_FIREBASE_APP_NAME
} = {}) {
    const existing = getApps().find(app => app.name === appName);
    const app = existing || initializeApp({
        credential: cert(serviceAccount || readServiceAccount(serviceAccountPath))
    }, appName);

    return Object.freeze({
        app,
        auth: getAuth(app),
        db: getFirestore(app)
    });
}

function getPlatformFirebaseApp(appName = PLATFORM_FIREBASE_APP_NAME) {
    return getApp(appName);
}

module.exports = {
    PLATFORM_FIREBASE_APP_NAME,
    readServiceAccount,
    createPlatformFirebase,
    getPlatformFirebaseApp
};
