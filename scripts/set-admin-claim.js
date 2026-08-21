"use strict";

const path = require("node:path");
const admin = require("firebase-admin");

const serviceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    "/etc/secrets/firebase-service-account.json";

const adminEmail =
    String(process.env.ADMIN_EMAIL || "").trim();

const adminUid =
    String(process.env.ADMIN_UID || "").trim();

async function main() {
    if (!adminEmail && !adminUid) {
        throw new Error(
            "ADMIN_EMAIL veya ADMIN_UID ortam değişkeni gerekli."
        );
    }

    const resolvedServiceAccountPath =
        path.resolve(serviceAccountPath);

    const serviceAccount =
        require(resolvedServiceAccountPath);

    if (!admin.apps.length) {
        admin.initializeApp({
            credential:
                admin.credential.cert(serviceAccount)
        });
    }

    const auth = admin.auth();

    const user = adminUid
        ? await auth.getUser(adminUid)
        : await auth.getUserByEmail(adminEmail);

    await auth.setCustomUserClaims(
        user.uid,
        {
            ...(user.customClaims || {}),
            admin: true
        }
    );

    console.log(
        `Admin yetkisi verildi: ${user.email || "e-posta yok"} (${user.uid})`
    );
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(
            "Admin yetkisi verilemedi:",
            error.message
        );
        process.exit(1);
    });
