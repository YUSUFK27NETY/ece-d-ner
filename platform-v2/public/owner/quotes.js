(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const STATUS_LABELS = Object.freeze({
        new: "Yeni",
        reviewing: "İnceleniyor",
        quoted: "Teklif verildi",
        won: "Kazanıldı",
        lost: "Kaybedildi",
        cancelled: "İptal"
    });
    const TRANSITIONS = Object.freeze({
        new: Object.freeze(["new", "reviewing", "quoted", "cancelled"]),
        reviewing: Object.freeze(["reviewing", "quoted", "cancelled"]),
        quoted: Object.freeze(["quoted", "reviewing", "won", "lost", "cancelled"]),
        won: Object.freeze(["won"]),
        lost: Object.freeze(["lost"]),
        cancelled: Object.freeze(["cancelled"])
    });

    const el = Object.freeze({
        authPanel: document.getElementById("auth-panel"),
        loginForm: document.getElementById("login-form"),
        tenantId: document.getElementById("tenant-id"),
        email: document.getElementById("email"),
        password: document.getElementById("password"),
        authMessage: document.getElementById("auth-message"),
        app: document.getElementById("app"),
        refresh: document.getElementById("refresh"),
        status: document.getElementById("status-filter"),
        listMessage: document.getElementById("list-message"),
        list: document.getElementById("quote-list")
    });
    if (Object.values(el).some(value => value === null) || typeof firebase === "undefined" || !firebase.auth) return;

    const state = { tenantId: "", quotes: [] };

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
        try { return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId")); }
        catch { return ""; }
    }

    function persistTenantId(value) {
        try { window.sessionStorage.setItem("platformOwnerTenantId", value); } catch { /* convenience only */ }
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    function ownerPath(suffix = "") {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/quotes${suffix}`;
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

    function text(tag, value, className = "") {
        const node = document.createElement(tag);
        if (className) node.className = className;
        node.textContent = value;
        return node;
    }

    function formatMoneyMinor(value, currency) {
        if (value === null || !currency) return "Teklif tutarı girilmedi";
        return new Intl.NumberFormat("tr-TR", { style: "currency", currency }).format(value / 100);
    }

    function inputLabel(labelText, input) {
        const label = document.createElement("label");
        label.append(document.createTextNode(labelText), input);
        return label;
    }

    function buildStatusSelect(quote) {
        const select = document.createElement("select");
        for (const status of TRANSITIONS[quote.status] || [quote.status]) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = STATUS_LABELS[status] || status;
            option.selected = status === quote.status;
            select.append(option);
        }
        return select;
    }

    function renderQuote(quote) {
        const card = document.createElement("article");
        card.className = "quote-card";
        const head = document.createElement("div");
        head.className = "quote-card-head";
        const heading = document.createElement("div");
        heading.append(text("h3", quote.companyName), text("p", `${quote.country} · ${quote.quoteId}`, "muted"));
        const pill = text("span", STATUS_LABELS[quote.status] || quote.status, "status-pill");
        head.append(heading, pill);

        const meta = document.createElement("div");
        meta.className = "quote-meta";
        meta.append(
            text("span", new Date(quote.createdAt).toLocaleString("tr-TR")),
            text("span", `${quote.items.length} kalem`),
            text("span", formatMoneyMinor(quote.amountMinor, quote.currency))
        );

        const contact = document.createElement("div");
        contact.className = "quote-contact";
        const contactName = document.createElement("div");
        contactName.append(text("strong", "Yetkili"), text("p", quote.contactName));
        const contactWay = document.createElement("div");
        contactWay.append(text("strong", "İletişim"), text("p", [quote.email, quote.phone].filter(Boolean).join(" · ") || "—"));
        contact.append(contactName, contactWay);

        const items = document.createElement("ul");
        items.className = "quote-items";
        for (const item of quote.items) {
            const suffix = item.unit ? ` ${item.unit}` : "";
            items.append(text("li", `${item.description} — ${item.quantity}${suffix}`));
        }
        if (quote.note) card.append();

        const offer = document.createElement("div");
        offer.className = "offer-grid";
        const status = buildStatusSelect(quote);
        const amount = document.createElement("input");
        amount.type = "number";
        amount.min = "0";
        amount.step = "0.01";
        amount.value = quote.amountMinor === null ? "" : String(quote.amountMinor / 100);
        const currency = document.createElement("input");
        currency.maxLength = 3;
        currency.value = quote.currency || "TRY";
        currency.autocapitalize = "characters";
        const validUntil = document.createElement("input");
        validUntil.type = "date";
        validUntil.value = quote.validUntil || "";
        offer.append(
            inputLabel("Durum", status),
            inputLabel("Tutar", amount),
            inputLabel("Para birimi", currency),
            inputLabel("Geçerlilik", validUntil)
        );

        const messages = document.createElement("div");
        messages.className = "message-grid";
        const customerMessage = document.createElement("textarea");
        customerMessage.rows = 3;
        customerMessage.maxLength = 1200;
        customerMessage.value = quote.customerMessage || "";
        const ownerNote = document.createElement("textarea");
        ownerNote.rows = 3;
        ownerNote.maxLength = 1200;
        ownerNote.value = quote.ownerNote || "";
        messages.append(
            inputLabel("Müşteriye mesaj", customerMessage),
            inputLabel("İç not", ownerNote)
        );

        const actions = document.createElement("div");
        actions.className = "quote-actions";
        const save = document.createElement("button");
        save.type = "button";
        save.className = "primary";
        save.textContent = "Teklifi kaydet";
        const terminal = new Set(["won", "lost", "cancelled"]).has(quote.status);
        if (terminal) {
            save.disabled = true;
            status.disabled = true;
            amount.disabled = true;
            currency.disabled = true;
            validUntil.disabled = true;
            customerMessage.disabled = true;
            ownerNote.disabled = true;
        }
        save.addEventListener("click", async () => {
            const major = amount.value.trim() === "" ? null : Number(amount.value);
            if (major !== null && (!Number.isFinite(major) || major < 0 || !Number.isSafeInteger(Math.round(major * 100)))) {
                message(el.listMessage, "Teklif tutarını kontrol edin.", "error");
                return;
            }
            const amountMinor = major === null ? null : Math.round(major * 100);
            const code = currency.value.trim().toUpperCase();
            if (amountMinor !== null && !/^[A-Z]{3}$/.test(code)) {
                message(el.listMessage, "Para birimi 3 harf olmalı (TRY, USD, EUR gibi).", "error");
                return;
            }
            save.disabled = true;
            try {
                await api(ownerPath(`/${encodeURIComponent(quote.quoteId)}`), {
                    method: "PATCH",
                    body: JSON.stringify({
                        status: status.value,
                        amountMinor,
                        currency: amountMinor === null ? null : code,
                        validUntil: validUntil.value || null,
                        customerMessage: customerMessage.value.trim() || null,
                        ownerNote: ownerNote.value.trim() || null
                    })
                });
                message(el.listMessage, "Teklif güncellendi.", "success");
                await loadQuotes();
            } catch (error) {
                message(el.listMessage, error.message, "error");
                save.disabled = false;
            }
        });
        actions.append(save);

        card.append(head, meta, contact, text("p", quote.note ? `Talep notu: ${quote.note}` : "Talep notu yok.", "muted"), items, offer, messages, actions);
        return card;
    }

    function render() {
        el.list.replaceChildren();
        if (!state.quotes.length) {
            el.list.append(text("p", "Bu filtrede teklif talebi bulunmuyor.", "empty"));
            return;
        }
        for (const quote of state.quotes) el.list.append(renderQuote(quote));
    }

    async function loadQuotes() {
        message(el.listMessage);
        const params = new URLSearchParams();
        if (el.status.value) params.set("status", el.status.value);
        params.set("limit", "100");
        const body = await api(`${ownerPath()}?${params}`);
        state.quotes = Array.isArray(body?.quotes) ? body.quotes : [];
        render();
    }

    async function loadAll() {
        try {
            await loadQuotes();
            el.authPanel.classList.add("hidden");
            el.app.classList.remove("hidden");
        } catch (error) {
            message(el.authMessage, error.message, "error");
            if (error.status === 401 || error.status === 403) {
                el.app.classList.add("hidden");
                el.authPanel.classList.remove("hidden");
            }
        }
    }

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        message(el.authMessage, "Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }
    firebase.initializeApp(firebaseConfig);
    state.tenantId = readTenantId();
    el.tenantId.value = state.tenantId;

    el.loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        const tenantId = normalizeTenantId(el.tenantId.value);
        if (!tenantId) {
            message(el.authMessage, "Geçerli işletme kodu girin.", "error");
            return;
        }
        state.tenantId = tenantId;
        persistTenantId(tenantId);
        try { await firebase.auth().signInWithEmailAndPassword(el.email.value.trim(), el.password.value); }
        catch { message(el.authMessage, "Giriş başarısız.", "error"); }
    });

    el.refresh.addEventListener("click", () => loadQuotes().catch(error => message(el.listMessage, error.message, "error")));
    el.status.addEventListener("change", () => loadQuotes().catch(error => message(el.listMessage, error.message, "error")));

    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.app.classList.add("hidden");
            el.authPanel.classList.remove("hidden");
            return;
        }
        const tenantId = normalizeTenantId(el.tenantId.value) || state.tenantId;
        if (!tenantId) {
            await firebase.auth().signOut();
            message(el.authMessage, "İşletme kodu gerekli.", "error");
            return;
        }
        state.tenantId = tenantId;
        persistTenantId(tenantId);
        await loadAll();
    });
})();
