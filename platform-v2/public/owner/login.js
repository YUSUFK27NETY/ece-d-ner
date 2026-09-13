(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const form = document.getElementById("owner-login-form");
    const email = document.getElementById("owner-email");
    const password = document.getElementById("owner-password");
    const button = document.getElementById("owner-login-button");
    const message = document.getElementById("owner-login-message");

    if (!form || !email || !password || !button || !message ||
        typeof firebase === "undefined" || !firebase.auth) {
        return;
    }

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.className = "message";
        if (type) message.classList.add(type);
    }

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return tenantId.length >= 3 && tenantId.length <= 63 &&
            TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
    }

    function persistTenantId(tenantId) {
        try {
            window.sessionStorage.setItem("platformOwnerTenantId", tenantId);
        } catch {
            // Convenience only. Authorization never relies on browser storage.
        }
    }

    async function resolveSession(user) {
        const token = await user.getIdToken();
        const response = await fetch("/api/tenant/session", {
            method: "GET",
            headers: { Authorization: `Bearer ${token}` }
        });
        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        if (!response.ok) {
            const error = new Error(body?.message || "İşletme hesabı doğrulanamadı.");
            error.status = response.status;
            throw error;
        }
        const session = body?.session;
        const tenantId = normalizeTenantId(session?.tenantId);
        if (!tenantId || !["tenant_owner", "tenant_admin"].includes(session?.role)) {
            throw new Error("İşletme hesabı doğrulanamadı.");
        }
        persistTenantId(tenantId);
        window.location.replace(`/owner/panel.html?tenant=${encodeURIComponent(tenantId)}`);
    }

    const firebaseConfig = window.OWNER_BOOTSTRAP?.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage("Giriş servisi yapılandırılmamış.", "error");
        button.disabled = true;
        return;
    }

    firebase.initializeApp(firebaseConfig);
    let resolving = false;

    form.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage();
        button.disabled = true;
        try {
            await firebase.auth().signInWithEmailAndPassword(
                email.value.trim(),
                password.value
            );
        } catch {
            setMessage("Giriş başarısız. E-posta veya şifreyi kontrol edin.", "error");
            button.disabled = false;
        }
    });

    firebase.auth().onAuthStateChanged(async user => {
        if (!user || resolving) {
            if (!user) button.disabled = false;
            return;
        }
        resolving = true;
        button.disabled = true;
        setMessage("İşletmeniz açılıyor…");
        try {
            await resolveSession(user);
        } catch (error) {
            if (error?.status === 409) {
                setMessage("Bu hesap birden fazla işletmeye bağlı. Destek ile iletişime geçin.", "error");
            } else {
                setMessage("Bu hesap işletme paneline yetkili değil.", "error");
            }
            resolving = false;
            button.disabled = false;
        }
    });
})();
