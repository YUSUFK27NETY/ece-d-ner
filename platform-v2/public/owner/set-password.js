(() => {
    "use strict";

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("set-password-form");
    const passwordInput = document.getElementById("new-password");
    const confirmInput = document.getElementById("confirm-password");
    const submitButton = document.getElementById("set-password-submit");
    const message = document.getElementById("set-password-message");
    const next = document.getElementById("set-password-next");
    const ownerLink = document.getElementById("set-password-owner-link");
    const loginLink = document.getElementById("set-password-login-link");
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

    function tenantFromUrl() {
        const params = new URLSearchParams(window.location.search);
        return normalizeTenantId(params.get("tenant"));
    }

    function ownerPanelUrl(tenantId) {
        return `/owner/?tenant=${encodeURIComponent(tenantId)}`;
    }

    function passwordlessLoginUrl(tenantId) {
        return `/owner/email-login.html?tenant=${encodeURIComponent(tenantId)}`;
    }

    async function verifyOwnerSession(user, tenantId) {
        const idToken = await user.getIdToken(true);
        const response = await fetch(`/api/tenant/tenants/${encodeURIComponent(tenantId)}/owner/overview`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok || body?.tenant?.tenantId !== tenantId || body?.session?.tenantId !== tenantId || body?.session?.role !== "tenant_owner") {
            throw new Error("Bu hesap bu işletmenin owner hesabı olarak doğrulanamadı.");
        }
    }

    function validatePassword() {
        const password = passwordInput.value;
        const confirmation = confirmInput.value;
        if (password.length < 12 || password.length > 128) {
            throw new Error("Şifre 12-128 karakter olmalı.");
        }
        if (password !== confirmation) {
            throw new Error("Şifreler eşleşmiyor.");
        }
        return password;
    }

    const tenantId = tenantFromUrl();
    if (tenantId) {
        ownerLink.href = ownerPanelUrl(tenantId);
        loginLink.href = passwordlessLoginUrl(tenantId);
    }

    if (!tenantId) {
        setMessage("Geçerli işletme kodu bulunamadı.", "error");
        return;
    }
    if (!firebaseConfig || typeof firebase === "undefined" || !firebase.auth) {
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

    let verifiedUser = null;
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            form.hidden = true;
            setMessage("Önce şifresiz e-posta bağlantısıyla owner hesabını doğrula.", "error");
            return;
        }
        try {
            await verifyOwnerSession(user, tenantId);
            verifiedUser = user;
            form.hidden = false;
            setMessage("Owner hesabı doğrulandı. Kalıcı şifreni belirleyebilirsin.", "success");
        } catch (error) {
            verifiedUser = null;
            form.hidden = true;
            setMessage(error.message, "error");
        }
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        if (!verifiedUser) {
            setMessage("Owner oturumu doğrulanmadı.", "error");
            return;
        }

        let password;
        try {
            password = validatePassword();
        } catch (error) {
            setMessage(error.message, "error");
            return;
        }

        submitButton.disabled = true;
        try {
            await verifiedUser.updatePassword(password);
            passwordInput.value = "";
            confirmInput.value = "";
            form.hidden = true;
            next.hidden = false;
            setMessage("Kalıcı şifren kaydedildi. Bundan sonra e-posta ve şifreyle giriş yapabilirsin.", "success");
        } catch (error) {
            if (error?.code === "auth/requires-recent-login") {
                setMessage("Güvenlik doğrulaması eskidi. Şifresiz giriş bağlantısıyla tekrar giriş yapıp yeniden dene.", "error");
            } else if (error?.code === "auth/weak-password") {
                setMessage("Daha güçlü bir şifre belirle.", "error");
            } else {
                setMessage("Şifre kaydedilemedi. Tekrar deneyin.", "error");
            }
        } finally {
            submitButton.disabled = false;
        }
    });
})();
