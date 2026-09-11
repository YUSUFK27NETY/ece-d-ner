(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("bootstrap-owner-form");
    const tenantIdInput = document.getElementById("bootstrap-tenant-id");
    const firebaseUidInput = document.getElementById("bootstrap-firebase-uid");
    const submitButton = document.getElementById("bootstrap-owner-button");
    const session = document.getElementById("bootstrap-session");
    const message = document.getElementById("bootstrap-owner-message");

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.classList.remove("error", "success");
        if (type) message.classList.add(type);
    }

    function setEnabled(enabled) {
        tenantIdInput.disabled = !enabled;
        firebaseUidInput.disabled = !enabled;
        submitButton.disabled = !enabled;
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

    if (!firebaseConfig) {
        setEnabled(false);
        session.textContent = "Platform Firebase web config kullanılamıyor.";
        setMessage("Bootstrap sayfası kullanılamıyor.", "error");
        return;
    }

    firebase.initializeApp(firebaseConfig);
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

        const tenantId = tenantIdInput.value.trim();
        const firebaseUid = firebaseUidInput.value.trim();
        firebaseUidInput.value = "";

        if (!tenantId || !firebaseUid || firebaseUid.length > 128 || /[\u0000-\u001f\u007f]/.test(firebaseUid)) {
            setMessage("Tenant ID veya Firebase User UID geçersiz.", "error");
            return;
        }

        setEnabled(false);
        try {
            const bootstrapBody = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/admin-bootstrap/initial-owner`,
                {
                    method: "POST",
                    body: JSON.stringify({ firebaseUid })
                }
            );

            const result = bootstrapBody?.bootstrap;
            if (!bootstrapBody?.success || result?.tenantId !== tenantId ||
                result?.role !== "tenant_owner" || result?.state !== "active" ||
                result?.adminBootstrap !== "verified") {
                throw new Error("Bootstrap yanıtı doğrulanamadı.");
            }

            try {
                const readinessBody = await apiRequest(
                    `/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`
                );
                const readiness = readinessBody?.readiness;
                const adminBootstrap = readiness?.checks?.adminBootstrap?.status;
                const activationReadiness = readiness?.activationReadiness;
                const canActivate = readiness?.canActivate === true ? "Evet" : "Hayır";

                setMessage(
                    `Initial owner bağlandı. Tenant Owner aktif. Admin Bootstrap: ${adminBootstrap || "bilinmiyor"}. ` +
                    `Genel hazırlık: ${activationReadiness || "bilinmiyor"}. Aktive edilebilir: ${canActivate}.`,
                    "success"
                );
            } catch {
                setMessage(
                    "Initial owner başarıyla bağlandı. Readiness yeniden okunamadı; Merkezi Yönetim ekranında Yenile'ye bas.",
                    "success"
                );
            }
        } catch (error) {
            setMessage(error.message || "Initial owner bootstrap başarısız.", "error");
        } finally {
            if (firebase.auth().currentUser) setEnabled(true);
        }
    });
})();
