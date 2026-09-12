const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    normalizePublicQuoteInput,
    assertStatusTransition
} = require("../src/quotes/quote-model");
const {
    createQuoteService
} = require("../src/quotes/quote-service");
const {
    TENANT_COLLECTIONS,
    tenantDocument
} = require("../src/firestore/tenant-paths");

const TENANT_ID = "acme-metal";
const NOW = new Date("2026-09-12T15:00:00.000Z");

function tenant(overrides = {}) {
    return {
        tenantId: TENANT_ID,
        displayName: "ACME Metal",
        status: "active",
        plan: "starter",
        features: {
            catalog: true,
            orders: false,
            appointments: false,
            reservations: false,
            whatsapp: true,
            inventory: false,
            quotes: true,
            fleet: false,
            gallery: true
        },
        ...overrides
    };
}

function input(overrides = {}) {
    return {
        companyName: "Atlas Makine AŞ",
        country: "Türkiye",
        contactName: "Ayşe Yılmaz",
        email: "satinalma@example.com",
        phone: "+90 555 111 22 33",
        items: [
            { description: "Paslanmaz sac", quantity: 250, unit: "kg" },
            { description: "Lazer kesim", quantity: 10, unit: "adet" }
        ],
        note: "Termin süresi rica olunur.",
        ...overrides
    };
}

function harness({ currentTenant = tenant() } = {}) {
    const records = new Map();
    const audits = [];
    const repository = {
        async listByTenant(tenantId, { status, limit }) {
            assert.equal(tenantId, TENANT_ID);
            let values = [...records.values()];
            if (status) values = values.filter(record => record.status === status);
            return values.slice(0, Number(limit));
        },
        async getById(tenantId, quoteId) {
            assert.equal(tenantId, TENANT_ID);
            return records.get(quoteId) || null;
        },
        async commitCreate({ quote, auditEvent }) {
            const existing = records.get(quote.quoteId);
            if (existing) {
                if (existing.requestHash !== quote.requestHash) {
                    const error = new Error("conflict");
                    error.code = "QUOTE_IDEMPOTENCY_CONFLICT";
                    throw error;
                }
                return { created: false, quote: existing };
            }
            records.set(quote.quoteId, quote);
            audits.push(auditEvent);
            return { created: true, quote };
        },
        async commitUpdate({ expectedQuote, nextQuote, auditEvent }) {
            assert.deepEqual(records.get(expectedQuote.quoteId), expectedQuote);
            records.set(nextQuote.quoteId, nextQuote);
            audits.push(auditEvent);
            return nextQuote;
        }
    };
    const entitlementService = {
        evaluate({ tenant: value, feature }) {
            return {
                tenantId: value.tenantId,
                feature,
                featureEnabled: value.features?.[feature] === true,
                usedDefaultPlanPolicy: false
            };
        },
        assertFeatureAccess({ tenant: value, feature }) {
            const result = this.evaluate({ tenant: value, feature });
            if (!result.featureEnabled) {
                const error = new Error("disabled");
                error.code = "ENTITLEMENT_DENIED";
                throw error;
            }
            return result;
        }
    };
    const service = createQuoteService({
        tenantRegistry: {
            async getById(tenantId) {
                return tenantId === currentTenant.tenantId ? currentTenant : null;
            }
        },
        repository,
        entitlementService,
        clock: () => new Date(NOW)
    });
    return { service, records, audits };
}

const OWNER = Object.freeze({
    role: "tenant_owner",
    actorId: "owner-1",
    tenantId: TENANT_ID
});

test("P10-8 public RFQ validates company/country/items and quantity", () => {
    const normalized = normalizePublicQuoteInput(input());
    assert.equal(normalized.companyName, "Atlas Makine AŞ");
    assert.equal(normalized.country, "Türkiye");
    assert.equal(normalized.items[0].quantity, 250);
    assert.throws(() => normalizePublicQuoteInput(input({
        items: [{ description: "Sac", quantity: 0, unit: "kg" }]
    })), /miktarı/i);
    assert.throws(() => normalizePublicQuoteInput(input({ email: null, phone: null })), /E-posta veya telefon/i);
});

test("P10-8 public create is idempotent and returns PII-free projection", async () => {
    const { service, records, audits } = harness();
    const first = await service.createPublic({
        tenantId: TENANT_ID,
        input: input(),
        idempotencyKey: "rfq:11111111-1111-4111-8111-111111111111"
    });
    const retry = await service.createPublic({
        tenantId: TENANT_ID,
        input: input(),
        idempotencyKey: "rfq:11111111-1111-4111-8111-111111111111"
    });
    assert.equal(first.created, true);
    assert.equal(retry.created, false);
    assert.equal(records.size, 1);
    assert.deepEqual(Object.keys(first.quote).sort(), ["createdAt", "quoteId", "status"]);
    assert.equal(audits.length, 1);
    assert.deepEqual(Object.keys(audits[0].metadata).sort(), ["itemCount", "quoteId", "status"]);
    const auditJson = JSON.stringify(audits[0]);
    assert.equal(auditJson.includes("Atlas Makine"), false);
    assert.equal(auditJson.includes("satinalma@example.com"), false);
    assert.equal(auditJson.includes("555 111"), false);
    assert.equal(auditJson.includes("Termin"), false);
});

test("P10-8 idempotency key cannot be reused with different request", async () => {
    const { service } = harness();
    const key = "rfq:22222222-2222-4222-8222-222222222222";
    await service.createPublic({ tenantId: TENANT_ID, input: input(), idempotencyKey: key });
    await assert.rejects(
        service.createPublic({
            tenantId: TENANT_ID,
            input: input({ companyName: "Başka Firma" }),
            idempotencyKey: key
        }),
        error => error?.code === "QUOTE_IDEMPOTENCY_CONFLICT"
    );
});

test("P10-8 public quote is denied for inactive or quote-disabled tenant", async () => {
    await assert.rejects(
        harness({ currentTenant: tenant({ status: "suspended" }) }).service.createPublic({
            tenantId: TENANT_ID,
            input: input(),
            idempotencyKey: "rfq:33333333-3333-4333-8333-333333333333"
        }),
        error => error?.code === "QUOTE_NOT_AVAILABLE"
    );
    await assert.rejects(
        harness({ currentTenant: tenant({ features: { ...tenant().features, quotes: false } }) }).service.createPublic({
            tenantId: TENANT_ID,
            input: input(),
            idempotencyKey: "rfq:44444444-4444-4444-8444-444444444444"
        }),
        error => error?.code === "QUOTE_NOT_AVAILABLE"
    );
});

test("P10-8 owner operations enforce exact tenant scope and controlled status transitions", async () => {
    const { service } = harness();
    const created = await service.createPublic({
        tenantId: TENANT_ID,
        input: input(),
        idempotencyKey: "rfq:55555555-5555-4555-8555-555555555555"
    });
    const updated = await service.updateAdmin({
        context: OWNER,
        tenantId: TENANT_ID,
        quoteId: created.quote.quoteId,
        input: {
            status: "quoted",
            amountMinor: 1250000,
            currency: "TRY",
            validUntil: "2026-10-01",
            customerMessage: "Teklifimiz ektedir.",
            ownerNote: "Marj kontrol edildi."
        }
    });
    assert.equal(updated.status, "quoted");
    assert.equal(updated.amountMinor, 1250000);
    const won = await service.updateAdmin({
        context: OWNER,
        tenantId: TENANT_ID,
        quoteId: created.quote.quoteId,
        input: { status: "won" }
    });
    assert.equal(won.status, "won");
    await assert.rejects(
        service.updateAdmin({
            context: OWNER,
            tenantId: TENANT_ID,
            quoteId: created.quote.quoteId,
            input: { status: "reviewing" }
        }),
        error => error?.code === "QUOTE_STATUS_TRANSITION_INVALID"
    );
    await assert.rejects(
        service.listAdmin({
            context: { ...OWNER, tenantId: "other-tenant" },
            tenantId: TENANT_ID
        }),
        error => error?.code === "TENANT_SCOPE_MISMATCH"
    );
});

test("P10-8 archived tenant cannot mutate quotes", async () => {
    const currentTenant = tenant();
    const { service } = harness({ currentTenant });
    const created = await service.createPublic({
        tenantId: TENANT_ID,
        input: input(),
        idempotencyKey: "rfq:66666666-6666-4666-8666-666666666666"
    });
    currentTenant.status = "archived";
    await assert.rejects(
        service.updateAdmin({
            context: OWNER,
            tenantId: TENANT_ID,
            quoteId: created.quote.quoteId,
            input: { status: "reviewing" }
        }),
        error => error?.code === "TENANT_ARCHIVED"
    );
});

test("P10-8 tenant quote collection stays tenant-scoped", () => {
    assert.equal(TENANT_COLLECTIONS.quotes, "quotes");
    assert.equal(
        tenantDocument(TENANT_ID, TENANT_COLLECTIONS.quotes, `q_${"a".repeat(32)}`),
        `tenants/${TENANT_ID}/quotes/q_${"a".repeat(32)}`
    );
});

test("P10-8 public and owner runtimes retain security contracts", () => {
    const root = path.join(__dirname, "..");
    const publicRuntime = fs.readFileSync(path.join(root, "src/http/attach-public-quote-runtime.js"), "utf8");
    const storefrontRuntime = fs.readFileSync(path.join(root, "src/http/attach-public-storefront-runtime.js"), "utf8");
    const ownerJs = fs.readFileSync(path.join(root, "public/owner/quotes.js"), "utf8");
    const publicJs = fs.readFileSync(path.join(root, "public/storefront/quote.js"), "utf8");
    const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

    assert.match(publicRuntime, /app\.post\(PUBLIC_QUOTE_PATH, limiter,/);
    assert.match(storefrontRuntime, /app\.get\("\/m\/:tenantId\/quote", limiter,/);
    assert.equal(ownerJs.includes("innerHTML"), false);
    assert.equal(publicJs.includes("innerHTML"), false);
    assert.equal(ownerJs.includes("localStorage"), false);
    assert.equal(publicJs.includes("localStorage"), false);
    assert.match(server, /createFirestoreQuoteRepository/);
    assert.match(server, /createQuoteService/);
    assert.match(server, /attachQuoteOwnerEndpoints/);
    assert.match(server, /attachPublicQuoteRuntime/);
});

test("P10-8 status transition contract rejects terminal reopening", () => {
    assert.equal(assertStatusTransition("new", "quoted"), true);
    assert.equal(assertStatusTransition("quoted", "won"), true);
    assert.throws(() => assertStatusTransition("won", "reviewing"), error => error?.code === "QUOTE_STATUS_TRANSITION_INVALID");
});
