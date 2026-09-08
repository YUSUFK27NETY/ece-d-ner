const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const {
    REPOSITORY_SUPPLY_CHAIN_BASELINE,
    SECURITY_POSTURE_ALERT_LIMIT,
    SECURITY_POSTURE_OVERALL_STATUSES,
    SECURITY_POSTURE_SOURCE_STATES,
    assertSecurityPosture,
    createSecurityPostureService
} = require("../src/security/security-posture-service");
const { createPlatformApp } = require("../src/http/create-platform-app");

const NOW_MS = Date.parse("2026-09-07T12:00:00.000Z");
const ADMIN_CONTEXT = Object.freeze({
    role: "platform_admin",
    actorId: "platform-admin-1"
});

function alertFixture(overrides = {}) {
    return {
        tenantId: null,
        severity: "warning",
        lastSeenAt: "2026-09-07T11:00:00.000Z",
        ...overrides
    };
}

function createService(overrides = {}) {
    return createSecurityPostureService({
        clock: () => NOW_MS,
        ...overrides
    });
}

function tenantRegistryFixture() {
    return {
        async getById() { return null; },
        async list() { return []; },
        async create(input) { return input; },
        async update(tenantId, input) { return { ...input, tenantId }; }
    };
}

async function startTestServer({ securityPostureService }) {
    const auth = {
        async verifyIdToken(value) {
            if (value === "platform-auth") {
                return { uid: "platform-admin-1", platformAdmin: true };
            }
            if (value === "tenant-auth") {
                return { uid: "tenant-user-1", platformAdmin: false };
            }
            throw new Error("auth source unavailable");
        }
    };
    const app = createPlatformApp({
        auth,
        tenantRegistry: tenantRegistryFixture(),
        securityPostureService
    });
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address();
    return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function closeServer(server) {
    server.close();
    await once(server, "close");
}

async function captureConsoleErrors(action) {
    const original = console.error;
    const messages = [];
    console.error = (...args) => { messages.push(args.join(" ")); };
    try {
        return { result: await action(), messages };
    } finally {
        console.error = original;
    }
}

test("source audit durable runtime ile contract-only ve external kaynakları ayırır", () => {
    const workspace = path.resolve(__dirname, "../..");
    const serverSource = fs.readFileSync(path.join(workspace, "platform-v2/server.js"), "utf8");

    assert.match(serverSource, /createFirestoreSecurityAlertSink/);
    assert.match(serverSource, /securityAlertReader[\s\S]*createSecurityPostureService/);
    for (const fakeRuntime of [
        "createInMemorySecretLifecycleRegistry",
        "createInMemoryIncidentStore",
        "createInMemoryBreakGlassStore",
        "createBreakGlassIntegrationService",
        "createPlatformAdminStepUpPolicy"
    ]) {
        assert.equal(serverSource.includes(fakeRuntime), false, fakeRuntime);
    }
    assert.equal(fs.existsSync(path.join(workspace, ".github/workflows/sbom.yml")), true);
    assert.equal(fs.existsSync(path.join(workspace, ".github/workflows/codeql.yml")), true);
    assert.deepEqual(REPOSITORY_SUPPLY_CHAIN_BASELINE, {
        sbomBaseline: "configured",
        codeqlBaseline: "configured"
    });
});

test("read model explicit schema, canonical time ve frozen safe sections üretir", async () => {
    const posture = await createService().getPlatformPosture({ context: ADMIN_CONTEXT });

    assert.equal(posture.schemaVersion, 1);
    assert.equal(posture.generatedAt, "2026-09-07T12:00:00.000Z");
    assert.equal(new Date(posture.generatedAt).toISOString(), posture.generatedAt);
    assert.equal(assertSecurityPosture(posture), posture);
    assert.equal(Object.isFrozen(posture), true);
    for (const section of ["identity", "secrets", "alerts", "incidents", "breakGlass", "supplyChain"]) {
        assert.equal(Object.isFrozen(posture[section]), true, section);
    }
    assert.deepEqual(SECURITY_POSTURE_SOURCE_STATES, [
        "active", "contract_only", "not_wired",
        "external_verification_required", "unavailable"
    ]);
    assert.deepEqual(SECURITY_POSTURE_OVERALL_STATUSES, [
        "partial_visibility", "degraded"
    ]);
});

test("identity step-up readiness'i runtime enforcement ve enrollment sanmaz", async () => {
    const posture = await createService({
        stepUpConfig: {
            elevatedSessionTtlMs: 120_000,
            requiredFactorTypes: ["totp", "passkey"]
        }
    }).getPlatformPosture({ context: ADMIN_CONTEXT });

    assert.deepEqual(posture.identity, {
        sourceState: "contract_only",
        contractStatus: "ready",
        runtimeEnforcement: "not_wired",
        elevatedSessionStatus: "unavailable",
        mfaReadiness: "contract_ready",
        enrollmentStatus: "unavailable",
        elevatedSessionTtlMs: 120_000,
        requiredFactorTypeCount: 2
    });
    assert.equal(JSON.stringify(posture.identity).includes("enforced"), false);
});

test("bağlı olmayan lifecycle, incident ve break-glass kaynakları fake zero üretmez", async () => {
    const posture = await createService().getPlatformPosture({ context: ADMIN_CONTEXT });

    assert.equal(posture.overallStatus, "degraded");
    assert.deepEqual(posture.secrets, {
        sourceState: "contract_only",
        health: "unavailable",
        count: null,
        healthy: null,
        due: null,
        overdue: null,
        disabled: null,
        unknown: null
    });
    assert.deepEqual(posture.incidents, {
        sourceState: "contract_only",
        openCount: null,
        criticalCount: null,
        lastUpdatedAt: null
    });
    assert.deepEqual(posture.breakGlass, {
        sourceState: "contract_only",
        activeSessions: null,
        recentUsageCount: null,
        lastUsedAt: null
    });
});

test("durable alert reader yalnız platform scope ve limitli recent summary için kullanılır", async () => {
    const calls = [];
    const service = createService({
        securityAlertReader: {
            async list(input) {
                calls.push(structuredClone(input));
                return [
                    alertFixture({ severity: "high", lastSeenAt: "2026-09-07T10:00:00.000Z" }),
                    alertFixture({ severity: "critical", lastSeenAt: "2026-09-07T11:30:00.000Z" }),
                    alertFixture({ severity: "warning", lastSeenAt: "2026-09-07T11:00:00.000Z" })
                ];
            }
        }
    });
    const posture = await service.getPlatformPosture({ context: ADMIN_CONTEXT });

    assert.deepEqual(calls, [{
        context: ADMIN_CONTEXT,
        tenantId: null,
        limit: SECURITY_POSTURE_ALERT_LIMIT
    }]);
    assert.deepEqual(posture.alerts, {
        sourceState: "active",
        recentVisibleCount: 3,
        highestSeverity: "critical",
        lastSeenAt: "2026-09-07T11:30:00.000Z"
    });
    assert.equal(posture.overallStatus, "partial_visibility");
    assert.equal("totalAlerts" in posture.alerts, false);
});

test("tenant alert platform posture içine aggregate edilmez", async () => {
    const { result: posture, messages } = await captureConsoleErrors(() =>
        createService({
            securityAlertReader: {
                async list() {
                    return [alertFixture({ tenantId: "tenant-a" })];
                }
            }
        }).getPlatformPosture({ context: ADMIN_CONTEXT })
    );

    assert.deepEqual(posture.alerts, {
        sourceState: "unavailable",
        recentVisibleCount: null,
        highestSeverity: null,
        lastSeenAt: null
    });
    assert.equal(posture.overallStatus, "degraded");
    assert.deepEqual(messages, ["Security posture alert kaynağı kullanılamadı."]);
});

test("arbitrary source alanları ve hassas payload posture'a sızmaz", async () => {
    const alert = alertFixture({
        extraField: "opaque-provider-marker",
        rawBody: { nested: "forbidden-marker" },
        email: "not-returned@example.invalid",
        phone: "+000000000"
    });
    Object.defineProperty(alert, "rawToken", {
        enumerable: true,
        get() { throw new Error("sensitive accessor invoked"); }
    });
    const posture = await createService({
        securityAlertReader: { async list() { return [alert]; } }
    }).getPlatformPosture({ context: ADMIN_CONTEXT });
    const serialized = JSON.stringify(posture);

    assert.equal(posture.alerts.sourceState, "active");
    for (const marker of [
        "opaque-provider-marker", "forbidden-marker", "not-returned@example.invalid",
        "+000000000", "extraField", "rawBody", "rawToken"
    ]) {
        assert.equal(serialized.includes(marker), false, marker);
    }
});

test("malformed veya çöken alert source güvenli unavailable sonucuna düşer", async () => {
    for (const reader of [
        { async list() { return [alertFixture({ severity: "urgent" })]; } },
        { async list() { throw new Error("raw-provider-error-marker"); } }
    ]) {
        const { result: posture, messages } = await captureConsoleErrors(() =>
            createService({ securityAlertReader: reader })
                .getPlatformPosture({ context: ADMIN_CONTEXT })
        );
        const serialized = JSON.stringify(posture);

        assert.equal(posture.alerts.sourceState, "unavailable");
        assert.equal(posture.alerts.recentVisibleCount, null);
        assert.equal(posture.overallStatus, "degraded");
        assert.equal(serialized.includes("raw-provider-error-marker"), false);
        assert.deepEqual(messages, ["Security posture alert kaynağı kullanılamadı."]);
    }
});

test("supply-chain repository baseline canlı workflow sonucu gibi gösterilmez", async () => {
    const posture = await createService().getPlatformPosture({ context: ADMIN_CONTEXT });

    assert.deepEqual(posture.supplyChain, {
        sourceState: "external_verification_required",
        sbomBaseline: "configured",
        codeqlBaseline: "configured",
        liveWorkflowStatus: "external_verification_required"
    });
    assert.equal(JSON.stringify(posture.supplyChain).includes("green"), false);
});

test("posture service fail-closed context, config, clock ve issued model kontratı uygular", async () => {
    const service = createService();

    await assert.rejects(
        service.getPlatformPosture({ context: { role: "tenant_admin", actorId: "actor-1" } }),
        TypeError
    );
    await assert.rejects(
        service.getPlatformPosture({ context: { ...ADMIN_CONTEXT, authorization: "not-accepted" } }),
        TypeError
    );
    await assert.rejects(
        createSecurityPostureService({ clock: () => 0 })
            .getPlatformPosture({ context: ADMIN_CONTEXT }),
        /clock/
    );
    assert.throws(
        () => createSecurityPostureService({
            stepUpConfig: { elevatedSessionTtlMs: 0, requiredFactorTypes: ["totp"] }
        }),
        TypeError
    );
    assert.throws(() => assertSecurityPosture(Object.freeze({})), TypeError);
});

test("security posture API platformAdmin auth arkasında read-only çalışır", async () => {
    const service = createService({
        securityAlertReader: { async list() { return []; } }
    });
    const fixture = await startTestServer({ securityPostureService: service });
    try {
        const missing = await fetch(`${fixture.baseUrl}/api/platform/security-posture`);
        const nonAdmin = await fetch(`${fixture.baseUrl}/api/platform/security-posture`, {
            headers: { Authorization: "Bearer tenant-auth" }
        });
        const admin = await fetch(`${fixture.baseUrl}/api/platform/security-posture`, {
            headers: { Authorization: "Bearer platform-auth" }
        });
        const mutation = await fetch(`${fixture.baseUrl}/api/platform/security-posture`, {
            method: "POST",
            headers: { Authorization: "Bearer platform-auth" }
        });
        const body = await admin.json();

        assert.equal(missing.status, 401);
        assert.equal(nonAdmin.status, 403);
        assert.equal(admin.status, 200);
        assert.equal(body.success, true);
        assert.deepEqual(Object.keys(body.posture), [
            "schemaVersion", "generatedAt", "overallStatus", "identity",
            "secrets", "alerts", "incidents", "breakGlass", "supplyChain"
        ]);
        assert.equal(body.posture.alerts.recentVisibleCount, 0);
        assert.equal(body.posture.overallStatus, "partial_visibility");
        assert.equal(mutation.status, 404);
    } finally {
        await closeServer(fixture.server);
    }
});

test("API total service failure ve forged response için yalnız generic safe 500 döndürür", async () => {
    for (const securityPostureService of [
        { async getPlatformPosture() { throw new Error("raw-source-error-marker"); } },
        { async getPlatformPosture() { return { arbitrary: "raw-source-error-marker" }; } }
    ]) {
        const fixture = await startTestServer({ securityPostureService });
        try {
            const { result: response, messages } = await captureConsoleErrors(() =>
                fetch(`${fixture.baseUrl}/api/platform/security-posture`, {
                    headers: { Authorization: "Bearer platform-auth" }
                })
            );
            const body = await response.json();

            assert.equal(response.status, 500);
            assert.deepEqual(body, {
                success: false,
                message: "Güvenlik durumu alınamadı."
            });
            assert.deepEqual(messages, ["Platform security posture okunamadı."]);
            assert.equal(JSON.stringify(body).includes("raw-source-error-marker"), false);
        } finally {
            await closeServer(fixture.server);
        }
    }
});
