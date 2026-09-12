const { sendPlatformError } = require("./create-platform-app");

const BASE = "/api/tenant/tenants/:tenantId/owner/crm";

function context(req) {
    return Object.freeze({
        role: req.tenantActor?.role,
        actorId: req.tenantActor?.actorId,
        tenantId: req.tenantActor?.tenantId
    });
}

function sendError(res, error) {
    if (new Set([
        "TENANT_NOT_FOUND", "CRM_CONTACT_NOT_FOUND", "CRM_REQUEST_NOT_FOUND", "CRM_TASK_NOT_FOUND"
    ]).has(error?.code)) {
        return res.status(404).json({ success: false, message: "CRM kaydı bulunamadı." });
    }
    if (new Set([
        "TENANT_ARCHIVED", "ENTITLEMENT_PLAN_UNRESOLVED", "ENTITLEMENT_DENIED",
        "CRM_REQUEST_STATUS_TRANSITION_INVALID", "CRM_TASK_STATUS_TRANSITION_INVALID",
        "CRM_STATE_CHANGED", "CRM_ID_CONFLICT"
    ]).has(error?.code)) {
        return res.status(409).json({ success: false, message: "İşlem mevcut CRM veya işletme durumuyla uyumlu değil." });
    }
    if (error?.code === "CRM_UNAVAILABLE") {
        return res.status(503).json({ success: false, message: "CRM raporu şu anda alınamıyor." });
    }
    return sendPlatformError(res, error);
}

function listQuery(req) {
    const allowed = new Set(["status", "limit"]);
    for (const key of Reflect.ownKeys(req.query)) {
        if (!allowed.has(key)) throw new TypeError("CRM list query geçersiz.");
    }
    return {
        status: req.query.status || null,
        limit: req.query.limit === undefined ? 100 : req.query.limit
    };
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) throw new TypeError("CRM endpoint query kabul etmez.");
}

function requireJson(req, res) {
    if (req.is("application/json")) return true;
    res.status(415).json({ success: false, message: "Content-Type application/json olmalı." });
    return false;
}

function attachCrmOwnerEndpoints({ app, crmService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.post !== "function" || typeof app.patch !== "function") {
        throw new TypeError("CRM owner endpoint app geçersiz.");
    }
    const required = [
        "listContacts", "createContact", "updateContact", "listRequests", "createRequest",
        "updateRequest", "listTasks", "createTask", "updateTask", "report"
    ];
    if (!crmService || required.some(name => typeof crmService[name] !== "function")) {
        throw new TypeError("CRM owner service geçersiz.");
    }

    app.get(`${BASE}/contacts`, async (req, res) => {
        try {
            const contacts = await crmService.listContacts({
                context: context(req), tenantId: req.params.tenantId, ...listQuery(req)
            });
            return res.json({ success: true, contacts });
        } catch (error) { return sendError(res, error); }
    });

    app.post(`${BASE}/contacts`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const contact = await crmService.createContact({
                context: context(req), tenantId: req.params.tenantId, input: req.body, requestId: req.requestId || null
            });
            return res.status(201).json({ success: true, contact });
        } catch (error) { return sendError(res, error); }
    });

    app.patch(`${BASE}/contacts/:contactId`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const contact = await crmService.updateContact({
                context: context(req), tenantId: req.params.tenantId, contactId: req.params.contactId,
                input: req.body, requestId: req.requestId || null
            });
            return res.json({ success: true, contact });
        } catch (error) { return sendError(res, error); }
    });

    app.get(`${BASE}/requests`, async (req, res) => {
        try {
            const requests = await crmService.listRequests({
                context: context(req), tenantId: req.params.tenantId, ...listQuery(req)
            });
            return res.json({ success: true, requests });
        } catch (error) { return sendError(res, error); }
    });

    app.post(`${BASE}/requests`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const request = await crmService.createRequest({
                context: context(req), tenantId: req.params.tenantId, input: req.body, requestId: req.requestId || null
            });
            return res.status(201).json({ success: true, request });
        } catch (error) { return sendError(res, error); }
    });

    app.patch(`${BASE}/requests/:crmRequestId`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const request = await crmService.updateRequest({
                context: context(req), tenantId: req.params.tenantId, crmRequestId: req.params.crmRequestId,
                input: req.body, requestId: req.requestId || null
            });
            return res.json({ success: true, request });
        } catch (error) { return sendError(res, error); }
    });

    app.get(`${BASE}/tasks`, async (req, res) => {
        try {
            const tasks = await crmService.listTasks({
                context: context(req), tenantId: req.params.tenantId, ...listQuery(req)
            });
            return res.json({ success: true, tasks });
        } catch (error) { return sendError(res, error); }
    });

    app.post(`${BASE}/tasks`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const task = await crmService.createTask({
                context: context(req), tenantId: req.params.tenantId, input: req.body, requestId: req.requestId || null
            });
            return res.status(201).json({ success: true, task });
        } catch (error) { return sendError(res, error); }
    });

    app.patch(`${BASE}/tasks/:taskId`, async (req, res) => {
        try {
            noQuery(req);
            if (!requireJson(req, res)) return;
            const task = await crmService.updateTask({
                context: context(req), tenantId: req.params.tenantId, taskId: req.params.taskId,
                input: req.body, requestId: req.requestId || null
            });
            return res.json({ success: true, task });
        } catch (error) { return sendError(res, error); }
    });

    app.get(`${BASE}/report`, async (req, res) => {
        try {
            noQuery(req);
            const report = await crmService.report({ context: context(req), tenantId: req.params.tenantId });
            return res.json({ success: true, report });
        } catch (error) { return sendError(res, error); }
    });

    return app;
}

module.exports = { CRM_OWNER_BASE: BASE, attachCrmOwnerEndpoints };
