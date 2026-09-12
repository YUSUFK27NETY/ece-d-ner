(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const ids = [
        "auth-panel", "login-form", "tenant-id", "email", "password", "auth-message", "app", "refresh",
        "workspace-message", "public-status", "canonical-url", "copy-url", "open-url", "qr-preview", "qr-message",
        "download-qr", "channel-list"
    ];
    const el = Object.fromEntries(ids.map(id => [id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), document.getElementById(id)]));
    if (Object.values(el).some(value => value === null) || typeof firebase === "undefined" || !firebase.auth) return;

    const state = { tenantId: "", channels: null, qrObjectUrl: "" };

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

    function ownerPath(suffix = "") {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/channels${suffix}`;
    }

    async function api(path) {
        const response = await fetch(path, { headers: { Authorization: `Bearer ${await token()}` } });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || `İstek başarısız (${response.status}).`);
        return body;
    }

    function channelCard(label, value) {
        const card = document.createElement("article");
        card.className = "channel-card";
        const title = document.createElement("strong");
        title.textContent = label;
        const detail = document.createElement("span");
        detail.textContent = value || "Yapılandırılmamış";
        card.append(title, detail);
        if (value) {
            const link = document.createElement("a");
            link.href = value;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = "Aç";
            card.append(link);
        }
        return card;
    }

    function renderChannels() {
        const channels = state.channels;
        if (!channels) return;
        el.canonicalUrl.value = channels.canonicalPublicUrl;
        el.openUrl.href = channels.canonicalPublicUrl;
        el.publicStatus.textContent = channels.publicAvailable ? "Yayında" : `Kapalı · ${channels.status}`;
        el.channelList.replaceChildren(
            channelCard("Direct link", channels.channels?.direct),
            channelCard("WhatsApp", channels.channels?.whatsapp),
            channelCard("Instagram", channels.channels?.instagram),
            channelCard("Google / Maps", channels.channels?.google)
        );
    }

    function clearQr() {
        el.qrPreview.replaceChildren();
        el.downloadQr.classList.add("disabled");
        el.downloadQr.removeAttribute("href");
        if (state.qrObjectUrl) URL.revokeObjectURL(state.qrObjectUrl);
        state.qrObjectUrl = "";
    }

    async function loadQr() {
        clearQr();
        if (!state.channels?.qrAvailable) {
            el.qrMessage.textContent = "QR yalnız aktif ve public erişime açık işletme için kullanılabilir.";
            return;
        }
        const response = await fetch(ownerPath("/qr.svg"), {
            headers: { Authorization: `Bearer ${await token()}` }
        });
        if (!response.ok) {
            let body = null;
            try { body = await response.json(); } catch { body = null; }
            throw new Error(body?.message || "QR alınamadı.");
        }
        const svgText = await response.text();
        const parsed = new DOMParser().parseFromString(svgText, "image/svg+xml");
        const svg = parsed.documentElement;
        if (!svg || svg.nodeName.toLowerCase() !== "svg" || parsed.querySelector("parsererror")) {
            throw new Error("QR yanıtı geçersiz.");
        }
        el.qrPreview.replaceChildren(document.importNode(svg, true));
        const blob = new Blob([svgText], { type: "image/svg+xml" });
        state.qrObjectUrl = URL.createObjectURL(blob);
        el.downloadQr.href = state.qrObjectUrl;
        el.downloadQr.download = `${state.tenantId}-qr.svg`;
        el.downloadQr.classList.remove("disabled");
        el.qrMessage.textContent = "QR payload yalnız canonical public işletme URL’sidir.";
    }

    async function loadAll() {
        message(el.workspaceMessage);
        const body = await api(ownerPath());
        if (!body?.channels || body.channels.tenantId !== state.tenantId) throw new Error("İşletme paylaşım oturumu doğrulanamadı.");
        state.channels = body.channels;
        renderChannels();
        await loadQr();
        el.authPanel.classList.add("hidden");
        el.app.classList.remove("hidden");
    }

    el.copyUrl.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(state.channels?.canonicalPublicUrl || "");
            message(el.workspaceMessage, "Canonical bağlantı kopyalandı.", "success");
        } catch {
            message(el.workspaceMessage, "Bağlantı panoya kopyalanamadı.", "error");
        }
    });

    el.refresh.addEventListener("click", () => loadAll().catch(error => message(el.workspaceMessage, error.message, "error")));

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
        try {
            await loadAll();
        } catch (error) {
            message(el.authMessage, error.message, "error");
            el.app.classList.add("hidden");
            el.authPanel.classList.remove("hidden");
        }
    });
})();
