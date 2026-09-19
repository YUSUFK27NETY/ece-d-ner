(() => {
    "use strict";

    const adminAuth = window.PLATFORM_ADMIN_AUTH;
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const STATUS_LABELS = Object.freeze({
        open: "Açık",
        in_review: "İnceleniyor",
        resolved: "Çözüldü"
    });
    const STATUS_TRANSITIONS = Object.freeze({
        open: Object.freeze(["in_review", "resolved"]),
        in_review: Object.freeze(["resolved"]),
        resolved: Object.freeze([])
    });
    const ROLE_LABELS = Object.freeze({
        tenant_owner: "İşletme sahibi",
        tenant_admin: "İşletme yöneticisi",
        platform_admin: "Platform desteği"
    });

    const el = Object.freeze({
        refresh: document.getElementById("tickets-refresh"),
        session: document.getElementById("tickets-session"),
        message: document.getElementById("tickets-message"),
        tenantFilter: document.getElementById("tenant-filter"),
        statusFilter: document.getElementById("status-filter"),
        applyFilter: document.getElementById("apply-filter"),
        count: document.getElementById("ticket-count"),
        list: document.getElementById("ticket-list"),
        empty: document.getElementById("ticket-empty"),
        detail: document.getElementById("ticket-detail"),
        detailTenant: document.getElementById("detail-tenant"),
        detailSubject: document.getElementById("detail-subject"),
        detailStatus: document.getElementById("detail-status"),
        detailMeta: document.getElementById("detail-meta"),
        detailDescription: document.getElementById("detail-description"),
        detailHistory: document.getElementById("detail-history"),
        statusForm: document.getElementById("status-form"),
        nextStatus: document.getElementById("next-status"),
        statusNote: document.getElementById("status-note"),
        statusSubmit: document.getElementById("status-submit"),
        statusMessage: document.getElementById("status-message")
    });

    if (Object.values(el).some(value => value === null) || !adminAuth) return;

    const state = {
        tickets: [],
        selected: null,
        requestVersion: 0,
        busy: false
    };

    function setMessage(target, text = "", type = "") {
        target.textContent = text;
        target.className = "message";
        if (type) target.classList.add(type);
    }

    function formatDate(value) {
        const timestamp = Date.parse(String(value || ""));
        if (Number.isNaN(timestamp)) return "—";
        return new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(new Date(timestamp));
    }

    function normalizeTenantFilter(value) {
        const tenantId = String(value || "").trim().toLowerCase();
        if (!tenantId) return "";
        return TENANT_ID_PATTERN.test(tenantId) &&
            tenantId.length >= 3 && tenantId.length <= 63 ? tenantId : null;
    }

    async function token() {
        const user = adminAuth.currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken();
    }

    async function apiRequest(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${await token()}`);
        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            throw new Error(body?.message || `İstek başarısız (${response.status}).`);
        }
        return body;
    }

    function requireTicket(ticket) {
        if (!ticket || typeof ticket !== "object" || Array.isArray(ticket) ||
            typeof ticket.ticketId !== "string" ||
            typeof ticket.tenantId !== "string" ||
            !TENANT_ID_PATTERN.test(ticket.tenantId) ||
            typeof ticket.subject !== "string" ||
            typeof ticket.description !== "string" ||
            !Object.hasOwn(STATUS_LABELS, ticket.status) ||
            !Array.isArray(ticket.history)) {
            throw new Error("Destek talebi yanıtı doğrulanamadı.");
        }
        return ticket;
    }

    function ticketButton(ticket) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ticket-admin-card";
        if (state.selected?.ticketId === ticket.ticketId) button.classList.add("active");

        const head = document.createElement("div");
        head.className = "ticket-admin-head";
        const subject = document.createElement("strong");
        subject.textContent = ticket.subject;
        const badge = document.createElement("span");
        badge.className = `ticket-status ${ticket.status}`;
        badge.textContent = STATUS_LABELS[ticket.status];
        head.append(subject, badge);

        const meta = document.createElement("div");
        meta.className = "ticket-admin-meta";
        const tenant = document.createElement("span");
        tenant.textContent = ticket.tenantId;
        const updated = document.createElement("span");
        updated.textContent = `Güncellendi: ${formatDate(ticket.updatedAt)}`;
        meta.append(tenant, updated);

        button.append(head, meta);
        button.addEventListener("click", () => loadDetail(ticket));
        return button;
    }

    function renderList() {
        el.list.replaceChildren();
        el.count.textContent = String(state.tickets.length);
        if (!state.tickets.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            const text = document.createElement("p");
            text.className = "muted";
            text.textContent = "Filtreyle eşleşen destek talebi yok.";
            empty.append(text);
            el.list.append(empty);
            return;
        }
        for (const ticket of state.tickets) el.list.append(ticketButton(ticket));
    }

    function renderHistory(ticket) {
        el.detailHistory.replaceChildren();
        for (const entry of ticket.history) {
            const row = document.createElement("article");
            row.className = "ticket-history-row";
            const title = document.createElement("strong");
            title.textContent = `${STATUS_LABELS[entry.status] || entry.status} · ${ROLE_LABELS[entry.actorRole] || "Kullanıcı"}`;
            const time = document.createElement("small");
            time.textContent = formatDate(entry.createdAt);
            row.append(title, time);
            if (entry.note) {
                const note = document.createElement("p");
                note.textContent = entry.note;
                row.append(note);
            }
            el.detailHistory.append(row);
        }
    }

    function renderStatusOptions(ticket) {
        el.nextStatus.replaceChildren();
        const transitions = STATUS_TRANSITIONS[ticket.status] || [];
        for (const status of transitions) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = STATUS_LABELS[status];
            el.nextStatus.append(option);
        }
        const terminal = transitions.length === 0;
        el.nextStatus.disabled = terminal;
        el.statusNote.disabled = terminal;
        el.statusSubmit.disabled = terminal || state.busy;
        el.statusForm.classList.toggle("hidden", terminal);
    }

    function renderDetail(ticket) {
        state.selected = ticket;
        el.empty.classList.add("hidden");
        el.detail.classList.remove("hidden");
        el.detailTenant.textContent = ticket.tenantId;
        el.detailSubject.textContent = ticket.subject;
        el.detailStatus.className = `ticket-status ${ticket.status}`;
        el.detailStatus.textContent = STATUS_LABELS[ticket.status];
        el.detailMeta.textContent =
            `Açıldı: ${formatDate(ticket.createdAt)} · Son güncelleme: ${formatDate(ticket.updatedAt)}`;
        el.detailDescription.textContent = ticket.description;
        el.statusNote.value = "";
        setMessage(el.statusMessage);
        renderHistory(ticket);
        renderStatusOptions(ticket);
        renderList();
    }

    async function loadDetail(ticket) {
        const version = ++state.requestVersion;
        setMessage(el.message, "Destek talebi açılıyor...");
        try {
            const body = await apiRequest(
                `/api/platform/support/tickets/${encodeURIComponent(ticket.tenantId)}/${encodeURIComponent(ticket.ticketId)}`
            );
            if (version !== state.requestVersion) return;
            renderDetail(requireTicket(body?.ticket));
            setMessage(el.message);
        } catch (error) {
            if (version !== state.requestVersion) return;
            setMessage(el.message, error.message, "error");
        }
    }

    function buildListPath() {
        const params = new URLSearchParams();
        const tenantId = normalizeTenantFilter(el.tenantFilter.value);
        if (tenantId === null) throw new Error("Tenant ID geçersiz.");
        if (tenantId) params.set("tenantId", tenantId);
        if (el.statusFilter.value !== "all") {
            params.set("status", el.statusFilter.value);
        }
        params.set("limit", "200");
        return `/api/platform/support/tickets?${params.toString()}`;
    }

    async function loadTickets() {
        const version = ++state.requestVersion;
        el.refresh.disabled = true;
        el.applyFilter.disabled = true;
        setMessage(el.message, "Destek talepleri yükleniyor...");
        try {
            const body = await apiRequest(buildListPath());
            if (version !== state.requestVersion) return;
            state.tickets = Array.isArray(body?.tickets)
                ? body.tickets.map(requireTicket)
                : [];
            if (state.selected &&
                !state.tickets.some(item => item.ticketId === state.selected.ticketId)) {
                state.selected = null;
                el.detail.classList.add("hidden");
                el.empty.classList.remove("hidden");
            }
            renderList();
            setMessage(el.message);
        } catch (error) {
            if (version !== state.requestVersion) return;
            state.tickets = [];
            renderList();
            setMessage(el.message, error.message, "error");
        } finally {
            if (version === state.requestVersion) {
                el.refresh.disabled = false;
                el.applyFilter.disabled = false;
            }
        }
    }

    async function updateStatus(event) {
        event.preventDefault();
        if (!state.selected || state.busy) return;
        const next = el.nextStatus.value;
        if (!(STATUS_TRANSITIONS[state.selected.status] || []).includes(next)) {
            setMessage(el.statusMessage, "Geçersiz durum geçişi.", "error");
            return;
        }
        state.busy = true;
        renderStatusOptions(state.selected);
        setMessage(el.statusMessage, "Durum güncelleniyor...");
        try {
            const body = await apiRequest(
                `/api/platform/support/tickets/${encodeURIComponent(state.selected.tenantId)}/${encodeURIComponent(state.selected.ticketId)}/status`,
                {
                    method: "PATCH",
                    body: JSON.stringify({
                        status: next,
                        note: el.statusNote.value.trim() || null
                    })
                }
            );
            const updated = requireTicket(body?.ticket);
            const index = state.tickets.findIndex(item => item.ticketId === updated.ticketId);
            if (index >= 0) state.tickets[index] = updated;
            renderDetail(updated);
            setMessage(el.statusMessage, "Destek talebi güncellendi.", "success");
        } catch (error) {
            setMessage(el.statusMessage, error.message, "error");
        } finally {
            state.busy = false;
            if (state.selected) renderStatusOptions(state.selected);
        }
    }

    el.refresh.addEventListener("click", loadTickets);
    el.applyFilter.addEventListener("click", loadTickets);
    el.statusForm.addEventListener("submit", updateStatus);

    const initialTenant = new URLSearchParams(location.search).get("tenantId");
    if (initialTenant && normalizeTenantFilter(initialTenant)) {
        el.tenantFilter.value = normalizeTenantFilter(initialTenant);
    }

    adminAuth.onAuthStateChanged(user => {
        state.requestVersion += 1;
        state.selected = null;
        el.detail.classList.add("hidden");
        el.empty.classList.remove("hidden");
        if (!user) {
            state.tickets = [];
            renderList();
            el.session.textContent =
                "Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.";
            el.refresh.disabled = true;
            el.applyFilter.disabled = true;
            return;
        }
        el.session.textContent = user.email || user.uid;
        void loadTickets();
    });
})();
