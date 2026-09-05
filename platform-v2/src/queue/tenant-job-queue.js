const crypto = require("node:crypto");
const { authorizeTenantAction } = require("../auth/authorize-tenant-action");
const { requireTenantId } = require("../tenant/tenant-id");

const JOB_STATUSES = new Set(["queued", "running", "completed", "dead_letter"]);
const JOB_OPERATION_CLASSES = new Set(["read", "write", "backup", "restore", "system"]);

function safeId(value, label, min = 3, max = 128) {
    const id = String(value ?? "").trim();
    if (id.length < min || id.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) {
        throw new TypeError(`${label} geçersiz.`);
    }
    return id;
}

function normalizeJobMetadata(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("Job metadata nesne olmalı.");
    }
    const allowed = new Set(["resourceType", "resourceId", "version", "priority", "correlationId"]);
    const output = {};
    for (const [key, item] of Object.entries(value)) {
        if (!allowed.has(key)) throw new TypeError("Job metadata bilinmeyen alan içeriyor.");
        if (key === "version" || key === "priority") {
            const number = Number(item);
            if (!Number.isInteger(number) || number < 0 || number > 1_000_000) {
                throw new TypeError(`Job metadata ${key} geçersiz.`);
            }
            output[key] = number;
        } else {
            output[key] = safeId(item, `Job metadata ${key}`, 1, 128);
        }
    }
    return Object.freeze(output);
}

function createTenantJob(input, now = new Date()) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Tenant job nesnesi gerekli.");
    }
    const allowed = new Set([
        "jobId", "tenantId", "operationClass", "payloadRef", "metadata",
        "idempotencyKey", "scheduledAt"
    ]);
    for (const key of Object.keys(input)) {
        if (!allowed.has(key)) throw new TypeError("Tenant job bilinmeyen alan içeriyor.");
    }
    const tenantId = requireTenantId(input.tenantId);
    const jobId = safeId(input.jobId || crypto.randomUUID(), "Job id", 8, 128);
    const operationClass = String(input.operationClass ?? "").trim().toLowerCase();
    if (!JOB_OPERATION_CLASSES.has(operationClass)) throw new TypeError("Job operationClass geçersiz.");
    const payloadRef = String(input.payloadRef ?? "").trim();
    if (!payloadRef.startsWith(`tenants/${tenantId}/`) || payloadRef.length > 512 || payloadRef.includes("..")) {
        const error = new Error("Job payloadRef tenant sınırı dışında.");
        error.code = "TENANT_BOUNDARY_VIOLATION";
        throw error;
    }
    const createdAt = now instanceof Date ? now : new Date(now);
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : createdAt;
    if (Number.isNaN(createdAt.getTime()) || Number.isNaN(scheduledAt.getTime())) {
        throw new TypeError("Job tarihi geçersiz.");
    }
    return Object.freeze({
        jobId,
        tenantId,
        operationClass,
        payloadRef,
        metadata: normalizeJobMetadata(input.metadata),
        idempotencyKey: safeId(input.idempotencyKey, "Job idempotencyKey", 8, 128),
        attempts: 0,
        status: "queued",
        createdAt: createdAt.toISOString(),
        scheduledAt: scheduledAt.toISOString(),
        lastErrorCode: null
    });
}

function clone(value) { return value ? JSON.parse(JSON.stringify(value)) : null; }

function createTenantJobQueue({ config, now = () => new Date() }) {
    if (!config?.queue) throw new TypeError("Tenant queue config gerekli.");
    const policy = config.queue;
    const jobs = new Map();
    const idempotency = new Map();
    const tenantOrder = [];
    const enqueueTimes = new Map();
    let cursor = -1;

    function currentDate() {
        const value = now();
        if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("Tenant queue clock geçersiz.");
        return value;
    }

    function jobsForTenant(tenantId) {
        return [...jobs.values()].filter(job => job.tenantId === tenantId);
    }

    function enforceAdmission(tenantId, at) {
        const queued = jobsForTenant(tenantId).filter(job => job.status === "queued").length;
        if (queued >= policy.maxQueuedPerTenant) {
            const error = new Error("Tenant queue backlog limiti aşıldı.");
            error.code = "TENANT_QUEUE_LIMITED";
            throw error;
        }
        const times = (enqueueTimes.get(tenantId) || [])
            .filter(value => value > at - policy.sustainedWindowMs);
        const burst = times.filter(value => value > at - policy.burstWindowMs).length;
        if (times.length >= policy.sustainedMax || burst >= policy.burstMax) {
            const error = new Error("Tenant queue enqueue limiti aşıldı.");
            error.code = "TENANT_QUEUE_LIMITED";
            throw error;
        }
        times.push(at);
        enqueueTimes.set(tenantId, times);
    }

    async function enqueue(input) {
        const at = currentDate();
        const candidate = createTenantJob(input, at);
        const dedupeKey = `${candidate.tenantId}:${candidate.idempotencyKey}`;
        const existingId = idempotency.get(dedupeKey);
        if (existingId) return Object.freeze({ job: clone(jobs.get(existingId)), duplicate: true });
        enforceAdmission(candidate.tenantId, at.getTime());
        jobs.set(candidate.jobId, clone(candidate));
        idempotency.set(dedupeKey, candidate.jobId);
        if (!tenantOrder.includes(candidate.tenantId)) tenantOrder.push(candidate.tenantId);
        return Object.freeze({ job: clone(candidate), duplicate: false });
    }

    async function claimNext() {
        const at = currentDate();
        if (tenantOrder.length === 0) return null;
        for (let offset = 1; offset <= tenantOrder.length; offset += 1) {
            const index = (cursor + offset) % tenantOrder.length;
            const tenantId = tenantOrder[index];
            const tenantJobs = jobsForTenant(tenantId);
            const running = tenantJobs.filter(job => job.status === "running").length;
            if (running >= policy.perTenantConcurrency) continue;
            const job = tenantJobs.find(item =>
                item.status === "queued" && new Date(item.scheduledAt) <= at
            );
            if (!job) continue;
            job.status = "running";
            job.attempts += 1;
            jobs.set(job.jobId, job);
            cursor = index;
            return clone(job);
        }
        return null;
    }

    function requireBoundJob(tenantId, jobId) {
        const safeTenantId = requireTenantId(tenantId);
        const job = jobs.get(safeId(jobId, "Job id", 8, 128));
        if (!job) {
            const error = new Error("Job bulunamadı.");
            error.code = "JOB_NOT_FOUND";
            throw error;
        }
        if (job.tenantId !== safeTenantId) {
            const error = new Error("Job tenant scope uyuşmuyor.");
            error.code = "TENANT_SCOPE_MISMATCH";
            throw error;
        }
        return job;
    }

    async function complete({ tenantId, jobId }) {
        const job = requireBoundJob(tenantId, jobId);
        if (job.status === "completed") return clone(job);
        if (job.status !== "running") throw new Error("Yalnız running job tamamlanabilir.");
        job.status = "completed";
        jobs.set(job.jobId, job);
        return clone(job);
    }

    async function fail({ tenantId, jobId, errorCode = "JOB_FAILED" }) {
        const job = requireBoundJob(tenantId, jobId);
        if (job.status !== "running") throw new Error("Yalnız running job fail olabilir.");
        job.lastErrorCode = safeId(errorCode, "Job errorCode", 3, 80);
        if (job.attempts >= policy.maxAttempts) {
            job.status = "dead_letter";
        } else {
            const delay = Math.min(
                policy.maxBackoffMs,
                policy.baseBackoffMs * (2 ** Math.max(0, job.attempts - 1))
            );
            job.status = "queued";
            job.scheduledAt = new Date(currentDate().getTime() + delay).toISOString();
        }
        jobs.set(job.jobId, job);
        return clone(job);
    }

    async function get({ context, tenantId, jobId }) {
        const safeTenantId = requireTenantId(tenantId);
        authorizeTenantAction({ context, tenantId: safeTenantId, permission: "tenant.queue.read" });
        return clone(requireBoundJob(safeTenantId, jobId));
    }

    async function getSummary({ context, tenantId }) {
        const safeTenantId = requireTenantId(tenantId);
        authorizeTenantAction({ context, tenantId: safeTenantId, permission: "tenant.queue.read" });
        const tenantJobs = jobsForTenant(safeTenantId);
        const counts = Object.fromEntries([...JOB_STATUSES].map(status => [
            status, tenantJobs.filter(job => job.status === status).length
        ]));
        return Object.freeze({
            backlog: counts.queued,
            running: counts.running,
            completed: counts.completed,
            deadLetter: counts.dead_letter,
            perTenantConcurrency: policy.perTenantConcurrency,
            workerHealth: counts.dead_letter > 0
                ? "degraded"
                : (counts.running >= policy.perTenantConcurrency ? "saturated" : "healthy")
        });
    }

    return Object.freeze({ enqueue, claimNext, complete, fail, get, getSummary });
}

module.exports = {
    JOB_STATUSES,
    JOB_OPERATION_CLASSES,
    normalizeJobMetadata,
    createTenantJob,
    createTenantJobQueue
};
