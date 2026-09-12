const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { FEATURE_CATALOG, createFeatureFlags } = require("../src/tenant/feature-catalog");
const { SECTOR_TEMPLATE_CATALOG } = require("../src/tenant/sector-template-catalog");
const { TENANT_COLLECTIONS, tenantCollection } = require("../src/firestore/tenant-paths");
const {
    createRecord,
    normalizeContactInput,
    normalizeRequestInput,
    normalizeTaskInput
} = require("../src/crm/crm-model");
const { createCrmService } = require("../src/crm/crm-service");

function crmTenant(tenantId, status = "active", enabled = true) {
    return Object.freeze({
        tenantId,
        status,
        plan: "starter",
        features: createFeatureFlags({ crm: enabled })
    });
}

function createRepository() {
    const contacts = new Map();
    const requests = new Map();
    const tasks = new Map();
    const audits = [];
    const maps = { contact: contacts, request: requests, task: tasks };
    const ids = { contact: "contactId", request: "requestId", task: "taskId" };

    function list(map, status, limit) {
        return [...map.values()]
            .filter(item => !status || item.status === status)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, Number(limit || 100));
    }

    return {
        audits,
        async listContacts(_tenantId, { status, limit }) { return list(contacts, status, limit); },
        async getContact(_tenantId, id) { return contacts.get(id) || null; },
        async listRequests(_tenantId, { status, limit }) { return list(requests, status, limit); },
        async getRequest(_tenantId, id) { return requests.get(id) || null; },
        async listTasks(_tenantId, { status, limit }) { return list(tasks, status, limit); },
        async getTask(_tenantId, id) { return tasks.get(id) || null; },
        async loadReportData() { return { contacts: [...contacts.values()], requests: [...requests.values()], tasks: [...tasks.values()] }; },
        async commitCreate({ kind, record, auditEvent }) {
            maps[kind].set(record[ids[kind]], record);
            audits.push(auditEvent);
            return record;
        },
        async commitUpdate({ kind, expectedRecord, nextRecord, auditEvent }) {
            assert.deepEqual(maps[kind].get(expectedRecord[ids[kind]]), expectedRecord);
            maps[kind].set(nextRecord[ids[kind]], nextRecord);
            audits.push(auditEvent);
            return nextRecord;
        }
    };
}

function createEntitlement() {
    return {
        assertFeatureAccess({ tenant, feature }) {
            if (feature !== "crm" || tenant.features?.crm !== true) {
                const error = new Error("denied");
                error.code = "ENTITLEMENT_DENIED";
                throw error;
            }
            return { feature: "crm", featureEnabled: true, usedDefaultPlanPolicy: false };
        }
    };
}

function ownerContext(tenantId) {
    return { role: "tenant_owner", actorId: `owner-${tenantId}`, tenantId };
}

function serviceFixture({ status = "active", enabled = true } = {}) {
    const tenant = crmTenant("acme-b2b", status, enabled);
    const repository = createRepository();
    const tenantRegistry = { async getById(id) { return id === tenant.tenantId ? tenant : null; } };
    const fixedNow = new Date("2026-09-12T12:00:00.000Z");
    return {
        tenant,
        repository,
        service: createCrmService({ tenantRegistry, repository, entitlementService: createEntitlement(), clock: () => new Date(fixedNow) })
    };
}

test("CRM feature katalog ve B2B şablonlarında güvenli varsayılanla kayıtlıdır", () => {
    assert.equal(FEATURE_CATALOG.crm.defaultEnabled, false);
    const manufacturing = SECTOR_TEMPLATE_CATALOG.find(item => item.id === "manufacturing-b2b");
    const wholesale = SECTOR_TEMPLATE_CATALOG.find(item => item.id === "wholesale-b2b");
    const professional = SECTOR_TEMPLATE_CATALOG.find(item => item.id === "professional-services");
    assert.equal(manufacturing.features.crm, true);
    assert.equal(wholesale.features.crm, true);
    assert.equal(professional.features.crm, true);
    assert.equal(SECTOR_TEMPLATE_CATALOG.find(item => item.id === "restaurant").features.crm, false);
});

test("CRM model müşteri iletişimini ve ilişkili kayıtları sıkı doğrular", () => {
    assert.throws(() => normalizeContactInput({ name: "Acme Yetkili" }), /e-posta veya telefon/i);
    const contact = createRecord({ tenantId: "acme-b2b", kind: "contact", input: { name: "Ayşe Kaya", email: "AYSE@example.com" } });
    assert.match(contact.contactId, /^c_[0-9a-f]{24}$/);
    assert.equal(contact.email, "ayse@example.com");
    assert.throws(() => normalizeRequestInput({ contactId: "wrong", title: "Talep" }), /ID geçersiz/);
    assert.throws(() => normalizeTaskInput({ title: "Ara", relatedType: "request", relatedId: null }), /birlikte girilmeli/);
});

test("CRM müşteri-talep-görev akışı rapor üretir ve audit metadata PII içermez", async () => {
    const fixture = serviceFixture();
    const context = ownerContext(fixture.tenant.tenantId);
    const contact = await fixture.service.createContact({
        context,
        tenantId: fixture.tenant.tenantId,
        input: { name: "Ayşe Kaya", company: "Acme", email: "ayse@example.com", phone: "+90 555 111 22 33", tags: ["VIP"] }
    });
    const request = await fixture.service.createRequest({
        context,
        tenantId: fixture.tenant.tenantId,
        input: {
            contactId: contact.contactId,
            title: "500 adet özel üretim",
            source: "website",
            valueMinor: 2500000,
            currency: "TRY",
            dueAt: "2026-09-11T09:00:00Z",
            note: "Gizli müşteri notu"
        }
    });
    const task = await fixture.service.createTask({
        context,
        tenantId: fixture.tenant.tenantId,
        input: {
            title: "Müşteriyi ara",
            priority: "high",
            dueAt: "2026-09-11T10:00:00Z",
            relatedType: "request",
            relatedId: request.requestId
        }
    });

    const report = await fixture.service.report({ context, tenantId: fixture.tenant.tenantId });
    assert.equal(report.contacts.total, 1);
    assert.equal(report.requests.total, 1);
    assert.equal(report.requests.byStatus.new, 1);
    assert.equal(report.requests.pipelineValueByCurrency.TRY, 2500000);
    assert.equal(report.tasks.total, 1);
    assert.equal(report.tasks.overdue, 1);
    assert.equal(report.requests.conversionRate, 0);

    const auditText = JSON.stringify(fixture.repository.audits.map(item => item.metadata));
    assert.doesNotMatch(auditText, /Ayşe|Acme|ayse@example|\+90 555 111 22 33|\+905551112233|Gizli müşteri notu|500 adet/i);
    assert.match(auditText, new RegExp(contact.contactId));
    assert.match(auditText, new RegExp(request.requestId));
    assert.match(auditText, new RegExp(task.taskId));

    const converted = await fixture.service.updateRequest({
        context, tenantId: fixture.tenant.tenantId, crmRequestId: request.requestId, input: { status: "converted" }
    });
    assert.equal(converted.status, "converted");
    await assert.rejects(
        fixture.service.updateRequest({
            context, tenantId: fixture.tenant.tenantId, crmRequestId: request.requestId, input: { status: "in_progress" }
        }),
        error => error?.code === "CRM_REQUEST_STATUS_TRANSITION_INVALID"
    );
});

test("CRM cross-tenant fail closed, entitlement ve archived mutation korunur", async () => {
    const fixture = serviceFixture();
    await assert.rejects(
        fixture.service.listContacts({ context: ownerContext("other-tenant"), tenantId: fixture.tenant.tenantId }),
        error => error?.code === "TENANT_SCOPE_MISMATCH" || error?.code === "PERMISSION_DENIED"
    );

    const disabled = serviceFixture({ enabled: false });
    await assert.rejects(
        disabled.service.listContacts({ context: ownerContext(disabled.tenant.tenantId), tenantId: disabled.tenant.tenantId }),
        error => error?.code === "ENTITLEMENT_DENIED"
    );

    const archived = serviceFixture({ status: "archived" });
    await assert.rejects(
        archived.service.createContact({
            context: ownerContext(archived.tenant.tenantId), tenantId: archived.tenant.tenantId,
            input: { name: "Arşiv Müşteri", phone: "+90 555 000 00 00" }
        }),
        error => error?.code === "TENANT_ARCHIVED"
    );
});

test("CRM tenant koleksiyonları exact tenant altında kalır", () => {
    assert.equal(tenantCollection("acme-b2b", TENANT_COLLECTIONS.crmContacts), "tenants/acme-b2b/crmContacts");
    assert.equal(tenantCollection("acme-b2b", TENANT_COLLECTIONS.crmRequests), "tenants/acme-b2b/crmRequests");
    assert.equal(tenantCollection("acme-b2b", TENANT_COLLECTIONS.crmTasks), "tenants/acme-b2b/crmTasks");
});

test("CRM owner UI güvenli DOM/session storage kullanır ve server wiring mevcuttur", () => {
    const html = fs.readFileSync(path.join(__dirname, "../public/owner/crm.html"), "utf8");
    const script = fs.readFileSync(path.join(__dirname, "../public/owner/crm.js"), "utf8");
    const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
    const endpoints = fs.readFileSync(path.join(__dirname, "../src/http/attach-crm-owner-endpoints.js"), "utf8");

    assert.match(html, /\/owner\/crm\.js/);
    assert.match(script, /sessionStorage/);
    assert.doesNotMatch(script, /localStorage/);
    assert.doesNotMatch(script, /innerHTML\s*=/);
    assert.match(script, /textContent/);
    assert.match(endpoints, /\/owner\/crm/);
    assert.match(endpoints, /application\/json/);
    assert.match(server, /createFirestoreCrmRepository/);
    assert.match(server, /createCrmService/);
    assert.match(server, /attachCrmOwnerEndpoints/);
});
