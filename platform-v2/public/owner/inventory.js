(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const statusLabels = Object.freeze({
        untracked: "Takipsiz",
        in_stock: "Stokta",
        low_stock: "Düşük stok",
        out_of_stock: "Tükendi"
    });

    const el = Object.freeze({
        authPanel: document.getElementById("auth-panel"),
        loginForm: document.getElementById("login-form"),
        tenantId: document.getElementById("tenant-id"),
        email: document.getElementById("email"),
        password: document.getElementById("password"),
        authMessage: document.getElementById("auth-message"),
        app: document.getElementById("app"),
        delivery: document.getElementById("delivery-enabled"),
        pickup: document.getElementById("pickup-enabled"),
        takeaway: document.getElementById("takeaway-enabled"),
        dineIn: document.getElementById("dinein-enabled"),
        saveFulfillment: document.getElementById("save-fulfillment"),
        fulfillmentMessage: document.getElementById("fulfillment-message"),
        refresh: document.getElementById("refresh"),
        inventoryMessage: document.getElementById("inventory-message"),
        inventoryList: document.getElementById("inventory-list")
    });

    if (Object.values(el).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth) return;

    const state = { tenantId: "", inventory: [] };

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
        try {
            return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId"));
        } catch {
            return "";
        }
    }

    function persistTenantId(value) {
        try {
            window.sessionStorage.setItem("platformOwnerTenantId", value);
        } catch {
            // Tenant id convenience only; credentials are never stored.
        }
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    function ownerPath(suffix) {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner${suffix}`;
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

    function renderInventory() {
        el.inventoryList.replaceChildren();
        if (!state.inventory.length) {
            const empty = document.createElement("p");
            empty.className = "muted";
            empty.textContent = "Stok yönetilecek ürün bulunamadı.";
            el.inventoryList.append(empty);
            return;
        }

        for (const item of state.inventory) {
            const card = document.createElement("article");
            card.className = "stock-card";
            const main = document.createElement("div");
            main.className = "stock-main";
            const title = document.createElement("h3");
            title.textContent = item.productName;
            const meta = document.createElement("div");
            meta.className = "stock-meta";
            const status = document.createElement("span");
            status.className = `status ${item.status}`;
            status.textContent = statusLabels[item.status] || item.status;
            meta.append(status);
            main.append(title, meta);

            const controls = document.createElement("div");
            controls.className = "stock-controls";
            const trackLabel = document.createElement("label");
            const track = document.createElement("input");
            track.type = "checkbox";
            track.checked = item.trackingEnabled === true;
            trackLabel.append(track, document.createTextNode(" Takip"));

            const qtyLabel = document.createElement("label");
            qtyLabel.textContent = "Adet";
            const qty = document.createElement("input");
            qty.type = "number";
            qty.min = "0";
            qty.max = "1000000";
            qty.step = "1";
            qty.value = String(item.quantity);
            qtyLabel.append(qty);

            const lowLabel = document.createElement("label");
            lowLabel.textContent = "Düşük stok";
            const low = document.createElement("input");
            low.type = "number";
            low.min = "0";
            low.max = "1000000";
            low.step = "1";
            low.value = String(item.lowStockThreshold);
            lowLabel.append(low);

            const save = document.createElement("button");
            save.type = "button";
            save.className = "primary";
            save.textContent = "Stoku kaydet";
            save.addEventListener("click", async () => {
                const quantity = Number(qty.value);
                const lowStockThreshold = Number(low.value);
                if (!Number.isInteger(quantity) || quantity < 0 ||
                    !Number.isInteger(lowStockThreshold) || lowStockThreshold < 0) {
                    message(el.inventoryMessage, "Stok adetleri negatif olmayan tam sayı olmalı.", "error");
                    return;
                }
                save.disabled = true;
                try {
                    await api(ownerPath(`/inventory/${encodeURIComponent(item.productId)}`), {
                        method: "PATCH",
                        body: JSON.stringify({
                            trackingEnabled: track.checked,
                            quantity,
                            lowStockThreshold
                        })
                    });
                    message(el.inventoryMessage, "Stok güncellendi.", "success");
                    await loadInventory();
                } catch (error) {
                    message(el.inventoryMessage, error.message, "error");
                } finally {
                    save.disabled = false;
                }
            });

            controls.append(trackLabel, qtyLabel, lowLabel, save);
            card.append(main, controls);
            el.inventoryList.append(card);
        }
    }

    async function loadInventory() {
        message(el.inventoryMessage);
        const body = await api(ownerPath("/inventory"));
        state.inventory = Array.isArray(body?.inventory) ? body.inventory : [];
        renderInventory();
    }

    async function loadFulfillment() {
        message(el.fulfillmentMessage);
        const body = await api(ownerPath("/fulfillment"));
        const f = body?.fulfillment || {};
        el.delivery.checked = f.deliveryEnabled === true;
        el.pickup.checked = f.pickupEnabled === true;
        el.takeaway.checked = f.takeawayEnabled === true;
        el.dineIn.checked = f.dineInEnabled === true;
    }

    async function loadAll() {
        message(el.authMessage);
        let authError = null;
        try {
            await loadFulfillment();
        } catch (error) {
            message(el.fulfillmentMessage, error.message, "error");
            if (error.status === 401 || error.status === 403) authError = error;
        }
        try {
            await loadInventory();
        } catch (error) {
            state.inventory = [];
            renderInventory();
            message(el.inventoryMessage, error.message, "error");
            if (error.status === 401 || error.status === 403) authError = error;
        }
        if (authError) {
            message(el.authMessage, authError.message, "error");
            el.app.classList.add("hidden");
            el.authPanel.classList.remove("hidden");
            return;
        }
        el.authPanel.classList.add("hidden");
        el.app.classList.remove("hidden");
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
        try {
            await firebase.auth().signInWithEmailAndPassword(el.email.value.trim(), el.password.value);
        } catch {
            message(el.authMessage, "Giriş başarısız.", "error");
        }
    });

    el.saveFulfillment.addEventListener("click", async () => {
        const draft = {
            deliveryEnabled: el.delivery.checked,
            pickupEnabled: el.pickup.checked,
            takeawayEnabled: el.takeaway.checked,
            dineInEnabled: el.dineIn.checked
        };
        if (!Object.values(draft).some(Boolean)) {
            message(el.fulfillmentMessage, "En az bir sipariş kanalı açık olmalı.", "error");
            return;
        }
        el.saveFulfillment.disabled = true;
        try {
            await api(ownerPath("/fulfillment"), {
                method: "PATCH",
                body: JSON.stringify(draft)
            });
            message(el.fulfillmentMessage, "Sipariş kanalları güncellendi.", "success");
        } catch (error) {
            message(el.fulfillmentMessage, error.message, "error");
        } finally {
            el.saveFulfillment.disabled = false;
        }
    });

    el.refresh.addEventListener("click", () => loadAll());

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
