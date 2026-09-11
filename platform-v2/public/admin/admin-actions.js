(() => {
    "use strict";

    const tenantForm = document.getElementById("tenant-form");
    const tenantIdInput = document.getElementById("tenant-id");
    const statusBadge = document.getElementById("tenant-status-badge");
    const readinessCanActivate = document.getElementById("customer-readiness-can-activate");
    const operationsPanel = document.getElementById("operations-panel");
    const refreshButton = document.getElementById("refresh-button");

    if (!tenantForm || !tenantIdInput || !statusBadge || !readinessCanActivate ||
        !operationsPanel || !refreshButton || typeof firebase === "undefined") {
        return;
    }

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const LIFECYCLE_STATUSES = new Set([
        "provisioning", "active", "suspended", "archived"
    ]);
    const LIFECYCLE_RESULT = Object.freeze({
        activate: "active",
        suspend: "suspended",
        resume: "active",
        archive: "archived"
    });

    function createButton(id, text, className = "secondary") {
        const button = document.createElement("button");
        button.id = id;
        button.type = "button";
        button.className = className;
        button.textContent = text;
        return button;
    }

    function createActionPanel() {
        const panel = document.createElement("fieldset");
        panel.id = "admin-action-center";
        panel.classList.add("hidden");

        const legend = document.createElement("legend");
        legend.textContent = "Hızlı İşlemler";

        const summary = document.createElement("p");
        summary.id = "admin-action-summary";
        summary.className = "muted";

        const ownerGrid = document.createElement("div");
        ownerGrid.className = "grid two";

        const ownerLabel = document.createElement("label");
        ownerLabel.textContent = "Firebase User UID";
        const ownerUid = document.createElement("input");
        ownerUid.id = "admin-action-owner-uid";
        ownerUid.autocomplete = "off";
        ownerUid.spellcheck = false;
        ownerUid.maxLength = 128;
        const ownerHelp = document.createElement("small");
        ownerHelp.textContent = "İlk owner yalnız provisioning tenant için atanır. UID bu panelde saklanmaz.";
        ownerLabel.append(ownerUid, ownerHelp);

        const ownerActions = document.createElement("div");
        ownerActions.className = "form-actions";
        const firebaseUsers = createButton(
            "admin-action-firebase-users",
            "Firebase Kullanıcıları",
            "secondary"
        );
        const assignOwner = createButton(
            "admin-action-assign-owner",
            "Tenant Owner Ata",
            "primary"
        );
        ownerActions.append(firebaseUsers, assignOwner);
        ownerGrid.append(ownerLabel, ownerActions);

        const onboardingActions = document.createElement("div");
        onboardingActions.className = "form-actions";
        const securityReview = createButton(
            "admin-action-security-review",
            "Security Review",
            "secondary"
        );
        const backupDiagnostic = createButton(
            "admin-action-backup-diagnostic",
            "Backup / R2 Diagnostic",
            "secondary"
        );
        onboardingActions.append(securityReview, backupDiagnostic);

        const lifecycleLabel = document.createElement("p");
        lifecycleLabel.className = "muted";
        lifecycleLabel.textContent = "Lifecycle işlemleri readiness ve mevcut tenant durumuna göre açılır.";

        const lifecycleActions = document.createElement("div");
        lifecycleActions.className = "form-actions";
        const activate = createButton("admin-action-activate", "Aktifleştir", "primary");
        const suspend = createButton("admin-action-suspend", "Askıya Al", "danger-ghost");
        const resume = createButton("admin-action-resume", "Devam Ettir", "primary");
        const archive = createButton("admin-action-archive", "Arşivle", "danger-ghost");
        lifecycleActions.append(activate, suspend, resume, archive);

        const message = document.createElement("p");
        message.id = "admin-action-message";
        message.className = "message";
        message.setAttribute("role", "status");

        panel.append(
            legend,
            summary,
            ownerGrid,
            onboardingActions,
            lifecycleLabel,
            lifecycleActions,
            message
        );
        tenantForm.insertBefore(panel, operationsPanel);

        return Object.freeze({
            panel,
            summary,
            ownerUid,
            firebaseUsers,
            assignOwner,
            securityReview,
            backupDiagnostic,
            activate,
            suspend,
            resume,
            archive,
            message
        });
    }

    const elements = createActionPanel();
    const actionButtons = [
        elements.firebaseUsers,
        elements.assignOwner,
        elements.securityReview,
        elements.backupDiagnostic,
        elements.activate,
        elements.suspend,
        elements.resume,
        elements.archive
    ];
    let busy = false;

    function setMessage(text = "", type = "") {
        elements.message.textContent = text;
        elements.message.classList.remove("error", "success");
        if (type) elements.message.classList.add(type);
    }

    function selectedTenant() {
        if (tenantForm.classList.contains("hidden") || !tenantIdInput.disabled) {
            return null;
        }

        const tenantId = tenantIdInput.value.trim();
        const status = statusBadge.textContent.trim();
        if (tenantId.length < 3 || tenantId.length > 63 ||
            !TENANT_ID_PATTERN.test(tenantId) || !LIFECYCLE_STATUSES.has(status)) {
            return null;
        }

        return Object.freeze({ tenantId, status });
    }

    function setButtonVisible(button, visible) {
        button.classList.toggle("hidden", !visible);
    }

    function syncPanel() {
        const tenant = selectedTenant();
        if (!tenant) {
            elements.panel.classList.add("hidden");
            elements.ownerUid.value = "";
            setMessage();
            return;
        }

        elements.panel.classList.remove("hidden");
        elements.summary.textContent =
            `${tenant.tenantId} · ${tenant.status} · seçili tenant üzerinde kontrollü işlemler`;

        const provisioning = tenant.status === "provisioning";
        elements.ownerUid.disabled = busy || !provisioning;
        elements.assignOwner.disabled = busy || !provisioning;
        elements.securityReview.disabled = busy || !provisioning;
        elements.backupDiagnostic.disabled = busy || !provisioning;
        elements.firebaseUsers.disabled = busy;

        const canActivate = readinessCanActivate.textContent.trim() === "Evet";
        setButtonVisible(elements.activate, tenant.status === "provisioning");
        setButtonVisible(elements.suspend, tenant.status === "active");
        setButtonVisible(elements.resume, tenant.status === "suspended");
        setButtonVisible(elements.archive, tenant.status === "suspended");
        elements.activate.disabled = busy || !canActivate;
        elements.suspend.disabled = busy;
        elements.resume.disabled = busy;
        elements.archive.disabled = busy;
    }

    function setBusy(value) {
        busy = value;
        for (const button of actionButtons) button.disabled = value;
        syncPanel();
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

    function currentTenantOrThrow() {
        const tenant = selectedTenant();
        if (!tenant) throw new Error("Önce geçerli bir işletme seç.");
        return tenant;
    }

    function refreshSelectedTenant() {
        refreshButton.click();
    }

    async function assignInitialOwner() {
        const tenant = currentTenantOrThrow();
        if (tenant.status !== "provisioning") {
            setMessage("Initial owner yalnız provisioning tenant için atanabilir.", "error");
            return;
        }

        const firebaseUid = elements.ownerUid.value.trim();
        if (!firebaseUid || firebaseUid.length > 128 ||
            /[\u0000-\u001f\u007f]/.test(firebaseUid)) {
            setMessage("Firebase User UID geçersiz.", "error");
            return;
        }
        elements.ownerUid.value = "";
        setBusy(true);
        setMessage("Tenant owner atanıyor...");
        try {
            const body = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenant.tenantId)}/admin-bootstrap/initial-owner`,
                {
                    method: "POST",
                    body: JSON.stringify({ firebaseUid })
                }
            );
            const result = body?.bootstrap;
            if (!body?.success || result?.tenantId !== tenant.tenantId ||
                result?.role !== "tenant_owner" || result?.state !== "active" ||
                result?.adminBootstrap !== "verified") {
                throw new Error("Owner atama yanıtı doğrulanamadı.");
            }
            setMessage("Tenant owner başarıyla atandı. Hazırlık durumu yenileniyor.", "success");
            refreshSelectedTenant();
        } catch (error) {
            setMessage(error.message || "Tenant owner atanamadı.", "error");
        } finally {
            setBusy(false);
        }
    }

    function openFirebaseUsers() {
        const projectId = window.PLATFORM_BOOTSTRAP?.firebase?.projectId;
        if (typeof projectId !== "string" || !/^[a-z0-9-]{4,64}$/i.test(projectId)) {
            setMessage("Firebase proje kimliği kullanılamıyor.", "error");
            return;
        }
        window.open(
            `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication/users`,
            "_blank",
            "noopener,noreferrer"
        );
    }

    function openTenantTool(tool) {
        const tenant = currentTenantOrThrow();
        if (tenant.status !== "provisioning") {
            setMessage("Bu onboarding aracı yalnız provisioning tenant için kullanılabilir.", "error");
            return;
        }
        const allowed = new Set(["security-review", "backup-diagnostic"]);
        if (!allowed.has(tool)) return;
        window.location.assign(
            `/admin/${tool}.html?tenantId=${encodeURIComponent(tenant.tenantId)}`
        );
    }

    async function runLifecycle(action) {
        const tenant = currentTenantOrThrow();
        if (!Object.hasOwn(LIFECYCLE_RESULT, action)) return;

        if (action === "activate" && readinessCanActivate.textContent.trim() !== "Evet") {
            setMessage("Tenant henüz aktive edilmeye hazır değil.", "error");
            return;
        }
        if (action === "suspend" &&
            !window.confirm(`${tenant.tenantId} işletmesini askıya almak istiyor musun?`)) {
            return;
        }
        if (action === "archive" &&
            !window.confirm(`${tenant.tenantId} işletmesini arşivlemek istiyor musun? Bu işlem geri alınamaz.`)) {
            return;
        }

        setBusy(true);
        setMessage(`Lifecycle işlemi çalışıyor: ${action}...`);
        try {
            const body = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenant.tenantId)}/lifecycle/${action}`,
                { method: "POST" }
            );
            if (!body?.success || body?.tenant?.tenantId !== tenant.tenantId ||
                body?.tenant?.status !== LIFECYCLE_RESULT[action]) {
                throw new Error("Lifecycle yanıtı doğrulanamadı.");
            }
            setMessage(`Lifecycle tamamlandı: ${body.tenant.status}.`, "success");
            refreshSelectedTenant();
        } catch (error) {
            setMessage(error.message || "Lifecycle işlemi tamamlanamadı.", "error");
        } finally {
            setBusy(false);
        }
    }

    elements.assignOwner.addEventListener("click", assignInitialOwner);
    elements.firebaseUsers.addEventListener("click", openFirebaseUsers);
    elements.securityReview.addEventListener("click", () => openTenantTool("security-review"));
    elements.backupDiagnostic.addEventListener("click", () => openTenantTool("backup-diagnostic"));
    elements.activate.addEventListener("click", () => runLifecycle("activate"));
    elements.suspend.addEventListener("click", () => runLifecycle("suspend"));
    elements.resume.addEventListener("click", () => runLifecycle("resume"));
    elements.archive.addEventListener("click", () => runLifecycle("archive"));

    const observer = new MutationObserver(syncPanel);
    observer.observe(tenantForm, { attributes: true, attributeFilter: ["class"] });
    observer.observe(statusBadge, { childList: true, characterData: true, subtree: true });
    observer.observe(readinessCanActivate, { childList: true, characterData: true, subtree: true });

    syncPanel();
})();
