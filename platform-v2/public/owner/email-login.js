(() => {
    "use strict";

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("email-login-form");
    const tenantInput = document.getElementById("email-login-tenant");
    const emailInput = document.getElementById("email-login-email");
    const submitButton = document.getElementById("email-login-submit");
    const message = document.getElementById("email-login-message");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.className = "message";
        if (type) message.classList.add(type);
    }

    function setEnabled(enabled) {
        tenantInput.disabled = !enabled;
        emailInput.disabled = !enabled;
        submitButton.disabled = !enabled;
    }

    function normalizeTenantId(value) {
        const raw = String(value ?? "");
        const tenantId = raw.trim().toLowerCase();
        return raw.trim() === tenantId && tenantId.length >= 3 && tenantId.length <= 63 &&
            TENANT_ID_PATTERN.test(tenantId)
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

    function tenantFromUrl(rawUrl = window.location.href) {
        const url = new URL(rawUrl);
        for (const key of ["tenant", "tenantId"]) {
            const tenantId = normalizeTenantId(url.searchParams.get(key));
            if (tenantId) return tenantId;
        }
        const continueUrl = url.searchParams.get("continueUrl");
        if (continueUrl) {
            try {
                const nested = new URL(continueUrl);
                for (const key of ["tenant", "tenantId"]) {
                    const tenantId = normalizeTenantId(nested.searchParams.get(key));
                    if (tenantId) return tenantId;
                }
            } catch {
                return "";
            }
        }
        return "";
    }

    function ownerLoginUrl(tenantId) {
        const url = new URL("/owner/email-login.html", window.location.origin);
        url.searchParams.set("tenant", tenantId);
        return url.toString();
    }

    function ownerPanelUrl(tenantId) {
        return `/owner/?tenant=${encodeURIComponent(tenantId)}`;
    }

    if (!firebaseConfig || typeof firebase === "undefined" || !firebase.auth) {
        setEnabled(false);
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

    const emailLink = window.location.href;
    const completing = firebase.auth().isSignInWithEmailLink(emailLink);
    const initialTenantId = tenantFromUrl(emailLink);
    if (initialTenantId) tenantInput.value = initialTenantId;

    if (completing) {
        submitButton.textContent = "Girişi tamamla";
        setMessage("E-posta bağlantısı doğrulandı. Davetin bağlı olduğu e-posta adresini tekrar gir.");
    }

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

        setEnabled(false);
        try {
            if (completing) {
                await firebase.auth().signInWithEmailLink(email, emailLink);
                emailInput.value = "";
                window.location.replace(ownerPanelUrl(tenantId));
                return;
            }

            await firebase.auth().sendSignInLinkToEmail(email, {
                url: ownerLoginUrl(tenantId),
                handleCodeInApp: true
            });
            emailInput.value = "";
            setMessage("Giriş bağlantısı e-postana gönderildi. Bağlantıyı açıp bu ekrandan girişi tamamla.", "success");
        } catch {
            setMessage("Giriş bağlantısı işlemi tamamlanamadı. E-posta ve işletme kodunu kontrol et.", "error");
        } finally {
            if (!completing) setEnabled(true);
        }
    });
})();
