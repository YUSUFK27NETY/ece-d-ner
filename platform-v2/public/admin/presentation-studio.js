(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const TIERS = new Set(["starter", "business", "pro"]);
    const FAMILIES = Object.freeze([
        Object.freeze({ id: "modern", label: "Modern", description: "Dengeli, çağdaş ve çok sektörlü güvenli varsayılan." }),
        Object.freeze({ id: "warm", label: "Warm", description: "Sıcak yüzeyler, yumuşak kartlar ve davetkâr marka hissi." }),
        Object.freeze({ id: "bold", label: "Bold", description: "Yüksek kontrast, güçlü tipografi ve daha sert bileşen dili." }),
        Object.freeze({ id: "corporate", label: "Corporate", description: "Kurumsal, düzenli, ciddi ve yapılandırılmış görünüm." }),
        Object.freeze({ id: "editorial", label: "Editorial", description: "Hikâye, boşluk ve tipografi odaklı daha karakterli sunum." }),
        Object.freeze({ id: "minimal", label: "Minimal", description: "Daha az dekorasyon, daha fazla boşluk ve sade yüzeyler." })
    ]);
    const FAMILY_SET = new Set(FAMILIES.map(item => item.id));
    const DEFAULT_FAMILY_BY_TIER = Object.freeze({ starter: "modern", business: "modern", pro: "editorial" });

    const byId = id => document.getElementById(id);
    const el = Object.freeze({
        session: byId("studio-session"),
        message: byId("studio-message"),
        tenantId: byId("studio-tenant-id"),
        load: byId("studio-load"),
        editor: byId("studio-editor"),
        tenantState: byId("tenant-state"),
        title: byId("studio-title"),
        meta: byId("studio-meta"),
        preview: byId("studio-preview"),
        tier: byId("studio-tier"),
        family: byId("studio-family"),
        cards: byId("family-cards"),
        selection: byId("studio-selection"),
        source: byId("studio-source"),
        save: byId("studio-save")
    });

    const state = { tenant: null, busy: false };

    function setMessage(text = "", type = "") {
        el.message.textContent = text;
        el.message.className = "message";
        if (type) el.message.classList.add(type);
    }

    function setBadge(text, status = "") {
        el.tenantState.textContent = text;
        el.tenantState.className = "badge";
        if (status) el.tenantState.classList.add(status);
    }

    function setBusy(value) {
        state.busy = value;
        el.load.disabled = value;
        el.save.disabled = value || !state.tenant;
        el.tenantId.disabled = value || Boolean(state.tenant);
        el.tier.disabled = value || !state.tenant;
        el.family.disabled = value || !state.tenant;
        for (const card of el.cards.querySelectorAll("button")) card.disabled = value || !state.tenant;
    }

    function canonicalTenantId(value) {
        const raw = String(value ?? "");
        const tenantId = raw.trim().toLowerCase();
        if (raw !== tenantId || tenantId.length < 3 || tenantId.length > 63 || !TENANT_ID_PATTERN.test(tenantId)) {
            throw new Error("Tenant ID geçersiz.");
        }
        return tenantId;
    }

    function defaultFamily(tier) {
        return DEFAULT_FAMILY_BY_TIER[tier] || "modern";
    }

    function presentationSelection() {
        const tier = String(el.tier.value || "").toLowerCase();
        const family = String(el.family.value || "").toLowerCase();
        if (!TIERS.has(tier)) throw new Error("Sunum seviyesi geçersiz.");
        if (!FAMILY_SET.has(family)) throw new Error("Tasarım ailesi geçersiz.");
        return { tier, version: 1, family };
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken();
    }

    async function apiRequest(path, options = {}) {
        const token = await getIdToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);
        if (options.body) headers.set("Content-Type", "application/json");
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || `İstek başarısız (${response.status}).`);
        return body;
    }

    function renderFamilyCards() {
        const fragment = document.createDocumentFragment();
        for (const family of FAMILIES) {
            const card = document.createElement("button");
            card.type = "button";
            card.className = "family-card";
            card.dataset.family = family.id;
            card.dataset.selected = String(el.family.value === family.id);
            const title = document.createElement("strong");
            title.textContent = family.label;
            const description = document.createElement("span");
            description.textContent = family.description;
            card.append(title, description);
            card.addEventListener("click", () => {
                el.family.value = family.id;
                renderFamilyCards();
                renderSelection();
            });
            fragment.append(card);
        }
        el.cards.replaceChildren(fragment);
        setBusy(state.busy);
    }

    function renderSelection() {
        const tierLabels = { starter: "Starter", business: "Business", pro: "Business Pro" };
        const family = FAMILIES.find(item => item.id === el.family.value);
        el.selection.textContent = `${tierLabels[el.tier.value] || el.tier.value} · ${family?.label || el.family.value}`;
        renderFamilyCards();
    }

    function populateTenant(tenant) {
        state.tenant = tenant;
        const presentation = tenant.presentation || null;
        const tier = TIERS.has(presentation?.tier) ? presentation.tier : "starter";
        const family = FAMILY_SET.has(presentation?.family) ? presentation.family : defaultFamily(tier);
        el.tier.value = tier;
        el.family.value = family;
        el.title.textContent = tenant.profile?.brandName || tenant.displayName || tenant.tenantId;
        el.meta.textContent = `${tenant.tenantId} · ${tenant.sector} · ${tenant.plan} · ${tenant.status}`;
        el.source.textContent = presentation?.family
            ? "Tasarım ailesi tenant kaydında explicit olarak saklanıyor."
            : `Bu tenantta explicit family yok; ${family} güvenli varsayılanı gösteriliyor.`;
        setBadge(tenant.status, tenant.status);
        if (tenant.status === "active") {
            el.preview.href = `/m/${encodeURIComponent(tenant.tenantId)}`;
            el.preview.classList.remove("hidden");
        } else {
            el.preview.classList.add("hidden");
        }
        el.editor.classList.remove("hidden");
        renderSelection();
        setBusy(false);
    }

    async function loadTenant() {
        let tenantId;
        try { tenantId = canonicalTenantId(el.tenantId.value); }
        catch (error) { return setMessage(error.message, "error"); }
        setBusy(true);
        setMessage("Tenant presentation bilgisi yükleniyor…");
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}`);
            if (!body?.tenant || body.tenant.tenantId !== tenantId) throw new Error("Tenant yanıtı doğrulanamadı.");
            populateTenant(body.tenant);
            setMessage("Presentation ayarı yüklendi.", "success");
        } catch (error) {
            state.tenant = null;
            el.editor.classList.add("hidden");
            setBadge("Hata", "pending");
            setMessage(error.message || "Tenant yüklenemedi.", "error");
            setBusy(false);
        }
    }

    async function savePresentation() {
        if (!state.tenant) return;
        let presentation;
        try { presentation = presentationSelection(); }
        catch (error) { return setMessage(error.message, "error"); }
        setBusy(true);
        setMessage("Presentation ayarı kaydediliyor…");
        try {
            const tenantId = state.tenant.tenantId;
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}`, {
                method: "PATCH",
                body: JSON.stringify({ presentation })
            });
            if (!body?.tenant || body.tenant.tenantId !== tenantId) throw new Error("Presentation güncellemesi doğrulanamadı.");
            populateTenant(body.tenant);
            setMessage("Sunum seviyesi ve tasarım ailesi kaydedildi.", "success");
        } catch (error) {
            setMessage(error.message || "Presentation ayarı kaydedilemedi.", "error");
            setBusy(false);
        }
    }

    el.load.addEventListener("click", loadTenant);
    el.tenantId.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            void loadTenant();
        }
    });
    el.tier.addEventListener("change", () => {
        if (!FAMILY_SET.has(el.family.value)) el.family.value = defaultFamily(el.tier.value);
        renderSelection();
    });
    el.family.addEventListener("change", renderSelection);
    el.save.addEventListener("click", savePresentation);

    renderFamilyCards();
    setBusy(true);

    if (!firebaseConfig || typeof firebase === "undefined") {
        setMessage("Platform Firebase web config kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.session.textContent = "Platform Admin oturumu bulunamadı.";
            setMessage("Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.", "error");
            setBusy(true);
            return;
        }
        el.session.textContent = user.email || "Doğrulanmış Platform Admin";
        setBusy(false);
        const tenantId = new URLSearchParams(window.location.search).get("tenantId");
        if (tenantId) {
            el.tenantId.value = tenantId;
            await loadTenant();
        }
    });
})();
