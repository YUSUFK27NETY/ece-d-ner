(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const ORDER_TRANSITIONS = Object.freeze({
        pending: Object.freeze(["preparing", "cancelled"]),
        preparing: Object.freeze(["ready", "cancelled"]),
        ready: Object.freeze(["completed", "cancelled"]),
        completed: Object.freeze([]),
        cancelled: Object.freeze([])
    });
    const STATUS_LABELS = Object.freeze({
        pending: "Bekliyor",
        preparing: "Hazırlanıyor",
        ready: "Hazır",
        completed: "Tamamlandı",
        cancelled: "İptal"
    });
    const FULFILLMENT_LABELS = Object.freeze({
        dine_in: "Masa",
        takeaway: "Paket",
        pickup: "Gel-Al",
        delivery: "Teslimat"
    });

    const el = Object.freeze({
        tenantLabel: document.getElementById("tenant-label"),
        backLink: document.getElementById("back-link"),
        loginLink: document.getElementById("login-link"),
        refresh: document.getElementById("refresh-button"),
        authRequired: document.getElementById("auth-required"),
        app: document.getElementById("orders-app"),
        message: document.getElementById("message"),
        statusFilter: document.getElementById("status-filter"),
        fulfillmentFilter: document.getElementById("fulfillment-filter"),
        orderList: document.getElementById("order-list"),
        statTotal: document.getElementById("stat-total"),
        statPending: document.getElementById("stat-pending"),
        statPreparing: document.getElementById("stat-preparing"),
        statReady: document.getElementById("stat-ready"),
        modal: document.getElementById("order-modal"),
        modalTitle: document.getElementById("order-modal-title"),
        modalClose: document.getElementById("order-close"),
        detail: document.getElementById("order-detail"),
        toast: document.getElementById("toast")
    });

    if (Object.values(el).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth) {
        return;
    }

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const state = {
        tenantId: "",
        orders: [],
        busyOrderId: "",
        ordersEnabled: false,
        selectedOrderId: ""
    };

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return tenantId.length >= 3 && TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
    }

    function initialTenantId() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeTenantId(params.get("tenant"));
        if (fromUrl) return fromUrl;
        try {
            return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId"));
        } catch {
            return "";
        }
    }

    function setMessage(text = "", type = "") {
        el.message.textContent = text;
        el.message.className = "message";
        if (type) el.message.classList.add(type);
    }

    function showToast(text) {
        el.toast.textContent = text;
        el.toast.classList.add("show");
        window.setTimeout(() => el.toast.classList.remove("show"), 2200);
    }

    function formatMoney(value) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "—";
        return `${amount.toLocaleString("tr-TR", {
            minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
            maximumFractionDigits: 2
        })} ₺`;
    }

    function formatDate(value) {
        const timestamp = Date.parse(String(value || ""));
        if (Number.isNaN(timestamp)) return "—";
        return new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(new Date(timestamp));
    }

    function ownerPath(suffix) {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner${suffix}`;
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    async function jsonRequest(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${await token()}`);
        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        if (!response.ok) {
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function fulfillmentText(order) {
        const type = order?.fulfillment?.type;
        const label = FULFILLMENT_LABELS[type] || "Sipariş";
        if (type === "dine_in") {
            return `${label} ${order.fulfillment?.tableNumber || "—"}`;
        }
        return label;
    }

    function statusSelect(order) {
        const select = document.createElement("select");
        select.className = "status-select";
        select.setAttribute("aria-label", "Sipariş durumu");
        const current = document.createElement("option");
        current.value = order.status;
        current.textContent = STATUS_LABELS[order.status] || order.status;
        select.append(current);
        for (const status of ORDER_TRANSITIONS[order.status] || []) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = STATUS_LABELS[status] || status;
            select.append(option);
        }
        select.disabled = state.busyOrderId === order.orderId ||
            (ORDER_TRANSITIONS[order.status] || []).length === 0;
        return select;
    }

    function actionButton(label, className = "secondary compact") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        return button;
    }

    function visibleOrders() {
        const status = el.statusFilter.value;
        const fulfillment = el.fulfillmentFilter.value;
        return state.orders.filter(order =>
            (status === "all" || order.status === status) &&
            (fulfillment === "all" || order.fulfillment?.type === fulfillment)
        );
    }

    function renderStats() {
        el.statTotal.textContent = String(state.orders.length);
        el.statPending.textContent = String(state.orders.filter(order => order.status === "pending").length);
        el.statPreparing.textContent = String(state.orders.filter(order => order.status === "preparing").length);
        el.statReady.textContent = String(state.orders.filter(order => order.status === "ready").length);
    }

    function orderCard(order) {
        const card = document.createElement("article");
        card.className = "order-card";

        const head = document.createElement("div");
        head.className = "order-card-head";
        const copy = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = order.customer?.name || "Müşteri";
        const meta = document.createElement("div");
        meta.className = "order-meta";
        meta.textContent = `${STATUS_LABELS[order.status] || order.status} • ${fulfillmentText(order)} • ${formatDate(order.createdAt)}`;
        const note = document.createElement("p");
        note.textContent = order.note || "Sipariş notu yok.";
        copy.append(title, meta, note);
        const total = document.createElement("strong");
        total.className = "order-total";
        total.textContent = formatMoney(order.total);
        head.append(copy, total);

        const actions = document.createElement("div");
        actions.className = "order-actions";
        const detail = actionButton("Detay", "secondary compact");
        detail.addEventListener("click", () => openDetail(order));
        const select = statusSelect(order);
        const apply = actionButton(
            state.busyOrderId === order.orderId ? "Güncelleniyor..." : "Durumu güncelle",
            "primary compact"
        );
        apply.disabled = select.disabled;
        apply.addEventListener("click", () => updateStatus(order, select.value));
        actions.append(detail, select, apply);

        card.append(head, actions);
        return card;
    }

    function renderOrders() {
        el.orderList.replaceChildren();
        renderStats();
        if (!state.ordersEnabled) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "Sipariş modülü bu işletmede aktif değil.";
            el.orderList.append(empty);
            return;
        }
        const orders = visibleOrders();
        if (!orders.length) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = state.orders.length
                ? "Seçilen filtrelerde sipariş bulunamadı."
                : "Henüz sipariş yok.";
            el.orderList.append(empty);
            return;
        }
        for (const order of orders) {
            el.orderList.append(orderCard(order));
        }
    }

    function detailRow(label, value) {
        const row = document.createElement("div");
        row.className = "detail-row";
        const key = document.createElement("span");
        key.textContent = label;
        const text = document.createElement("strong");
        text.textContent = value || "—";
        row.append(key, text);
        return row;
    }

    function detailItems(order) {
        const section = document.createElement("section");
        section.className = "detail-section";
        const title = document.createElement("h3");
        title.textContent = "Ürünler";
        const list = document.createElement("div");
        list.className = "detail-items";
        for (const item of Array.isArray(order.items) ? order.items : []) {
            const row = document.createElement("div");
            row.className = "detail-item";
            const name = document.createElement("span");
            name.textContent = `${item.quantity} × ${item.name}`;
            const price = document.createElement("strong");
            price.textContent = formatMoney(item.lineTotal);
            row.append(name, price);
            list.append(row);
        }
        section.append(title, list);
        return section;
    }

    function openDetail(order) {
        state.selectedOrderId = order.orderId;
        el.modalTitle.textContent = order.customer?.name || "Sipariş";
        el.detail.replaceChildren();

        const info = document.createElement("section");
        info.className = "detail-section detail-grid";
        info.append(
            detailRow("Sipariş no", order.orderId),
            detailRow("Durum", STATUS_LABELS[order.status] || order.status),
            detailRow("Sipariş tipi", fulfillmentText(order)),
            detailRow("Müşteri", order.customer?.name),
            detailRow("Telefon", order.customer?.phone),
            detailRow("Tarih", formatDate(order.createdAt))
        );
        if (order.fulfillment?.type === "delivery") {
            info.append(detailRow("Teslimat adresi", order.fulfillment?.address));
        }
        if (order.fulfillment?.type === "dine_in") {
            info.append(detailRow("Masa", order.fulfillment?.tableNumber));
        }
        if (order.note) info.append(detailRow("Not", order.note));

        const total = document.createElement("div");
        total.className = "detail-total";
        const totalLabel = document.createElement("span");
        totalLabel.textContent = "Toplam";
        const totalValue = document.createElement("strong");
        totalValue.textContent = formatMoney(order.total);
        total.append(totalLabel, totalValue);

        el.detail.append(info, detailItems(order), total);
        el.modal.classList.remove("hidden");
    }

    function closeDetail() {
        state.selectedOrderId = "";
        el.modal.classList.add("hidden");
        el.detail.replaceChildren();
    }

    async function updateStatus(order, status) {
        if (status === order.status) return;
        if (!(ORDER_TRANSITIONS[order.status] || []).includes(status)) {
            setMessage("Geçersiz sipariş durum geçişi.", "error");
            return;
        }
        state.busyOrderId = order.orderId;
        renderOrders();
        try {
            await jsonRequest(ownerPath(`/orders/${encodeURIComponent(order.orderId)}/status`), {
                method: "PATCH",
                body: JSON.stringify({ status })
            });
            closeDetail();
            showToast("Sipariş durumu güncellendi.");
            await loadOrders();
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            state.busyOrderId = "";
            renderOrders();
        }
    }

    async function loadOrders() {
        if (!state.tenantId) {
            setMessage("Geçerli işletme kodu bulunamadı.", "error");
            return;
        }
        el.refresh.disabled = true;
        setMessage("Siparişler yükleniyor...");
        try {
            const overview = await jsonRequest(ownerPath("/overview"));
            const tenant = overview?.tenant;
            const session = overview?.session;
            if (!tenant || tenant.tenantId !== state.tenantId ||
                !session || session.tenantId !== state.tenantId) {
                throw new Error("İşletme oturumu doğrulanamadı.");
            }
            el.tenantLabel.textContent = tenant.profile?.brandName || tenant.displayName || tenant.tenantId;
            state.ordersEnabled = tenant.features?.orders === true;
            if (!state.ordersEnabled) {
                state.orders = [];
                setMessage();
                renderOrders();
                return;
            }
            const body = await jsonRequest(ownerPath("/orders?limit=200"));
            state.orders = Array.isArray(body?.orders) ? body.orders : [];
            setMessage();
            renderOrders();
        } catch (error) {
            state.orders = [];
            renderOrders();
            setMessage(error.message, "error");
        } finally {
            el.refresh.disabled = false;
        }
    }

    const firebaseConfig = bootstrap.firebase;
    state.tenantId = initialTenantId();
    const tenantQuery = state.tenantId ? `?tenant=${encodeURIComponent(state.tenantId)}` : "";
    el.backLink.href = `/owner/${tenantQuery}`;
    el.loginLink.href = `/owner/${tenantQuery}`;

    el.refresh.addEventListener("click", loadOrders);
    el.statusFilter.addEventListener("change", renderOrders);
    el.fulfillmentFilter.addEventListener("change", renderOrders);
    el.modalClose.addEventListener("click", closeDetail);
    el.modal.addEventListener("click", event => {
        if (event.target === el.modal) closeDetail();
    });

    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage("Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }

    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.authRequired.classList.remove("hidden");
            el.app.classList.add("hidden");
            return;
        }
        el.authRequired.classList.add("hidden");
        el.app.classList.remove("hidden");
        await loadOrders();
    });
})();
