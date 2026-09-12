(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
    const MAX_FILE_BYTES = 5 * 1024 * 1024;

    const el = Object.freeze({
        tenantLabel: document.getElementById("tenant-label"),
        mediaStatus: document.getElementById("media-status"),
        message: document.getElementById("message"),
        authRequired: document.getElementById("auth-required"),
        productGrid: document.getElementById("product-grid"),
        backLink: document.getElementById("back-link"),
        loginLink: document.getElementById("login-link"),
        toast: document.getElementById("toast")
    });

    if (Object.values(el).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth) {
        return;
    }

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const state = {
        tenantId: "",
        products: [],
        busyProductId: "",
        mediaAvailable: bootstrap.mediaUploadAvailable === true
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

    async function uploadRequest(path, file) {
        const headers = new Headers();
        headers.set("Authorization", `Bearer ${await token()}`);
        headers.set("Content-Type", file.type);
        const response = await fetch(path, {
            method: "POST",
            headers,
            body: file
        });
        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        if (!response.ok) {
            const error = new Error(body?.message || `Görsel yüklenemedi (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function setMediaStatus() {
        el.mediaStatus.textContent = state.mediaAvailable ? "Yükleme hazır" : "Depolama yapılandırılmamış";
        el.mediaStatus.classList.toggle("ok", state.mediaAvailable);
        el.mediaStatus.classList.toggle("off", !state.mediaAvailable);
    }

    function imageNode(product) {
        const wrap = document.createElement("div");
        wrap.className = "image-wrap";
        if (product.imageUrl) {
            const image = document.createElement("img");
            image.src = product.imageUrl;
            image.alt = product.name;
            image.loading = "lazy";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => {
                wrap.replaceChildren();
                const fallback = document.createElement("span");
                fallback.className = "placeholder";
                fallback.textContent = "📷";
                wrap.append(fallback);
            }, { once: true });
            wrap.append(image);
        } else {
            const fallback = document.createElement("span");
            fallback.className = "placeholder";
            fallback.textContent = "📷";
            wrap.append(fallback);
        }
        return wrap;
    }

    function actionButton(label, className = "secondary") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = className;
        button.textContent = label;
        return button;
    }

    function validateFile(file) {
        if (!(file instanceof File)) throw new Error("Önce bir görsel seçin.");
        if (!ALLOWED_TYPES.has(file.type)) {
            throw new Error("Yalnız JPEG, PNG veya WebP yükleyebilirsiniz.");
        }
        if (file.size < 12 || file.size > MAX_FILE_BYTES) {
            throw new Error("Görsel en fazla 5 MB olabilir.");
        }
        return file;
    }

    async function attachImage(product, fileInput) {
        if (!state.mediaAvailable) {
            setMessage("Medya depolama henüz yapılandırılmamış.", "error");
            return;
        }
        try {
            const file = validateFile(fileInput.files?.[0]);
            state.busyProductId = product.productId;
            renderProducts();
            setMessage("Görsel yükleniyor...");
            const upload = await uploadRequest(
                ownerPath(`/media/products/${encodeURIComponent(product.productId)}/image`),
                file
            );
            const imageUrl = upload?.media?.imageUrl;
            if (typeof imageUrl !== "string" || !imageUrl.startsWith("https://")) {
                throw new Error("Yüklenen görsel URL'si doğrulanamadı.");
            }
            await jsonRequest(ownerPath(`/catalog/products/${encodeURIComponent(product.productId)}`), {
                method: "PATCH",
                body: JSON.stringify({ imageUrl })
            });
            showToast("Ürün görseli güncellendi.");
            await loadProducts();
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            state.busyProductId = "";
            renderProducts();
        }
    }

    async function removeImage(product) {
        if (!product.imageUrl) return;
        if (!window.confirm(`${product.name} görseli kaldırılsın mı?`)) return;
        state.busyProductId = product.productId;
        renderProducts();
        try {
            await jsonRequest(ownerPath(`/catalog/products/${encodeURIComponent(product.productId)}`), {
                method: "PATCH",
                body: JSON.stringify({ imageUrl: "" })
            });
            showToast("Ürün görseli kaldırıldı.");
            await loadProducts();
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            state.busyProductId = "";
            renderProducts();
        }
    }

    function productCard(product) {
        const card = document.createElement("article");
        card.className = "product-card";
        card.append(imageNode(product));

        const body = document.createElement("div");
        body.className = "card-body";
        const title = document.createElement("h3");
        title.textContent = product.name;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${product.category} • ${formatMoney(product.price)}`;

        const row = document.createElement("div");
        row.className = "file-row";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/jpeg,image/png,image/webp";
        input.disabled = !state.mediaAvailable || state.busyProductId === product.productId;
        const upload = actionButton(
            state.busyProductId === product.productId ? "Yükleniyor..." : (product.imageUrl ? "Fotoğrafı değiştir" : "Fotoğraf yükle"),
            "primary"
        );
        upload.disabled = input.disabled;
        upload.addEventListener("click", () => attachImage(product, input));
        row.append(input, upload);

        const actions = document.createElement("div");
        actions.className = "actions";
        if (product.imageUrl) {
            const remove = actionButton("Görseli kaldır", "danger");
            remove.disabled = state.busyProductId === product.productId;
            remove.addEventListener("click", () => removeImage(product));
            actions.append(remove);
        }

        body.append(title, meta, row, actions);
        card.append(body);
        return card;
    }

    function renderProducts() {
        el.productGrid.replaceChildren();
        if (!state.products.length) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = "Görsel yönetmek için önce işletme panelinden ürün veya hizmet ekleyin.";
            el.productGrid.append(empty);
            return;
        }
        for (const product of state.products) {
            el.productGrid.append(productCard(product));
        }
    }

    async function loadProducts() {
        if (!state.tenantId) {
            setMessage("Geçerli işletme kodu bulunamadı.", "error");
            return;
        }
        setMessage("Ürünler yükleniyor...");
        try {
            const overview = await jsonRequest(ownerPath("/overview"));
            const tenant = overview?.tenant;
            if (!tenant || tenant.tenantId !== state.tenantId) {
                throw new Error("İşletme doğrulanamadı.");
            }
            el.tenantLabel.textContent = tenant.profile?.brandName || tenant.displayName || tenant.tenantId;
            const catalog = await jsonRequest(ownerPath("/catalog/products?limit=200"));
            state.products = Array.isArray(catalog?.products) ? catalog.products : [];
            setMessage();
            renderProducts();
        } catch (error) {
            state.products = [];
            renderProducts();
            setMessage(error.message, "error");
        }
    }

    const firebaseConfig = bootstrap.firebase;
    state.tenantId = initialTenantId();
    const tenantQuery = state.tenantId ? `?tenant=${encodeURIComponent(state.tenantId)}` : "";
    el.backLink.href = `/owner/${tenantQuery}`;
    el.loginLink.href = `/owner/${tenantQuery}`;
    setMediaStatus();

    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage("Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }

    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.authRequired.classList.remove("hidden");
            el.productGrid.replaceChildren();
            return;
        }
        el.authRequired.classList.add("hidden");
        await loadProducts();
    });
})();
