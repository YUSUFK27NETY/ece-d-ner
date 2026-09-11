(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const FEATURE_LABELS = Object.freeze({
        catalog: "Katalog",
        orders: "Sipariş",
        appointments: "Randevu",
        reservations: "Rezervasyon",
        whatsapp: "WhatsApp",
        inventory: "Stok",
        quotes: "Teklif",
        fleet: "Filo",
        gallery: "Galeri"
    });
    const ORDER_TRANSITIONS = Object.freeze({
        pending: Object.freeze(["preparing", "cancelled"]),
        preparing: Object.freeze(["ready", "cancelled"]),
        ready: Object.freeze(["completed", "cancelled"]),
        completed: Object.freeze([]),
        cancelled: Object.freeze([])
    });
    const ORDER_STATUS_LABELS = Object.freeze({
        pending: "Bekliyor",
        preparing: "Hazırlanıyor",
        ready: "Hazır",
        completed: "Tamamlandı",
        cancelled: "İptal"
    });

    const elements = {
        loginView: document.getElementById("login-view"),
        appView: document.getElementById("app-view"),
        loginForm: document.getElementById("login-form"),
        tenantId: document.getElementById("tenant-id"),
        email: document.getElementById("email"),
        password: document.getElementById("password"),
        loginMessage: document.getElementById("login-message"),
        businessTitle: document.getElementById("business-title"),
        businessMeta: document.getElementById("business-meta"),
        roleBadge: document.getElementById("role-badge"),
        refreshButton: document.getElementById("refresh-button"),
        logoutButton: document.getElementById("logout-button"),
        tabs: [...document.querySelectorAll(".tab[data-view]")],
        views: {
            dashboard: document.getElementById("dashboard-view"),
            products: document.getElementById("products-view"),
            orders: document.getElementById("orders-view")
        },
        statStatus: document.getElementById("stat-status"),
        statSector: document.getElementById("stat-sector"),
        statProducts: document.getElementById("stat-products"),
        statOrders: document.getElementById("stat-orders"),
        featureList: document.getElementById("feature-list"),
        newProductButton: document.getElementById("new-product-button"),
        productList: document.getElementById("product-list"),
        productsMessage: document.getElementById("products-message"),
        ordersRefresh: document.getElementById("orders-refresh"),
        orderList: document.getElementById("order-list"),
        ordersMessage: document.getElementById("orders-message"),
        productModal: document.getElementById("product-modal"),
        productForm: document.getElementById("product-form"),
        productModalTitle: document.getElementById("product-modal-title"),
        productClose: document.getElementById("product-close"),
        productId: document.getElementById("product-id"),
        productName: document.getElementById("product-name"),
        productCategory: document.getElementById("product-category"),
        productPrice: document.getElementById("product-price"),
        productDescription: document.getElementById("product-description"),
        productAvailable: document.getElementById("product-available"),
        productFormMessage: document.getElementById("product-form-message"),
        toast: document.getElementById("toast")
    };

    if (Object.values(elements).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth) {
        return;
    }

    const state = {
        tenantId: "",
        tenant: null,
        products: [],
        orders: [],
        activeView: "dashboard",
        loading: false
    };

    function setMessage(element, text = "", type = "") {
        element.textContent = text;
        element.className = "message";
        if (type) element.classList.add(type);
    }

    function showToast(text) {
        elements.toast.textContent = text;
        elements.toast.classList.add("show");
        window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
    }

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return TENANT_ID_PATTERN.test(tenantId) && tenantId.length >= 3
            ? tenantId
            : "";
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

    function setBusy(busy) {
        state.loading = busy;
        elements.refreshButton.disabled = busy;
        elements.ordersRefresh.disabled = busy;
        elements.newProductButton.disabled = busy || state.tenant?.features?.catalog !== true;
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    async function apiRequest(path, options = {}) {
        const token = await getIdToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);
        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }

        const response = await fetch(path, {
            ...options,
            headers
        });
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

    function ownerPath(suffix) {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner${suffix}`;
    }

    function setView(name) {
        if (!(name in elements.views)) return;
        state.activeView = name;
        for (const [key, view] of Object.entries(elements.views)) {
            view.classList.toggle("active", key === name);
        }
        for (const tab of elements.tabs) {
            tab.classList.toggle("active", tab.dataset.view === name);
        }
    }

    function showLogin() {
        elements.appView.classList.add("hidden");
        elements.loginView.classList.remove("hidden");
    }

    function showApp() {
        elements.loginView.classList.add("hidden");
        elements.appView.classList.remove("hidden");
    }

    function resetBusinessState() {
        state.tenant = null;
        state.products = [];
        state.orders = [];
        elements.businessTitle.textContent = "İşletme";
        elements.businessMeta.textContent = "";
        elements.roleBadge.textContent = "";
        elements.statStatus.textContent = "—";
        elements.statSector.textContent = "—";
        elements.statProducts.textContent = "—";
        elements.statOrders.textContent = "—";
        elements.featureList.replaceChildren();
        elements.productList.replaceChildren();
        elements.orderList.replaceChildren();
    }

    function renderFeatureList() {
        elements.featureList.replaceChildren();
        const features = state.tenant?.features || {};
        for (const [key, label] of Object.entries(FEATURE_LABELS)) {
            const chip = document.createElement("span");
            chip.className = "chip";
            if (features[key] !== true) chip.classList.add("off");
            chip.textContent = `${features[key] === true ? "✓" : "–"} ${label}`;
            elements.featureList.append(chip);
        }
    }

    function renderOverview(body) {
        const tenant = body?.tenant;
        const session = body?.session;
        if (!tenant || tenant.tenantId !== state.tenantId || !session ||
            session.tenantId !== state.tenantId) {
            throw new Error("İşletme oturumu doğrulanamadı.");
        }

        state.tenant = tenant;
        elements.businessTitle.textContent = tenant.profile?.brandName || tenant.displayName || tenant.tenantId;
        elements.businessMeta.textContent = `${tenant.tenantId} • ${tenant.sector} • ${tenant.plan}`;
        elements.roleBadge.textContent = session.role === "tenant_owner" ? "Owner" : "Yönetici";
        elements.statStatus.textContent = tenant.status;
        elements.statSector.textContent = tenant.sector;
        elements.newProductButton.disabled = tenant.features?.catalog !== true;
        elements.ordersRefresh.disabled = tenant.features?.orders !== true;
        renderFeatureList();
    }

    function emptyCard(text) {
        const element = document.createElement("div");
        element.className = "empty";
        element.textContent = text;
        return element;
    }

    function productActionButton(text, handler, danger = false) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "small-button";
        if (danger) button.classList.add("danger");
        button.textContent = text;
        button.addEventListener("click", handler);
        return button;
    }

    function renderProducts() {
        elements.productList.replaceChildren();
        elements.statProducts.textContent = String(state.products.length);

        if (state.tenant?.features?.catalog !== true) {
            elements.productList.append(emptyCard("Katalog modülü bu işletmede aktif değil."));
            return;
        }
        if (state.products.length === 0) {
            elements.productList.append(emptyCard("Henüz ürün veya hizmet eklenmemiş."));
            return;
        }

        for (const product of state.products) {
            const card = document.createElement("article");
            card.className = "item-card";
            const head = document.createElement("div");
            head.className = "item-card-head";
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = product.name;
            const description = document.createElement("p");
            description.textContent = product.description || "Açıklama yok.";
            const meta = document.createElement("div");
            meta.className = "item-meta";
            meta.textContent = `${product.category} • ${product.available ? "Satışta" : "Kapalı"}`;
            copy.append(title, description, meta);
            const price = document.createElement("div");
            price.className = "price";
            price.textContent = formatMoney(product.price);
            head.append(copy, price);

            const actions = document.createElement("div");
            actions.className = "item-actions";
            actions.append(
                productActionButton("Düzenle", () => openProductModal(product)),
                productActionButton(
                    product.available ? "Satıştan kaldır" : "Satışa aç",
                    () => updateProductAvailability(product, !product.available)
                ),
                productActionButton("Arşivle", () => archiveProduct(product), true)
            );
            card.append(head, actions);
            elements.productList.append(card);
        }
    }

    async function loadProducts() {
        setMessage(elements.productsMessage);
        if (state.tenant?.features?.catalog !== true) {
            state.products = [];
            renderProducts();
            return;
        }
        try {
            const body = await apiRequest(ownerPath("/catalog/products?limit=200"));
            state.products = Array.isArray(body?.products) ? body.products : [];
            renderProducts();
        } catch (error) {
            state.products = [];
            renderProducts();
            setMessage(elements.productsMessage, error.message, "error");
        }
    }

    function orderStatusSelect(order) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Sipariş durumu");
        const current = document.createElement("option");
        current.value = order.status;
        current.textContent = ORDER_STATUS_LABELS[order.status] || order.status;
        select.append(current);
        for (const status of ORDER_TRANSITIONS[order.status] || []) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = ORDER_STATUS_LABELS[status] || status;
            select.append(option);
        }
        select.disabled = (ORDER_TRANSITIONS[order.status] || []).length === 0;
        return select;
    }

    function renderOrders() {
        elements.orderList.replaceChildren();
        elements.statOrders.textContent = String(state.orders.length);

        if (state.tenant?.features?.orders !== true) {
            elements.orderList.append(emptyCard("Sipariş modülü bu işletmede aktif değil."));
            return;
        }
        if (state.orders.length === 0) {
            elements.orderList.append(emptyCard("Henüz sipariş yok."));
            return;
        }

        for (const order of state.orders) {
            const card = document.createElement("article");
            card.className = "item-card";
            const head = document.createElement("div");
            head.className = "item-card-head";
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = order.customer?.name || "Müşteri";
            const meta = document.createElement("div");
            meta.className = "item-meta";
            const fulfillment = order.fulfillment?.type === "dine_in"
                ? `Masa ${order.fulfillment?.tableNumber || "—"}`
                : "Teslimat";
            meta.textContent = `${ORDER_STATUS_LABELS[order.status] || order.status} • ${fulfillment} • ${formatDate(order.createdAt)}`;
            const note = document.createElement("p");
            note.textContent = order.note || "Sipariş notu yok.";
            copy.append(title, meta, note);
            const price = document.createElement("div");
            price.className = "price";
            price.textContent = formatMoney(order.total);
            head.append(copy, price);

            const grid = document.createElement("div");
            grid.className = "order-grid";
            const statusLabel = document.createElement("label");
            statusLabel.textContent = "Durum";
            const select = orderStatusSelect(order);
            statusLabel.append(select);
            const apply = document.createElement("button");
            apply.type = "button";
            apply.className = "primary compact";
            apply.textContent = "Durumu güncelle";
            apply.disabled = select.disabled;
            apply.addEventListener("click", () => updateOrderStatus(order, select.value));
            grid.append(statusLabel, apply);
            card.append(head, grid);
            elements.orderList.append(card);
        }
    }

    async function loadOrders() {
        setMessage(elements.ordersMessage);
        if (state.tenant?.features?.orders !== true) {
            state.orders = [];
            renderOrders();
            return;
        }
        try {
            const body = await apiRequest(ownerPath("/orders?limit=200"));
            state.orders = Array.isArray(body?.orders) ? body.orders : [];
            renderOrders();
        } catch (error) {
            state.orders = [];
            renderOrders();
            setMessage(elements.ordersMessage, error.message, "error");
        }
    }

    async function loadBusiness() {
        if (!state.tenantId) return;
        setBusy(true);
        try {
            const body = await apiRequest(ownerPath("/overview"));
            renderOverview(body);
            showApp();
            await Promise.all([loadProducts(), loadOrders()]);
        } catch (error) {
            resetBusinessState();
            if (error.status === 401 || error.status === 403 || error.status === 404) {
                setMessage(
                    elements.loginMessage,
                    "Bu hesap bu işletmeye bağlı değil veya yetkili değil.",
                    "error"
                );
                showLogin();
                return;
            }
            setMessage(elements.loginMessage, error.message, "error");
            showLogin();
        } finally {
            setBusy(false);
        }
    }

    function openProductModal(product = null) {
        if (state.tenant?.features?.catalog !== true) return;
        setMessage(elements.productFormMessage);
        elements.productForm.reset();
        elements.productAvailable.checked = true;
        if (product) {
            elements.productModalTitle.textContent = "Ürünü düzenle";
            elements.productId.value = product.productId;
            elements.productName.value = product.name;
            elements.productCategory.value = product.category;
            elements.productPrice.value = String(product.price);
            elements.productDescription.value = product.description || "";
            elements.productAvailable.checked = product.available === true;
        } else {
            elements.productModalTitle.textContent = "Yeni ürün";
            elements.productId.value = "";
        }
        elements.productModal.classList.remove("hidden");
    }

    function closeProductModal() {
        elements.productModal.classList.add("hidden");
        setMessage(elements.productFormMessage);
    }

    function productDraftFromForm() {
        const price = Number(elements.productPrice.value);
        if (!Number.isFinite(price) || price <= 0) {
            throw new Error("Geçerli bir fiyat girin.");
        }
        return {
            name: elements.productName.value.trim(),
            category: elements.productCategory.value.trim(),
            price,
            description: elements.productDescription.value.trim(),
            available: elements.productAvailable.checked
        };
    }

    async function saveProduct(event) {
        event.preventDefault();
        setMessage(elements.productFormMessage);
        try {
            const draft = productDraftFromForm();
            const productId = elements.productId.value;
            if (productId) {
                await apiRequest(ownerPath(`/catalog/products/${encodeURIComponent(productId)}`), {
                    method: "PATCH",
                    body: JSON.stringify(draft)
                });
                showToast("Ürün güncellendi.");
            } else {
                await apiRequest(ownerPath("/catalog/products"), {
                    method: "POST",
                    body: JSON.stringify(draft)
                });
                showToast("Ürün eklendi.");
            }
            closeProductModal();
            await loadProducts();
        } catch (error) {
            setMessage(elements.productFormMessage, error.message, "error");
        }
    }

    async function updateProductAvailability(product, available) {
        try {
            await apiRequest(ownerPath(`/catalog/products/${encodeURIComponent(product.productId)}`), {
                method: "PATCH",
                body: JSON.stringify({ available })
            });
            showToast(available ? "Ürün satışa açıldı." : "Ürün satıştan kaldırıldı.");
            await loadProducts();
        } catch (error) {
            setMessage(elements.productsMessage, error.message, "error");
        }
    }

    async function archiveProduct(product) {
        if (!window.confirm(`${product.name} arşivlensin mi?`)) return;
        try {
            await apiRequest(ownerPath(`/catalog/products/${encodeURIComponent(product.productId)}/archive`), {
                method: "POST"
            });
            showToast("Ürün arşivlendi.");
            await loadProducts();
        } catch (error) {
            setMessage(elements.productsMessage, error.message, "error");
        }
    }

    async function updateOrderStatus(order, status) {
        if (status === order.status) return;
        if (!(ORDER_TRANSITIONS[order.status] || []).includes(status)) {
            setMessage(elements.ordersMessage, "Geçersiz sipariş durum geçişi.", "error");
            return;
        }
        try {
            await apiRequest(ownerPath(`/orders/${encodeURIComponent(order.orderId)}/status`), {
                method: "PATCH",
                body: JSON.stringify({ status })
            });
            showToast("Sipariş durumu güncellendi.");
            await loadOrders();
        } catch (error) {
            setMessage(elements.ordersMessage, error.message, "error");
        }
    }

    function readInitialTenantId() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeTenantId(params.get("tenant"));
        if (fromUrl) return fromUrl;
        try {
            return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId"));
        } catch {
            return "";
        }
    }

    function persistTenantId(tenantId) {
        try {
            window.sessionStorage.setItem("platformOwnerTenantId", tenantId);
        } catch {
            // Session storage is optional convenience only.
        }
    }

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage(elements.loginMessage, "Firebase bağlantısı yapılandırılmamış.", "error");
        elements.loginForm.querySelector("button[type=submit]").disabled = true;
        return;
    }

    state.tenantId = readInitialTenantId();
    elements.tenantId.value = state.tenantId;
    firebase.initializeApp(firebaseConfig);

    elements.loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage(elements.loginMessage);
        const tenantId = normalizeTenantId(elements.tenantId.value);
        if (!tenantId) {
            setMessage(elements.loginMessage, "Geçerli işletme kodu girin.", "error");
            return;
        }
        state.tenantId = tenantId;
        persistTenantId(tenantId);
        try {
            await firebase.auth().signInWithEmailAndPassword(
                elements.email.value.trim(),
                elements.password.value
            );
        } catch {
            setMessage(elements.loginMessage, "Giriş başarısız. Bilgileri kontrol edin.", "error");
        }
    });

    elements.logoutButton.addEventListener("click", () => firebase.auth().signOut());
    elements.refreshButton.addEventListener("click", loadBusiness);
    elements.ordersRefresh.addEventListener("click", loadOrders);
    elements.newProductButton.addEventListener("click", () => openProductModal());
    elements.productClose.addEventListener("click", closeProductModal);
    elements.productForm.addEventListener("submit", saveProduct);
    elements.productModal.addEventListener("click", event => {
        if (event.target === elements.productModal) closeProductModal();
    });
    for (const tab of elements.tabs) {
        tab.addEventListener("click", () => setView(tab.dataset.view));
    }

    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            resetBusinessState();
            showLogin();
            return;
        }
        const tenantId = normalizeTenantId(elements.tenantId.value) || state.tenantId;
        if (!tenantId) {
            await firebase.auth().signOut();
            setMessage(elements.loginMessage, "İşletme kodu gerekli.", "error");
            return;
        }
        state.tenantId = tenantId;
        persistTenantId(tenantId);
        await loadBusiness();
    });
})();
