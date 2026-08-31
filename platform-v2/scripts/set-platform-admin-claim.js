"use strict";

const { createPlatformFirebase } = require("../src/firebase/create-platform-firebase");

const adminEmail = String(process.env.PLATFORM_ADMIN_EMAIL || "").trim();
const adminUid = String(process.env.PLATFORM_ADMIN_UID || "").trim();

async function main() {
    if (!adminEmail && !adminUid) {
        throw new Error("PLATFORM_ADMIN_EMAIL veya PLATFORM_ADMIN_UID gerekli.");
    }

    const { auth } = createPlatformFirebase();
    const user = adminUid
        ? await auth.getUser(adminUid)
        : await auth.getUserByEmail(adminEmail);

    await auth.setCustomUserClaims(user.uid, {
        ...(user.customClaims || {}),
        platformAdmin: true
    });

    await auth.revokeRefreshTokens(user.uid);

    console.log(
        `Platform Admin yetkisi verildi: ${user.email || "e-posta yok"} (${user.uid})`
    );
    console.log("Kullanıcı yeniden giriş yapmalıdır.");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error("Platform Admin yetkisi verilemedi:", error.message);
        process.exit(1);
    });
