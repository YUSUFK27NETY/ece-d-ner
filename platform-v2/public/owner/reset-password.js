(() => {
    "use strict";

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("reset-password-form");
    const tenantInput = document.getElementById("reset-password-tenant");
    const emailInput = document.getElementById("reset-password-email");
    const submitButton = document.getElementById("reset-password-submit");
    const message = document.getElementById("reset-password-message");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.className = "message";
        if (type) message.classList.add(type);
    }

    function normalizeTenantId(value) {
        const raw = String(value ?? "");
        const tenantId = raw.trim().toLowerCase();
        return raw.trim() === tenantId && tenantId.length >= 3 && tenantId.length <= 63 && TENANT_ID_PATTERN.test(tenantId)
            ? tenantId
            : "";
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Geçerli e-posta adresini gir.");
        }
        return email;
    }

    function tenantFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return normalizeTenantId(params.get("tenant"));
    }

    function ownerPanelUrl(tenantId) {
        const url = new URL("/owner/", window.location.origin);
        url.searchParams.set("tenant", tenantId);
        return url.toString();
    }

    const initialTenantId = tenantFromUrl();
    if (initialTenantId) tenantInput.value = initialTenantId;

    if (!firebaseConfig || typeof firebase === "undefined" || !firebase.auth) {
        submitButton.disabled = true;
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

    form.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage();

        const tenantId = normalizeTenantId(tenantInput.value);
        if (!tenantId) {
            setMessage("Geçerli işletme kodu gir.", "error");
            return;
        }

        let email;
        try {
            email = normalizedEmail();
        } catch (error) {
            setMessage(error.message, "error");
            return;
        }

        submitButton.disabled = true;
        try {
            await firebase.auth().sendPasswordResetEmail(email, {
                url: ownerPanelUrl(tenantId)
            });
            emailInput.value = "";
            setMessage("Hesap uygunsa şifre sıfırlama bağlantısı e-postana gönderildi.", "success");
        } catch (error) {
            if (error?.code === "auth/user-not-found") {
                setMessage("Hesap uygunsa şifre sıfırlama bağlantısı e-postana gönderildi.", "success");
            } else {
                setMessage("Şifre sıfırlama işlemi tamamlanamadı. Biraz sonra tekrar dene.", "error");
            }
        } finally {
            submitButton.disabled = false;
        }
    });
})();
