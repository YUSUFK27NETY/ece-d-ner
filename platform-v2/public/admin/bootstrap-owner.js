(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("bootstrap-owner-form");
    const tenantIdInput = document.getElementById("bootstrap-tenant-id");
    const emailInput = document.getElementById("bootstrap-owner-email");
    const submitButton = document.getElementById("bootstrap-owner-button");
    const session = document.getElementById("bootstrap-session");
    const message = document.getElementById("bootstrap-owner-message");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.classList.remove("error", "success");
        if (type) message.classList.add(type);
    }

    function setEnabled(enabled) {
        tenantIdInput.disabled = !enabled;
        emailInput.disabled = !enabled;
        submitButton.disabled = !enabled;
    }

    function canonicalTenantId() {
        const raw = tenantIdInput.value;
        const tenantId = raw.trim().toLowerCase();
        if (raw !== tenantId || tenantId.length < 3 || tenantId.length > 63 ||
            !TENANT_ID_PATTERN.test(tenantId)) {
            throw new Error("Canonical Tenant ID gerekli.");
        }
        return tenantId;
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Geçerli bir owner e-posta adresi gerekli.");
        }
        return email;
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken(true);
    }

    async function apiRequest(path, options = {}) {
        const token = await getIdToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || `İstek başarısız (${response.status}).`);
        return body;
    }

    function inviteLandingUrl(tenantId, inviteToken) {
        const url = new URL("/owner/accept-invite.html", window.location.origin);
        url.searchParams.set("tenantId", tenantId);
        url.searchParams.set("inviteToken", inviteToken);
        return url.toString();
    }

    function firebaseMessage(error) {
        if (error?.code === "auth/operation-not-allowed") {
            return "Firebase Authentication içinde Email/Password ve Email Link giriş yöntemlerini etkinleştir.";
        }
        if (error?.code === "auth/unauthorized-continue-uri") {
            return "Production domain Firebase Authentication yetkili domain listesinde değil.";
        }
        if (error?.code === "auth/too-many-requests") return "Firebase e-posta gönderimini geçici olarak sınırladı.";
        return error?.message || "Owner daveti gönderilemedi.";
    }

    if (!firebaseConfig) {
        setEnabled(false);
        session.textContent = "Platform Firebase web config kullanılamıyor.";
        setMessage("Owner davet sayfası kullanılamıyor.", "error");
        return;
    }

    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);
    setEnabled(false);

    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            setEnabled(false);
            session.textContent = "Platform Admin oturumu bulunamadı.";
            setMessage("Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.", "error");
            return;
        }
        session.textContent = `Aktif Platform Admin oturumu: ${user.email || "doğrulanmış kullanıcı"}`;
        setMessage();
        setEnabled(true);
    });

    form.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage();
        let tenantId;
        let email;
        try {
            tenantId = canonicalTenantId();
            email = normalizedEmail();
        } catch (error) {
            setMessage(error.message, "error");
            return;
        }

        setEnabled(false);
        try {
            const body = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/admin-bootstrap/initial-owner-invite`,
                { method: "POST", body: JSON.stringify({ email }) }
            );
            const invite = body?.invite;
            if (!body?.success || invite?.tenantId !== tenantId || invite?.role !== "tenant_owner" ||
                invite?.delivery !== "firebase_email_link" || typeof invite?.inviteToken !== "string") {
                throw new Error("Davet yanıtı doğrulanamadı.");
            }
            await firebase.auth().sendSignInLinkToEmail(email, {
                url: inviteLandingUrl(tenantId, invite.inviteToken),
                handleCodeInApp: true
            });
            emailInput.value = "";
            setMessage("Owner daveti Firebase üzerinden gönderildi. Owner linki kabul edince Admin Bootstrap readiness otomatik hazır olur.", "success");
        } catch (error) {
            setMessage(firebaseMessage(error), "error");
        } finally {
            if (firebase.auth().currentUser) setEnabled(true);
        }
    });
})();
