(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const REQUEST_TRANSITIONS = Object.freeze({
        new: ["new", "in_progress", "converted", "closed"],
        in_progress: ["in_progress", "converted", "closed"],
        converted: ["converted"], closed: ["closed"]
    });
    const TASK_TRANSITIONS = Object.freeze({ open: ["open", "done", "cancelled"], done: ["done"], cancelled: ["cancelled"] });
    const LABELS = Object.freeze({
        active: "Aktif", inactive: "Pasif", new: "Yeni", in_progress: "İşleniyor", converted: "Dönüştü", closed: "Kapalı",
        open: "Açık", done: "Tamamlandı", cancelled: "İptal", low: "Düşük", normal: "Normal", high: "Yüksek"
    });

    const ids = [
        "auth-panel", "login-form", "tenant-id", "email", "password", "auth-message", "app", "refresh", "workspace-message",
        "stat-contacts", "stat-requests", "stat-conversion", "stat-overdue", "contact-form", "contact-name", "contact-company",
        "contact-email", "contact-phone", "contact-tags", "contact-note", "request-form", "request-contact", "request-title", "request-source",
        "request-due", "request-value", "request-currency", "request-description", "task-form", "task-title", "task-priority", "task-due",
        "task-request", "task-note", "contact-filter", "request-filter", "task-filter", "contact-list", "request-list", "task-list"
    ];
    const el = Object.fromEntries(ids.map(id => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), document.getElementById(id)]));
    if (Object.values(el).some(value => value === null) || typeof firebase === "undefined" || !firebase.auth) return;

    const state = { tenantId: "", contacts: [], requests: [], tasks: [] };

    function message(target, text = "", type = "") {
        target.textContent = text;
        target.className = "message";
        if (type) target.classList.add(type);
    }

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return TENANT_ID_PATTERN.test(tenantId) && tenantId.length >= 3 ? tenantId : "";
    }

    function readTenantId() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeTenantId(params.get("tenant"));
        if (fromUrl) return fromUrl;
        try { return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId")); } catch { return ""; }
    }

    function persistTenantId(value) {
        try { window.sessionStorage.setItem("platformOwnerTenantId", value); } catch { /* convenience only */ }
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    function ownerPath(suffix) {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/crm${suffix}`;
    }

    async function api(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${await token()}`);
        if (options.body) headers.set("Content-Type", "application/json");
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function node(tag, text = "", className = "") {
        const item = document.createElement(tag);
        if (className) item.className = className;
        item.textContent = text;
        return item;
    }

    function option(value, label, selected = false) {
        const item = document.createElement("option");
        item.value = value;
        item.textContent = label;
        item.selected = selected;
        return item;
    }

    function localToIso(value) {
        if (!value) return null;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error("Tarih/saat geçersiz.");
        return date.toISOString();
    }

    function formatDate(value) {
        return value ? new Date(value).toLocaleString("tr-TR") : "—";
    }

    function formatMoney(valueMinor, currency) {
        if (valueMinor === null || !currency) return "Değer yok";
        return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(valueMinor / 100);
    }

    function contactName(contactId) {
        const contact = state.contacts.find(item => item.contactId === contactId);
        return contact ? `${contact.name}${contact.company ? ` · ${contact.company}` : ""}` : contactId;
    }

    function refreshRelations() {
        const contactOptions = state.contacts.filter(item => item.status === "active").map(item => option(item.contactId, contactName(item.contactId)));
        el.requestContact.replaceChildren(...contactOptions);
        el.taskRequest.replaceChildren(option("", "Bağlantı yok"), ...state.requests
            .filter(item => ["new", "in_progress"].includes(item.status))
            .map(item => option(item.requestId, item.title)));
    }

    function renderContacts() {
        el.contactList.replaceChildren();
        if (!state.contacts.length) { el.contactList.append(node("p", "Müşteri bulunmuyor.", "empty")); return; }
        for (const contact of state.contacts) {
            const card = node("article", "", "item-card");
            const row = node("div", "", "crm-card-row");
            const info = document.createElement("div");
            info.append(node("h3", contact.name), node("p", [contact.company, contact.email, contact.phone].filter(Boolean).join(" · ") || "İletişim yok"));
            const meta = node("div", "", "item-meta");
            meta.append(node("span", LABELS[contact.status] || contact.status), node("span", `Eklenme: ${formatDate(contact.createdAt)}`));
            info.append(meta);
            if (contact.tags?.length) {
                const tags = node("div", "", "crm-tags");
                for (const tag of contact.tags) tags.append(node("span", tag, "crm-tag"));
                info.append(tags);
            }
            const actions = node("div", "", "crm-card-actions");
            const toggle = node("button", contact.status === "active" ? "Pasife al" : "Aktifleştir", "small-button");
            toggle.type = "button";
            toggle.addEventListener("click", async () => {
                toggle.disabled = true;
                try {
                    await api(ownerPath(`/contacts/${encodeURIComponent(contact.contactId)}`), {
                        method: "PATCH", body: JSON.stringify({ status: contact.status === "active" ? "inactive" : "active" })
                    });
                    await loadAll();
                } catch (error) { message(el.workspaceMessage, error.message, "error"); toggle.disabled = false; }
            });
            actions.append(toggle); row.append(info, actions); card.append(row); el.contactList.append(card);
        }
    }

    function renderRequests() {
        el.requestList.replaceChildren();
        if (!state.requests.length) { el.requestList.append(node("p", "Talep bulunmuyor.", "empty")); return; }
        for (const request of state.requests) {
            const card = node("article", "", "item-card");
            const row = node("div", "", "crm-card-row");
            const info = document.createElement("div");
            info.append(node("h3", request.title), node("p", `${contactName(request.contactId)} · ${request.source}`));
            const meta = node("div", "", "item-meta");
            meta.append(node("span", LABELS[request.status] || request.status), node("span", formatMoney(request.valueMinor, request.currency), "crm-value"));
            if (request.dueAt) meta.append(node("span", `Son: ${formatDate(request.dueAt)}`));
            info.append(meta);
            if (request.description) info.append(node("p", request.description));
            const actions = node("div", "", "crm-card-actions");
            const select = document.createElement("select");
            for (const status of REQUEST_TRANSITIONS[request.status] || [request.status]) select.append(option(status, LABELS[status] || status, status === request.status));
            const save = node("button", "Durumu kaydet", "small-button"); save.type = "button";
            const terminal = ["converted", "closed"].includes(request.status);
            select.disabled = terminal; save.disabled = terminal;
            save.addEventListener("click", async () => {
                save.disabled = true;
                try {
                    await api(ownerPath(`/requests/${encodeURIComponent(request.requestId)}`), { method: "PATCH", body: JSON.stringify({ status: select.value }) });
                    await loadAll();
                } catch (error) { message(el.workspaceMessage, error.message, "error"); save.disabled = false; }
            });
            actions.append(select, save); row.append(info, actions); card.append(row); el.requestList.append(card);
        }
    }

    function renderTasks() {
        el.taskList.replaceChildren();
        if (!state.tasks.length) { el.taskList.append(node("p", "Görev bulunmuyor.", "empty")); return; }
        const now = Date.now();
        for (const task of state.tasks) {
            const card = node("article", "", "item-card");
            const row = node("div", "", "crm-card-row");
            const info = document.createElement("div");
            info.append(node("h3", task.title));
            const meta = node("div", "", "item-meta");
            meta.append(node("span", LABELS[task.priority] || task.priority), node("span", LABELS[task.status] || task.status));
            if (task.dueAt) {
                const overdue = task.status === "open" && new Date(task.dueAt).getTime() < now;
                meta.append(node("span", `${overdue ? "Gecikti" : "Son"}: ${formatDate(task.dueAt)}`, overdue ? "crm-overdue" : ""));
            }
            if (task.relatedType === "request") meta.append(node("span", `Talep: ${state.requests.find(item => item.requestId === task.relatedId)?.title || task.relatedId}`));
            info.append(meta);
            if (task.note) info.append(node("p", task.note));
            const actions = node("div", "", "crm-card-actions");
            const select = document.createElement("select");
            for (const status of TASK_TRANSITIONS[task.status] || [task.status]) select.append(option(status, LABELS[status] || status, status === task.status));
            const save = node("button", "Durumu kaydet", "small-button"); save.type = "button";
            const terminal = ["done", "cancelled"].includes(task.status);
            select.disabled = terminal; save.disabled = terminal;
            save.addEventListener("click", async () => {
                save.disabled = true;
                try {
                    await api(ownerPath(`/tasks/${encodeURIComponent(task.taskId)}`), { method: "PATCH", body: JSON.stringify({ status: select.value }) });
                    await loadAll();
                } catch (error) { message(el.workspaceMessage, error.message, "error"); save.disabled = false; }
            });
            actions.append(select, save); row.append(info, actions); card.append(row); el.taskList.append(card);
        }
    }

    async function loadContacts() {
        const params = new URLSearchParams({ limit: "100" });
        if (el.contactFilter.value) params.set("status", el.contactFilter.value);
        const body = await api(`${ownerPath("/contacts")}?${params}`);
        state.contacts = Array.isArray(body?.contacts) ? body.contacts : [];
        renderContacts(); refreshRelations();
    }

    async function loadRequests() {
        const params = new URLSearchParams({ limit: "100" });
        if (el.requestFilter.value) params.set("status", el.requestFilter.value);
        const body = await api(`${ownerPath("/requests")}?${params}`);
        state.requests = Array.isArray(body?.requests) ? body.requests : [];
        renderRequests(); refreshRelations();
    }

    async function loadTasks() {
        const params = new URLSearchParams({ limit: "100" });
        if (el.taskFilter.value) params.set("status", el.taskFilter.value);
        const body = await api(`${ownerPath("/tasks")}?${params}`);
        state.tasks = Array.isArray(body?.tasks) ? body.tasks : [];
        renderTasks();
    }

    async function loadReport() {
        const body = await api(ownerPath("/report"));
        const report = body?.report;
        el.statContacts.textContent = String(report?.contacts?.total ?? 0);
        el.statRequests.textContent = String(report?.requests?.total ?? 0);
        el.statConversion.textContent = `${Math.round(Number(report?.requests?.conversionRate || 0) * 100)}%`;
        el.statOverdue.textContent = String(report?.tasks?.overdue ?? 0);
    }

    async function loadAll() {
        message(el.workspaceMessage);
        await Promise.all([loadContacts(), loadRequests(), loadTasks(), loadReport()]);
        el.authPanel.classList.add("hidden"); el.app.classList.remove("hidden");
    }

    el.contactForm.addEventListener("submit", async event => {
        event.preventDefault(); message(el.workspaceMessage);
        const email = el.contactEmail.value.trim(); const phone = el.contactPhone.value.trim();
        if (!email && !phone) { message(el.workspaceMessage, "E-posta veya telefon girin.", "error"); return; }
        const tags = el.contactTags.value.split(",").map(item => item.trim()).filter(Boolean);
        try {
            await api(ownerPath("/contacts"), { method: "POST", body: JSON.stringify({
                name: el.contactName.value.trim(), company: el.contactCompany.value.trim() || null,
                email: email || null, phone: phone || null, tags, note: el.contactNote.value.trim() || null
            }) });
            el.contactForm.reset(); message(el.workspaceMessage, "Müşteri eklendi.", "success"); await loadAll();
        } catch (error) { message(el.workspaceMessage, error.message, "error"); }
    });

    el.requestForm.addEventListener("submit", async event => {
        event.preventDefault(); message(el.workspaceMessage);
        const major = el.requestValue.value.trim() === "" ? null : Number(el.requestValue.value);
        if (major !== null && (!Number.isFinite(major) || major < 0 || !Number.isSafeInteger(Math.round(major * 100)))) {
            message(el.workspaceMessage, "Talep değerini kontrol edin.", "error"); return;
        }
        const currency = el.requestCurrency.value.trim().toUpperCase();
        try {
            await api(ownerPath("/requests"), { method: "POST", body: JSON.stringify({
                contactId: el.requestContact.value, title: el.requestTitle.value.trim(), source: el.requestSource.value,
                dueAt: localToIso(el.requestDue.value), description: el.requestDescription.value.trim() || null,
                valueMinor: major === null ? null : Math.round(major * 100), currency: major === null ? null : currency
            }) });
            el.requestForm.reset(); el.requestCurrency.value = "TRY"; message(el.workspaceMessage, "Talep eklendi.", "success"); await loadAll();
        } catch (error) { message(el.workspaceMessage, error.message, "error"); }
    });

    el.taskForm.addEventListener("submit", async event => {
        event.preventDefault(); message(el.workspaceMessage);
        const relatedId = el.taskRequest.value || null;
        try {
            await api(ownerPath("/tasks"), { method: "POST", body: JSON.stringify({
                title: el.taskTitle.value.trim(), priority: el.taskPriority.value, dueAt: localToIso(el.taskDue.value),
                relatedType: relatedId ? "request" : null, relatedId, note: el.taskNote.value.trim() || null
            }) });
            el.taskForm.reset(); message(el.workspaceMessage, "Görev eklendi.", "success"); await loadAll();
        } catch (error) { message(el.workspaceMessage, error.message, "error"); }
    });

    el.refresh.addEventListener("click", () => loadAll().catch(error => message(el.workspaceMessage, error.message, "error")));
    el.contactFilter.addEventListener("change", () => loadContacts().catch(error => message(el.workspaceMessage, error.message, "error")));
    el.requestFilter.addEventListener("change", () => loadRequests().catch(error => message(el.workspaceMessage, error.message, "error")));
    el.taskFilter.addEventListener("change", () => loadTasks().catch(error => message(el.workspaceMessage, error.message, "error")));

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") { message(el.authMessage, "Firebase bağlantısı yapılandırılmamış.", "error"); return; }
    firebase.initializeApp(firebaseConfig);
    state.tenantId = readTenantId(); el.tenantId.value = state.tenantId;

    el.loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        const tenantId = normalizeTenantId(el.tenantId.value);
        if (!tenantId) { message(el.authMessage, "Geçerli işletme kodu girin.", "error"); return; }
        state.tenantId = tenantId; persistTenantId(tenantId);
        try { await firebase.auth().signInWithEmailAndPassword(el.email.value.trim(), el.password.value); }
        catch { message(el.authMessage, "Giriş başarısız.", "error"); }
    });

    firebase.auth().onAuthStateChanged(async user => {
        if (!user) { el.app.classList.add("hidden"); el.authPanel.classList.remove("hidden"); return; }
        const tenantId = normalizeTenantId(el.tenantId.value) || state.tenantId;
        if (!tenantId) { await firebase.auth().signOut(); message(el.authMessage, "İşletme kodu gerekli.", "error"); return; }
        state.tenantId = tenantId; persistTenantId(tenantId);
        try { await loadAll(); }
        catch (error) { message(el.authMessage, error.message, "error"); el.app.classList.add("hidden"); el.authPanel.classList.remove("hidden"); }
    });
})();
