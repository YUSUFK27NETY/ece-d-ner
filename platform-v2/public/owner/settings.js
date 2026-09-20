(() => {
    "use strict";

    const ids = [
        "auth-required", "settings-form", "tenant-label", "back-link", "refresh-button",
        "display-name", "brand-name", "phone", "whatsapp", "business-email", "website",
        "instagram-url", "google-url", "timezone", "address", "business-hours",
        "save-button", "save-message"
    ];
    const el = Object.fromEntries(ids.map(id => [
        id.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
        document.getElementById(id)
    ]));

    if (Object.values(el).some(value => value === null) ||
        typeof firebase === "undefined" || !firebase.auth ||
        typeof window.OWNER_SESSION_RESOLVER?.resolve !== "function") {
        return;
    }

    const state = {
        tenantId: "",
        settings: null,
        busy: false,
        requestVersion: 0
    };

    function message(text = "", type = "") {
        el.saveMessage.textContent = text;
        el.saveMessage.className = "message";
        if (type) el.saveMessage.classList.add(type);
    }

    function setBusy(value) {
        state.busy = Boolean(value);
        for (const control of el.settingsForm.querySelectorAll("input, textarea, button")) {
            control.disabled = state.busy;
        }
        el.refreshButton.disabled = state.busy;
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    function ownerPath() {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner/settings`;
    }

    async function api(options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${await token()}`);
        if (options.body) headers.set("Content-Type", "application/json");
        const response = await fetch(ownerPath(), { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function requireSettings(value) {
        if (!value || typeof value !== "object" || Array.isArray(value) ||
            value.tenantId !== state.tenantId ||
            typeof value.displayName !== "string" ||
            !value.profile || typeof value.profile !== "object" ||
            Array.isArray(value.profile)) {
            throw new Error("İşletme ayarları yanıtı doğrulanamadı.");
        }
        return value;
    }

    function fill(value, fallback = "") {
        return value === null || value === undefined ? fallback : String(value);
    }

    function render() {
        const settings = state.settings;
        if (!settings) return;
        const profile = settings.profile || {};
        el.tenantLabel.textContent = `${settings.displayName} · ${settings.tenantId}`;
        el.displayName.value = fill(settings.displayName);
        el.brandName.value = fill(profile.brandName);
        el.phone.value = fill(profile.phone);
        el.whatsapp.value = fill(profile.whatsapp);
        el.businessEmail.value = fill(profile.email);
        el.website.value = fill(profile.website);
        el.instagramUrl.value = fill(profile.instagramUrl);
        el.googleUrl.value = fill(profile.googleUrl);
        el.timezone.value = fill(profile.timezone, "Europe/Istanbul");
        el.address.value = fill(profile.address);
        el.businessHours.value = fill(profile.businessHours);
    }

    function profileFromForm() {
        return {
            brandName: el.brandName.value.trim(),
            phone: el.phone.value.trim(),
            whatsapp: el.whatsapp.value.trim(),
            email: el.businessEmail.value.trim(),
            website: el.website.value.trim(),
            instagramUrl: el.instagramUrl.value.trim(),
            googleUrl: el.googleUrl.value.trim(),
            timezone: el.timezone.value.trim() || "Europe/Istanbul",
            address: el.address.value.trim(),
            businessHours: el.businessHours.value.trim()
        };
    }

    async function load() {
        if (!state.tenantId || state.busy) return;
        const requestVersion = ++state.requestVersion;
        setBusy(true);
        message("Ayarlar yükleniyor...");
        try {
            const body = await api();
            if (requestVersion !== state.requestVersion) return;
            state.settings = requireSettings(body?.settings);
            render();
            el.authRequired.classList.add("hidden");
            el.settingsForm.classList.remove("hidden");
            message();
        } catch (error) {
            if (requestVersion !== state.requestVersion) return;
            state.settings = null;
            el.settingsForm.classList.add("hidden");
            message(error.message, "error");
        } finally {
            if (requestVersion === state.requestVersion) setBusy(false);
        }
    }

    async function save(event) {
        event.preventDefault();
        if (state.busy || !state.tenantId) return;
        const captured = Object.freeze({
            tenantId: state.tenantId,
            requestVersion: ++state.requestVersion
        });
        const displayName = el.displayName.value.trim();
        if (displayName.length < 2) {
            message("İşletme adı en az 2 karakter olmalı.", "error");
            return;
        }

        setBusy(true);
        message("Ayarlar kaydediliyor...");
        try {
            const body = await api({
                method: "PATCH",
                body: JSON.stringify({
                    displayName,
                    profile: profileFromForm()
                })
            });
            const updated = requireSettings(body?.settings);
            if (captured.requestVersion !== state.requestVersion ||
                captured.tenantId !== state.tenantId ||
                updated.tenantId !== captured.tenantId) {
                throw new Error("Ayar güncellemesi farklı işletme bağlamında döndü.");
            }
            state.settings = updated;
            render();
            message("İşletme ayarları kaydedildi.", "success");
        } catch (error) {
            if (captured.requestVersion === state.requestVersion) {
                message(error.message, "error");
            }
        } finally {
            if (captured.requestVersion === state.requestVersion) setBusy(false);
        }
    }

    el.settingsForm.addEventListener("submit", save);
    el.refreshButton.addEventListener("click", () => {
        state.requestVersion += 1;
        setBusy(false);
        load();
    });

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        message("Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }

    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        state.requestVersion += 1;
        state.settings = null;
        if (!user) {
            state.tenantId = "";
            el.settingsForm.classList.add("hidden");
            el.authRequired.classList.remove("hidden");
            message();
            return;
        }

        try {
            const session = await window.OWNER_SESSION_RESOLVER.resolve(user);
            state.tenantId = session.tenantId;
            el.backLink.href = `/owner/panel.html?tenant=${encodeURIComponent(state.tenantId)}`;
            el.authRequired.classList.add("hidden");
            await load();
        } catch (error) {
            state.tenantId = "";
            el.settingsForm.classList.add("hidden");
            el.authRequired.classList.remove("hidden");
            message(error.message, "error");
        }
    });
})();
