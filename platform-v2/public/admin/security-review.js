(() => {
    "use strict";

    const firebaseConfig = window.PLATFORM_BOOTSTRAP?.firebase;
    const elements = {
        session: document.getElementById("security-review-session"),
        tenantId: document.getElementById("security-review-tenant-id"),
        load: document.getElementById("security-review-load"),
        summary: document.getElementById("security-review-summary"),
        status: document.getElementById("security-review-status"),
        counts: document.getElementById("security-review-counts"),
        alerts: document.getElementById("security-review-alerts"),
        confirm: document.getElementById("security-review-confirm"),
        complete: document.getElementById("security-review-complete"),
        message: document.getElementById("security-review-message")
    };

    let reviewedTenantId = null;
    let reviewAllowed = false;

    function setMessage(text = "", type = "") {
        elements.message.textContent = text;
        elements.message.classList.remove("error", "success");
        if (type) elements.message.classList.add(type);
    }

    function resetReview() {
        reviewedTenantId = null;
        reviewAllowed = false;
        elements.summary.classList.add("hidden");
        elements.status.textContent = "";
        elements.counts.textContent = "";
        elements.alerts.replaceChildren();
        elements.confirm.checked = false;
        elements.confirm.disabled = true;
        elements.complete.disabled = true;
    }

    function currentTenantId() {
        const value = elements.tenantId.value.trim();
        if (!value || value !== elements.tenantId.value ||
            !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)) {
            throw new Error("Tenant ID geçersiz.");
        }
        return value;
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

    function safeSeverity(value) {
        return ["info", "warning", "high", "critical"].includes(value)
            ? value
            : null;
    }

    function renderAlerts(alerts) {
        elements.alerts.replaceChildren();
        if (alerts.length === 0) {
            const empty = document.createElement("p");
            empty.className = "muted";
            empty.textContent = "Bu tenant için görünür güvenlik uyarısı yok.";
            elements.alerts.append(empty);
            return;
        }

        const list = document.createElement("ul");
        for (const alert of alerts) {
            const severity = safeSeverity(alert?.severity);
            if (!severity || alert?.tenantId !== reviewedTenantId) continue;
            const item = document.createElement("li");
            const title = document.createElement("strong");
            title.textContent = `${severity.toUpperCase()} · ${String(alert.eventType || "event")}`;
            const detail = document.createElement("small");
            detail.textContent =
                `${String(alert.reasonCode || "reason unavailable")} · ${String(alert.lastSeenAt || "time unavailable")}`;
            item.append(title, document.createElement("br"), detail);
            list.append(item);
        }
        elements.alerts.append(list);
    }

    async function loadReview() {
        resetReview();
        setMessage();
        elements.load.disabled = true;
        try {
            const tenantId = currentTenantId();
            const [alertsBody, readinessBody] = await Promise.all([
                apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}/security-alerts?limit=200`),
                apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`)
            ]);
            if (!Array.isArray(alertsBody?.alerts)) {
                throw new Error("Güvenlik uyarıları doğrulanamadı.");
            }
            reviewedTenantId = tenantId;
            const alerts = alertsBody.alerts;
            const counts = { info: 0, warning: 0, high: 0, critical: 0 };
            for (const alert of alerts) {
                const severity = safeSeverity(alert?.severity);
                if (!severity || alert?.tenantId !== tenantId) {
                    throw new Error("Güvenlik uyarıları doğrulanamadı.");
                }
                counts[severity] += 1;
            }

            const security = readinessBody?.readiness?.checks?.security;
            elements.status.textContent =
                `Mevcut Security readiness: ${String(security?.status || "unknown")} · ${String(security?.code || "Kod yok")}`;
            elements.counts.textContent =
                `Toplam ${alerts.length} · info ${counts.info} · warning ${counts.warning} · high ${counts.high} · critical ${counts.critical}`;
            elements.summary.classList.remove("hidden");
            renderAlerts(alerts);

            reviewAllowed = alerts.length < 200 &&
                counts.warning === 0 &&
                counts.high === 0 &&
                counts.critical === 0;
            elements.confirm.disabled = !reviewAllowed;

            if (reviewAllowed) {
                setMessage("Bloklayıcı güvenlik uyarısı yok. İnceleme onayından sonra review tamamlanabilir.");
            } else {
                setMessage(
                    alerts.length >= 200
                        ? "Güvenlik görünürlüğü 200 kayıt sınırına ulaştı; review fail-closed."
                        : "Warning/high/critical güvenlik uyarıları çözülmeden review tamamlanamaz.",
                    "error"
                );
            }
        } catch (error) {
            resetReview();
            setMessage(error.message, "error");
        } finally {
            elements.load.disabled = false;
        }
    }

    async function completeReview() {
        const tenantId = currentTenantId();
        if (!reviewAllowed || !elements.confirm.checked ||
            reviewedTenantId !== tenantId) {
            setMessage("Önce güncel güvenlik kontrolünü tamamlayıp onay kutusunu işaretle.", "error");
            return;
        }

        elements.complete.disabled = true;
        elements.load.disabled = true;
        setMessage("Launch security review kaydediliyor...");
        try {
            const result = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/security-review/complete`,
                { method: "POST" }
            );
            const readiness = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`
            );
            const security = readiness?.readiness?.checks?.security;
            setMessage(
                `Security review ${String(result?.review?.state || "unknown")}. ` +
                `Security readiness: ${String(security?.status || "unknown")}. ` +
                `Genel hazırlık: ${String(readiness?.readiness?.activationReadiness || "unknown")}.`,
                security?.status === "ready" ? "success" : ""
            );
            elements.confirm.checked = false;
            elements.confirm.disabled = true;
            reviewAllowed = false;
        } catch (error) {
            setMessage(error.message, "error");
            elements.complete.disabled = !reviewAllowed;
        } finally {
            elements.load.disabled = false;
        }
    }

    if (!firebaseConfig) {
        elements.session.textContent = "Platform Firebase web config kullanılamıyor.";
        elements.load.disabled = true;
        return;
    }

    firebase.initializeApp(firebaseConfig);
    elements.load.addEventListener("click", loadReview);
    elements.confirm.addEventListener("change", () => {
        elements.complete.disabled = !(reviewAllowed && elements.confirm.checked);
    });
    elements.complete.addEventListener("click", completeReview);
    elements.tenantId.addEventListener("input", resetReview);

    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            elements.session.textContent = "Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.";
            elements.load.disabled = true;
            resetReview();
            return;
        }
        elements.session.textContent = `Aktif Platform Admin oturumu: ${user.email || user.uid}`;
        elements.load.disabled = false;
    });
})();
