const test = require("node:test");
const assert = require("node:assert/strict");

const { loadPlatformScalabilityConfig } = require("../src/config/platform-scalability-config");
const { createInMemoryTenantMigrationStore } = require("../src/migrations/in-memory-tenant-migration-store");
const { createTenantPlacementMigrationService } = require("../src/migrations/tenant-placement-migration");
const { createTenantJobQueue } = require("../src/queue/tenant-job-queue");

const admin = { role: "platform_admin", actorId: "phase7-admin" };

function placement(tenantId, placementType, placementId) {
    return {
        tenantId, placementType, placementId, region: "eu-west", status: "active",
        version: 1, releaseChannel: "stable", cohort: "default",
        updatedAt: "2026-09-04T10:00:00.000Z"
    };
}

function migrationFixture({ rollback = true, backup = true, ready = true } = {}) {
    const calls = [];
    const events = [];
    const adapter = {
        async copy(record) { calls.push(["copy", record.tenantId]); },
        async verify(record) { calls.push(["verify", record.tenantId]); return true; },
        async cutover(record) { calls.push(["cutover", record.tenantId]); }
    };
    if (rollback) adapter.rollback = async record => calls.push(["rollback", record.tenantId]);
    const service = createTenantPlacementMigrationService({
        store: createInMemoryTenantMigrationStore(),
        adapter,
        backupGate: async () => backup,
        readinessGate: async () => ready,
        auditWriter: { async write(event) { events.push(event); } }
    });
    return { service, calls, events };
}

async function planned(fixture, tenantId = "tenant-a") {
    return fixture.service.plan({
        context: admin,
        migrationId: `migration-${tenantId}`,
        tenantId,
        sourcePlacement: placement(tenantId, "shared", "shared-primary"),
        destinationPlacement: placement(tenantId, "dedicated", `dedicated-${tenantId}`)
    });
}

test("placement migration dry-run, preflight, apply onayı ve idempotent rerun uygular", async () => {
    const fixture = migrationFixture();
    const first = await planned(fixture);
    assert.equal((await planned(fixture)).createdAt, first.createdAt);
    await fixture.service.dryRun({ context: admin, migrationId: first.migrationId, tenantId: "tenant-a" });
    await fixture.service.preflight({ context: admin, migrationId: first.migrationId, tenantId: "tenant-a" });
    await assert.rejects(fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "copy", apply: true
    }), error => error.code === "MIGRATION_CONFIRMATION_FAILED");
    await fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "copy",
        apply: true, confirmationTenantId: "tenant-a"
    });
    await fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "copy",
        apply: true, confirmationTenantId: "tenant-a"
    });
    assert.deepEqual(fixture.calls, [["copy", "tenant-a"]]);
    await fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "verify",
        apply: true, confirmationTenantId: "tenant-a"
    });
    await fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "cutover",
        apply: true, confirmationTenantId: "tenant-a"
    });
    const completed = await fixture.service.advance({
        context: admin, migrationId: first.migrationId, tenantId: "tenant-a", stage: "complete",
        apply: true, confirmationTenantId: "tenant-a"
    });
    assert.equal(completed.state, "complete");
    assert.deepEqual(fixture.calls, [
        ["copy", "tenant-a"], ["verify", "tenant-a"], ["cutover", "tenant-a"]
    ]);
    assert.ok(fixture.events.some(event => event.action === "tenant.migration.copied"));
});

test("migration backup/readiness gate, cross-tenant binding, rollback ve forward-fix durumlarını güvenli tutar", async () => {
    const backupFail = migrationFixture({ backup: false });
    const record = await planned(backupFail);
    await backupFail.service.dryRun({ context: admin, migrationId: record.migrationId, tenantId: "tenant-a" });
    await assert.rejects(backupFail.service.preflight({ context: admin, migrationId: record.migrationId, tenantId: "tenant-a" }), error => error.code === "MIGRATION_BACKUP_GATE_FAILED");
    await assert.rejects(backupFail.service.getTenantStatus({
        context: { role: "tenant_admin", tenantId: "tenant-b" }, tenantId: "tenant-a"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");

    const readinessFail = migrationFixture({ ready: false });
    const readinessRecord = await planned(readinessFail);
    await readinessFail.service.dryRun({ context: admin, migrationId: readinessRecord.migrationId, tenantId: "tenant-a" });
    await assert.rejects(
        readinessFail.service.preflight({ context: admin, migrationId: readinessRecord.migrationId, tenantId: "tenant-a" }),
        error => error.code === "MIGRATION_READINESS_GATE_FAILED"
    );
    await assert.rejects(readinessFail.service.plan({
        context: admin,
        migrationId: "migration-invalid-binding",
        tenantId: "tenant-a",
        destinationTenantId: "tenant-b",
        sourcePlacement: placement("tenant-a", "shared", "shared-primary"),
        destinationPlacement: placement("tenant-a", "dedicated", "dedicated-a")
    }), error => error.code === "TENANT_BOUNDARY_VIOLATION");

    const rollback = migrationFixture();
    const rollbackRecord = await planned(rollback);
    assert.equal((await rollback.service.rollback({
        context: admin, migrationId: rollbackRecord.migrationId, tenantId: "tenant-a",
        apply: true, confirmationTenantId: "tenant-a"
    })).state, "rolled_back");

    const forwardFix = migrationFixture({ rollback: false });
    const forwardRecord = await planned(forwardFix);
    const result = await forwardFix.service.rollback({
        context: admin, migrationId: forwardRecord.migrationId, tenantId: "tenant-a",
        apply: true, confirmationTenantId: "tenant-a"
    });
    assert.equal(result.state, "forward_fix_required");
    assert.equal(result.forwardFixCode, "manual-forward-fix");
});

function queueConfig() {
    return loadPlatformScalabilityConfig(JSON.stringify({
        queue: {
            perTenantConcurrency: 1,
            maxQueuedPerTenant: 3,
            burstWindowMs: 100,
            burstMax: 3,
            sustainedWindowMs: 1000,
            sustainedMax: 4,
            maxAttempts: 2,
            baseBackoffMs: 10,
            maxBackoffMs: 20
        }
    }));
}

function job(tenantId, suffix) {
    return {
        jobId: `job-${tenantId}-${suffix}`,
        tenantId,
        operationClass: "write",
        payloadRef: `tenants/${tenantId}/jobs/${suffix}`,
        idempotencyKey: `idem-${tenantId}-${suffix}`,
        metadata: { resourceType: "order", resourceId: suffix, version: 1 }
    };
}

test("tenant queue noisy-neighbor izolasyonu, fair claim, concurrency ve idempotency sağlar", async () => {
    const queue = createTenantJobQueue({ config: queueConfig() });
    await queue.enqueue(job("tenant-a", "0001"));
    const duplicate = await queue.enqueue(job("tenant-a", "0001"));
    await queue.enqueue(job("tenant-a", "0002"));
    await queue.enqueue(job("tenant-b", "0001"));
    assert.equal(duplicate.duplicate, true);
    assert.equal((await queue.claimNext()).tenantId, "tenant-a");
    assert.equal((await queue.claimNext()).tenantId, "tenant-b");
    assert.equal(await queue.claimNext(), null);
    await assert.rejects(queue.get({
        context: { role: "tenant_admin", tenantId: "tenant-b" },
        tenantId: "tenant-a", jobId: "job-tenant-a-0001"
    }), error => error.code === "TENANT_SCOPE_MISMATCH");
});

test("tenant queue bounded retry/backoff, DLQ, admission ve güvenli metadata uygular", async () => {
    let nowMs = Date.parse("2026-09-04T10:00:00.000Z");
    const queue = createTenantJobQueue({ config: queueConfig(), now: () => new Date(nowMs) });
    await queue.enqueue(job("tenant-a", "0001"));
    let claimed = await queue.claimNext();
    let failed = await queue.fail({ tenantId: "tenant-a", jobId: claimed.jobId, errorCode: "PROVIDER_DOWN" });
    assert.equal(failed.status, "queued");
    assert.equal(failed.scheduledAt, "2026-09-04T10:00:00.010Z");
    nowMs += 10;
    claimed = await queue.claimNext();
    failed = await queue.fail({ tenantId: "tenant-a", jobId: claimed.jobId, errorCode: "PROVIDER_DOWN" });
    assert.equal(failed.status, "dead_letter");
    assert.equal((await queue.getSummary({ context: admin, tenantId: "tenant-a" })).deadLetter, 1);

    await assert.rejects(queue.enqueue({ ...job("tenant-b", "0001"), payloadRef: "tenants/tenant-a/private/body" }), error => error.code === "TENANT_BOUNDARY_VIOLATION");
    await assert.rejects(queue.enqueue({ ...job("tenant-b", "0002"), metadata: { credential: "secret" } }), /bilinmeyen alan/);

    const limited = createTenantJobQueue({ config: queueConfig(), now: () => new Date(nowMs) });
    await limited.enqueue(job("tenant-c", "0001"));
    await limited.enqueue(job("tenant-c", "0002"));
    await limited.enqueue(job("tenant-c", "0003"));
    await assert.rejects(limited.enqueue(job("tenant-c", "0004")), error => error.code === "TENANT_QUEUE_LIMITED");
    assert.equal((await limited.enqueue(job("tenant-d", "0001"))).duplicate, false);
});
