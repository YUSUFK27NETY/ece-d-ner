(() => {
    "use strict";

    const firebaseConfig = window.PLATFORM_BOOTSTRAP?.firebase;
    const elements = {
        session: document.getElementById("backup-diagnostic-session"),
        tenantId: document.getElementById("backup-diagnostic-tenant-id"),
        run: document.getElementById("backup-diagnostic-run"),
        summary: document.getElementById("backup-diagnostic-summary"),
        result: document.getElementById("backup-diagnostic-result"),
        message: document.getElementById("backup-diagnostic-message")
    };

    function setMessage(text = "", type = "") {
        elements.message.textContent = text;
        elements.message.classList.remove("error", "success");
        if (type) elements.message.classList.add(type);
    }

    function resetResult() {
        elements.summary.classList.add("hidden");
        elements.result.textContent = "";
        setMessage();
    }

    function currentTenantId() {
        const value = elements.tenantId.value.trim();
        if (!value || value !== elements.tenantId.value ||
            !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(value)) {
            throw new Error("Tenant ID geçersiz.");
        }
        return value;
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken();
    }

    async function apiRequest(path) {
        const token = await getIdToken();
        const response = await fetch(path, {
            headers: { Authorization: `Bearer ${token}` }
        });
        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        if (!response.ok) {
            throw new Error(body?.message || `İstek başarısız (${response.status}).`);
        }
        return body;
    }

    function validateDiagnostic(value, tenantId) {
        if (!value || typeof value !== "object" ||
            value.tenantId !== tenantId || value.operation !== "listObjects" ||
            typeof value.ok !== "boolean") {
            throw new Error("Backup diagnostic sonucu doğrulanamadı.");
        }
        if (value.ok === true && value.error !== null) {
            throw new Error("Backup diagnostic sonucu doğrulanamadı.");
        }
        if (value.ok === false &&
            (!value.error || typeof value.error.code !== "string" ||
                (value.error.status !== null && !Number.isInteger(value.error.status)))) {
            throw new Error("Backup diagnostic sonucu doğrulanamadı.");
        }
        return value;
    }

    async function runDiagnostic() {
        resetResult();
        elements.run.disabled = true;
        try {
            const tenantId = currentTenantId();
            setMessage("R2 listObjects bağlantısı kontrol ediliyor...");
            const body = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/backup-diagnostic`
            );
            const diagnostic = validateDiagnostic(body?.diagnostic, tenantId);
            elements.summary.classList.remove("hidden");

            if (diagnostic.ok) {
                elements.result.textContent =
                    `R2 listObjects PASS · tenant ${diagnostic.tenantId}`;
                setMessage("R2 bağlantısı erişilebilir. Sonraki adım backup readiness durumunu yeniden kontrol etmek.", "success");
                return;
            }

            const status = diagnostic.error.status === null
                ? "HTTP status yok"
                : `HTTP ${diagnostic.error.status}`;
            elements.result.textContent =
                `R2 listObjects FAIL · ${diagnostic.error.code} · ${status}`;
            setMessage(
                "Güvenli hata kodu alındı. Credential veya secret değeri gösterilmedi.",
                "error"
            );
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            elements.run.disabled = false;
        }
    }

    if (!firebaseConfig) {
        elements.session.textContent = "Platform Firebase web config kullanılamıyor.";
        elements.run.disabled = true;
        return;
    }

    firebase.initializeApp(firebaseConfig);
    elements.run.addEventListener("click", runDiagnostic);
    elements.tenantId.addEventListener("input", resetResult);

    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            elements.session.textContent =
                "Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.";
            elements.run.disabled = true;
            resetResult();
            return;
        }
        elements.session.textContent =
            `Aktif Platform Admin oturumu: ${user.email || user.uid}`;
        elements.run.disabled = false;
    });
})();
