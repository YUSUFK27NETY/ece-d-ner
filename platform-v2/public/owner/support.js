(() => {
    "use strict";

    const STATUS_LABELS = Object.freeze({
        open: "Açık",
        in_review: "İnceleniyor",
        resolved: "Çözüldü"
    });
    const ROLE_LABELS = Object.freeze({
        tenant_owner: "İşletme sahibi",
        tenant_admin: "İşletme yöneticisi",
        platform_admin: "Platform desteği"
    });

    const el = Object.freeze({
        tenantLabel: document.getElementById("tenant-label"),
        backLink: document.getElementById("back-link"),
        refresh: document.getElementById("refresh-button"),
        authRequired: document.getElementById("auth-required"),
        app: document.getElementById("support-app"),
        form: document.getElementById("ticket-form"),
        subject: document.getElementById("ticket-subject"),
        description: document.getElementById("ticket-description"),
        submit: document.getElementById("ticket-submit"),
        createMessage: document.getElementById("create-message"),
        listMessage: document.getElementById("list-message"),
        statusFilter: document.getElementById("status-filter"),
        list: document.getElementById("ticket-list")
    });

    if (Object.values(el).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth ||
        typeof window.OWNER_SESSION_RESOLVER?.resolve !== "function") {
        return;
    }

    const state = {
        tenantId: "",
        tickets: [],
        busy: false,
        requestVersion: 0
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

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    function ownerPath(suffix = "") {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/support/tickets${suffix}`;
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
            ticket.tenantId !== state.tenantId ||
            typeof ticket.subject !== "string" ||
            typeof ticket.description !== "string" ||
            !Object.hasOwn(STATUS_LABELS, ticket.status) ||
            !Array.isArray(ticket.history)) {
            throw new Error("Destek talebi yanıtı doğrulanamadı.");
        }
        return ticket;
    }

    function historyRow(entry) {
        const row = document.createElement("div");
        row.className = "ticket-history-row";
        const date = document.createElement("span");
        date.textContent = formatDate(entry.createdAt);
        const detail = document.createElement("strong");
        detail.textContent = `${STATUS_LABELS[entry.status] || entry.status} · ${ROLE_LABELS[entry.actorRole] || "Kullanıcı"}`;
        row.append(date, detail);
        if (entry.note) {
            const note = document.createElement("div");
            note.className = "ticket-history-note";
            note.textContent = entry.note;
            row.append(note);
        }
        return row;
    }

    function ticketCard(ticket) {
        const card = document.createElement("article");
        card.className = "ticket-card";

        const head = document.createElement("div");
        head.className = "ticket-card-head";
        const copy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = ticket.subject;
        const meta = document.createElement("div");
        meta.className = "ticket-meta";
        meta.textContent = `Açıldı: ${formatDate(ticket.createdAt)} · Son güncelleme: ${formatDate(ticket.updatedAt)}`;
        copy.append(title, meta);
        const badge = document.createElement("span");
        badge.className = `ticket-status ${ticket.status}`;
        badge.textContent = STATUS_LABELS[ticket.status];
        head.append(copy, badge);

        const description = document.createElement("p");
        description.textContent = ticket.description;

        const history = document.createElement("div");
        history.className = "ticket-history";
        for (const entry of ticket.history) history.append(historyRow(entry));

        card.append(head, description, history);
        return card;
    }

    function renderTickets() {
        el.list.replaceChildren();
        const filter = el.statusFilter.value;
        const tickets = state.tickets.filter(ticket =>
            filter === "all" || ticket.status === filter
        );
        if (!tickets.length) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = state.tickets.length
                ? "Bu durumda destek talebi yok."
                : "Henüz destek talebiniz yok.";
            el.list.append(empty);
            return;
        }
        for (const ticket of tickets) el.list.append(ticketCard(ticket));
    }

    async function loadTickets() {
        if (!state.tenantId) return;
        const version = ++state.requestVersion;
        el.refresh.disabled = true;
        setMessage(el.listMessage, "Destek talepleri yükleniyor...");
        try {
            const [overview, body] = await Promise.all([
                apiRequest(`/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/overview`),
                apiRequest(ownerPath("?limit=100"))
            ]);
            if (version !== state.requestVersion) return;
            if (overview?.tenant?.tenantId !== state.tenantId ||
                overview?.session?.tenantId !== state.tenantId) {
                throw new Error("İşletme oturumu doğrulanamadı.");
            }
            el.tenantLabel.textContent =
                overview.tenant.profile?.brandName ||
                overview.tenant.displayName ||
                state.tenantId;
            state.tickets = Array.isArray(body?.tickets)
                ? body.tickets.map(requireTicket)
                : [];
            setMessage(el.listMessage);
            renderTickets();
        } catch (error) {
            if (version !== state.requestVersion) return;
            state.tickets = [];
            renderTickets();
            setMessage(el.listMessage, error.message, "error");
        } finally {
            if (version === state.requestVersion) el.refresh.disabled = false;
        }
    }

    async function createTicket(event) {
        event.preventDefault();
        if (state.busy || !state.tenantId) return;
        const subject = el.subject.value.trim();
        const description = el.description.value.trim();
        if (subject.length < 3 || description.length < 5) {
            setMessage(el.createMessage, "Konu ve açıklamayı tamamlayın.", "error");
            return;
        }

        state.busy = true;
        el.submit.disabled = true;
        setMessage(el.createMessage, "Destek talebi oluşturuluyor...");
        try {
            await apiRequest(ownerPath(), {
                method: "POST",
                body: JSON.stringify({ subject, description })
            });
            el.form.reset();
            setMessage(el.createMessage, "Destek talebi oluşturuldu.", "success");
            await loadTickets();
        } catch (error) {
            setMessage(el.createMessage, error.message, "error");
        } finally {
            state.busy = false;
            el.submit.disabled = false;
        }
    }

    el.form.addEventListener("submit", createTicket);
    el.refresh.addEventListener("click", loadTickets);
    el.statusFilter.addEventListener("change", renderTickets);

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage(el.listMessage, "Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }

    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        state.requestVersion += 1;
        if (!user) {
            state.tenantId = "";
            state.tickets = [];
            el.app.classList.add("hidden");
            el.authRequired.classList.remove("hidden");
            return;
        }
        try {
            const session = await window.OWNER_SESSION_RESOLVER.resolve(user);
            state.tenantId = session.tenantId;
            el.backLink.href =
                `/owner/panel.html?tenant=${encodeURIComponent(state.tenantId)}`;
            el.authRequired.classList.add("hidden");
            el.app.classList.remove("hidden");
            await loadTickets();
        } catch (error) {
            state.tenantId = "";
            el.app.classList.add("hidden");
            el.authRequired.classList.remove("hidden");
            setMessage(el.listMessage, error.message, "error");
        }
    });
})();
