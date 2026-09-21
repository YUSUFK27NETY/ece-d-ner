"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    runBackupRetentionPlan
} = require("../platform-v2/scripts/run-backup-retention-plan");

test("retention plan yalnız güvenli sayaçlar döndürür ve backup anahtarlarını loglamaz", async () => {
    const logs = [];
    const summary = await runBackupRetentionPlan({
        env: {
            PLATFORM_BACKUP_RETENTION_TENANT_ID: "ela-doner",
            PLATFORM_BACKUP_RETENTION_DAYS: "30"
        },
        now: new Date("2026-09-21T10:00:00.000Z"),
        retentionService: {
            async planTenantRetention(input) {
                assert.equal(input.tenantId, "ela-doner");
                assert.equal(input.retentionDays, 30);
                return {
                    tenantId: "ela-doner",
                    retentionDays: 30,
                    expired: [{ objectKey: "SECRET-OLD-OBJECT" }],
                    retained: [{ objectKey: "SECRET-NEW-OBJECT" }],
                    invalid: [{ manifestKey: "SECRET-BROKEN-MANIFEST" }]
                };
            }
        },
        logger: {
            log(message) {
                logs.push(message);
            }
        }
    });

    assert.deepEqual(summary, {
        tenantId: "ela-doner",
        retentionDays: 30,
        expiredCount: 1,
        retainedCount: 1,
        invalidCount: 1
    });
    assert.equal(logs.length, 1);
    assert.match(logs[0], /BACKUP_RETENTION_PLAN_OK/);
    assert.match(logs[0], /expired=1/);
    assert.match(logs[0], /retained=1/);
    assert.match(logs[0], /invalid=1/);
    assert.doesNotMatch(logs[0], /SECRET-/);
});

test("retention plan tenant ve gün değerini fail-closed doğrular", async () => {
    const service = {
        async planTenantRetention() {
            throw new Error("çağrılmamalı");
        }
    };

    await assert.rejects(
        runBackupRetentionPlan({
            env: { PLATFORM_BACKUP_RETENTION_TENANT_ID: "ELA DONER" },
            retentionService: service
        }),
        TypeError
    );

    await assert.rejects(
        runBackupRetentionPlan({
            env: {
                PLATFORM_BACKUP_RETENTION_TENANT_ID: "ela-doner",
                PLATFORM_BACKUP_RETENTION_DAYS: "0"
            },
            retentionService: service
        }),
        TypeError
    );
});

test("retention planner silme/apply yüzeyine dokunmaz", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../platform-v2/scripts/run-backup-retention-plan.js"),
        "utf8"
    );
    assert.match(source, /planTenantRetention/);
    assert.doesNotMatch(source, /applyTenantRetention/);
    assert.doesNotMatch(source, /deleteObject/);
    assert.doesNotMatch(source, /confirmationTenantId/);
});
