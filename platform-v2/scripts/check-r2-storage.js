const crypto = require("node:crypto");
const { loadR2BackupConfig } = require("../src/config/r2-backup-config");
const { createR2ObjectStorageProvider } = require("../src/storage/r2-object-storage-provider");

async function main() {
    const config = loadR2BackupConfig();
    const storage = createR2ObjectStorageProvider(config);
    const nonce = crypto.randomBytes(16).toString("hex");
    const prefix = `_platform-v2-probes/${nonce}/`;
    const key = `${prefix}probe.txt`;
    const body = Buffer.from(`platform-v2-r2-smoke:${nonce}`, "utf8");
    let written = false;

    try {
        await storage.putObject({
            key,
            body,
            contentType: "text/plain",
            metadata: { purpose: "staging-smoke" }
        });
        written = true;

        const fetched = await storage.getObject({ key });
        if (!Buffer.isBuffer(fetched.body) || !crypto.timingSafeEqual(fetched.body, body)) {
            throw new Error("R2 smoke read-back içeriği uyuşmuyor.");
        }

        const listed = await storage.listObjects({ prefix });
        if (!listed.objects.some(object => object.key === key)) {
            throw new Error("R2 smoke list sonucu yazılan objeyi içermiyor.");
        }

        await storage.deleteObject({ key });
        written = false;

        try {
            await storage.getObject({ key });
            throw new Error("R2 smoke silinen obje hâlâ okunabiliyor.");
        } catch (error) {
            if (error.code !== "NOT_FOUND") throw error;
        }

        console.log(`R2_SMOKE_OK bucket=${config.bucket}`);
    } finally {
        if (written) {
            await storage.deleteObject({ key }).catch(() => {});
        }
    }
}

main().catch(error => {
    console.error(`R2_SMOKE_FAILED code=${String(error?.code ?? "UNKNOWN").slice(0, 80)}`);
    process.exitCode = 1;
});
