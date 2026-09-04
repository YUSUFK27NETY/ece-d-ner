const { requireTenantId } = require("../tenant/tenant-id");
const { tenantSettingsDocument } = require("../firestore/tenant-paths");
const { tenantBackupPrefix } = require("./backup-key");
const { assertBackupManifest } = require("./backup-manifest");
const { normalizeListedObjects } = require("./retention-service");
const { getObjectBody } = require("./tenant-backup-service");

const DRILL_MARKER_ID = "phase5-backup-restore-drill";
const MANIFEST_SUFFIX = ".enc.manifest.json";
const MAX_MANIFEST_BYTES = 64 * 1024;

function normalizeDate(value) {
    let date;

    if (value instanceof Date) {
        date = value;
    } else if (value && typeof value.toDate === "function") {
        date = value.toDate();
    } else {
        date = new Date(value);
    }

    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
}

function emptyBackupEvidence() {
    return Object.freeze({
        sizeBytes: 0,
        objectCount: 0,
        verifiedAt: null,
        restoreDrillAt: null,
        restoreDrillStatus: "unknown"
    });
}

function readDrillMarker(snapshot, expectedTenantId) {
    if (!snapshot || snapshot.exists !== true || typeof snapshot.data !== "function") {
        return null;
    }

    const tenantId = requireTenantId(expectedTenantId);
    const data = snapshot.data();

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return null;
    }
    let markerTenantId;
    try {
        markerTenantId = requireTenantId(data.tenantId);
    } catch {
        return null;
    }

    if (markerTenantId !== tenantId) {
        const error = new Error("Backup drill marker tenant sınırı uyuşmuyor.");
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }

    const drillRunId = String(data.drillRunId ?? "");
    if (!/^[a-f0-9-]{16,64}$/i.test(drillRunId) ||
        data.state !== "backup-source" ||
        data.markerValue !== `backup-source:${drillRunId}`) {
        return null;
    }

    const sourceAt = normalizeDate(data.updatedAt);
    const restoredAt = normalizeDate(snapshot.updateTime);

    if (!sourceAt || !restoredAt) {
        return null;
    }

    return Object.freeze({ sourceAt, restoredAt });
}

function assertEvidenceDependencies({ storageProvider, db }) {
    if (!storageProvider || typeof storageProvider.listObjects !== "function" ||
        typeof storageProvider.getObject !== "function") {
        throw new TypeError("Backup operations evidence storage provider gerekli.");
    }
    if (!db || typeof db.doc !== "function") {
        throw new TypeError("Backup operations evidence Firestore db gerekli.");
    }
}

function createBackupOperationsEvidenceProvider({ storageProvider, db }) {
    assertEvidenceDependencies({ storageProvider, db });

    return Object.freeze({
        async getStatus({ tenantId: rawTenantId }) {
            const tenantId = requireTenantId(rawTenantId);
            const prefix = tenantBackupPrefix(tenantId);
            const markerPath = tenantSettingsDocument(tenantId, DRILL_MARKER_ID);
            const [listedResult, markerSnapshot] = await Promise.all([
                storageProvider.listObjects({ prefix }),
                db.doc(markerPath).get()
            ]);
            const listed = normalizeListedObjects(listedResult);
            const manifestObjects = listed.filter(item =>
                item.key.startsWith(prefix) && item.key.endsWith(MANIFEST_SUFFIX)
            );
            const manifestsByObject = new Map();

            for (const object of manifestObjects) {
                try {
                    const manifestBody = getObjectBody(
                        await storageProvider.getObject({ key: object.key })
                    );
                    if (manifestBody.length > MAX_MANIFEST_BYTES) {
                        continue;
                    }
                    const manifest = JSON.parse(manifestBody.toString("utf8"));
                    assertBackupManifest(manifest, tenantId);

                    if (manifest.manifestKey !== object.key ||
                        !Number.isSafeInteger(manifest.sizeBytes)) {
                        continue;
                    }

                    manifestsByObject.set(manifest.objectKey, manifest);
                } catch {
                    // Invalid or cross-tenant manifests are never included in visibility.
                }
            }

            const manifests = [...manifestsByObject.values()];
            if (manifests.length === 0) {
                return emptyBackupEvidence();
            }

            let sizeBytes = 0;
            let latestVerified = null;
            for (const manifest of manifests) {
                sizeBytes += manifest.sizeBytes;
                const verifiedAt = normalizeDate(manifest.verifiedAt);
                if (verifiedAt && (!latestVerified || verifiedAt > latestVerified)) {
                    latestVerified = verifiedAt;
                }
            }

            let restoreDrillAt = null;
            let restoreDrillStatus = "unknown";
            const marker = readDrillMarker(markerSnapshot, tenantId);

            if (marker) {
                const correlatedManifest = manifests.some(manifest => {
                    const createdAt = normalizeDate(manifest.createdAt);
                    const verifiedAt = normalizeDate(manifest.verifiedAt);

                    return createdAt && verifiedAt &&
                        createdAt >= marker.sourceAt &&
                        verifiedAt <= marker.restoredAt;
                });

                if (correlatedManifest) {
                    restoreDrillAt = marker.restoredAt.toISOString();
                    restoreDrillStatus = "passed";
                }
            }

            return Object.freeze({
                sizeBytes,
                objectCount: manifests.length,
                verifiedAt: latestVerified ? latestVerified.toISOString() : null,
                restoreDrillAt,
                restoreDrillStatus
            });
        }
    });
}

module.exports = {
    DRILL_MARKER_ID,
    MANIFEST_SUFFIX,
    MAX_MANIFEST_BYTES,
    normalizeDate,
    emptyBackupEvidence,
    readDrillMarker,
    createBackupOperationsEvidenceProvider
};
