(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;

    const elements = {
        loginView: document.getElementById("login-view"),
        appView: document.getElementById("app-view"),
        loginForm: document.getElementById("login-form"),
        loginEmail: document.getElementById("login-email"),
        loginPassword: document.getElementById("login-password"),
        loginMessage: document.getElementById("login-message"),
        sessionUser: document.getElementById("session-user"),
        logoutButton: document.getElementById("logout-button"),
        refreshButton: document.getElementById("refresh-button"),
        newTenantButton: document.getElementById("new-tenant-button"),
        tenantSearch: document.getElementById("tenant-search"),
        tenantList: document.getElementById("tenant-list"),
        tenantCount: document.getElementById("tenant-count"),
        emptyState: document.getElementById("empty-state"),
        tenantForm: document.getElementById("tenant-form"),
        formMode: document.getElementById("form-mode"),
        formTitle: document.getElementById("form-title"),
        formMessage: document.getElementById("form-message"),
        statusBadge: document.getElementById("tenant-status-badge"),
        statusField: document.getElementById("status-field"),
        tenantId: document.getElementById("tenant-id"),
        displayName: document.getElementById("display-name"),
        sector: document.getElementById("sector"),
        plan: document.getElementById("plan"),
        status: document.getElementById("status"),
        brandName: document.getElementById("brand-name"),
        phone: document.getElementById("phone"),
        whatsapp: document.getElementById("whatsapp"),
        contactEmail: document.getElementById("contact-email"),
        website: document.getElementById("website"),
        customDomain: document.getElementById("custom-domain"),
        logoUrl: document.getElementById("logo-url"),
        primaryColor: document.getElementById("primary-color"),
        timezone: document.getElementById("timezone"),
        address: document.getElementById("address"),
        featureGrid: document.getElementById("feature-grid"),
        operationsPanel: document.getElementById("operations-panel"),
        operationsHealth: document.getElementById("operations-health"),
        operationsLatency: document.getElementById("operations-latency"),
        operationsUsage: document.getElementById("operations-usage"),
        operationsErrors: document.getElementById("operations-errors"),
        operationsCost: document.getElementById("operations-cost"),
        operationsCostStatus: document.getElementById("operations-cost-status"),
        operationsPlan: document.getElementById("operations-plan"),
        operationsQuota: document.getElementById("operations-quota"),
        operationsBackup: document.getElementById("operations-backup"),
        operationsDrill: document.getElementById("operations-drill"),
        operationsSecurity: document.getElementById("operations-security"),
        operationsSecurityDetail: document.getElementById("operations-security-detail"),
        operationsMessage: document.getElementById("operations-message"),
        saveButton: document.getElementById("save-button"),
        cancelButton: document.getElementById("cancel-button")
    };

    const state = {
        tenants: [],
        selectedTenantId: null,
        mode: "none"
    };

    function setMessage(element, text = "", type = "") {
        element.textContent = text;
        element.classList.remove("error", "success");

        if (type) {
            element.classList.add(type);
        }
    }

    function setBusy(isBusy) {
        elements.saveButton.disabled = isBusy;
        elements.refreshButton.disabled = isBusy;
        elements.newTenantButton.disabled = isBusy;
    }

    function showLogin() {
        elements.loginView.classList.remove("hidden");
        elements.appView.classList.add("hidden");
    }

    function showApp(user) {
        elements.loginView.classList.add("hidden");
        elements.appView.classList.remove("hidden");
        elements.sessionUser.textContent = user.email || user.uid;
    }

    function profileFromForm() {
        return {
            brandName: elements.brandName.value,
            phone: elements.phone.value,
            whatsapp: elements.whatsapp.value,
            email: elements.contactEmail.value,
            website: elements.website.value,
            customDomain: elements.customDomain.value,
            logoUrl: elements.logoUrl.value,
            primaryColor: elements.primaryColor.value,
            timezone: elements.timezone.value,
            address: elements.address.value
        };
    }

    function featuresFromForm() {
        const flags = {};

        for (const input of elements.featureGrid.querySelectorAll("input[data-feature]")) {
            flags[input.dataset.feature] = input.checked;
        }

        return flags;
    }

    function setFeatureFlags(flags = {}) {
        for (const input of elements.featureGrid.querySelectorAll("input[data-feature]")) {
            const key = input.dataset.feature;
            input.checked = Boolean(flags[key]);
        }
    }

    function resetForm() {
        elements.tenantForm.reset();
        elements.plan.value = "starter";
        elements.timezone.value = "Europe/Istanbul";
        setFeatureFlags({ catalog: true, gallery: true });
        setMessage(elements.formMessage);
    }

    function formatNumber(value, maximumFractionDigits = 1) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        return new Intl.NumberFormat("tr-TR", { maximumFractionDigits }).format(number);
    }

    function formatTimestamp(value) {
        if (!value) return "henüz yok";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "bilinmiyor" : date.toLocaleString("tr-TR");
    }

    function renderOverview(overview) {
        const daily = overview.usage?.daily || {};
        const monthly = overview.usage?.monthly || {};
        const cost = overview.cost || {};
        const plan = overview.plan || {};
        const backup = overview.backup || {};
        const security = overview.security || {};

        elements.operationsHealth.textContent = overview.health?.readiness || "unknown";
        elements.operationsLatency.textContent =
            `Ort. ${formatNumber(overview.health?.latencyAverageMs)} ms · maks. ${formatNumber(overview.health?.latencyMaxMs)} ms`;
        elements.operationsUsage.textContent = `${formatNumber(monthly.requestCount, 0)} aylık istek`;
        elements.operationsErrors.textContent =
            `${formatNumber(monthly.errorCount, 0)} hata · bugün ${formatNumber(daily.requestCount, 0)} istek`;
        elements.operationsCost.textContent =
            `${formatNumber(cost.estimatedMonthlyTechnicalCost, 2)} ${cost.currency || ""}`.trim();
        elements.operationsCostStatus.textContent = cost.infraRevenueRatio === null || cost.infraRevenueRatio === undefined
            ? cost.status || "unknown"
            : `${cost.status} · gelirin %${formatNumber(cost.infraRevenueRatio * 100, 2)}`;
        elements.operationsPlan.textContent = `${plan.plan || "default"} · ${plan.limitStatus || "unknown"}`;
        elements.operationsQuota.textContent = plan.softLimit === null || plan.softLimit === undefined
            ? "Soft limit sınırsız"
            : `${formatNumber(plan.usage, 0)} / ${formatNumber(plan.softLimit, 0)} · otomatik kapatma yok`;
        elements.operationsBackup.textContent = `${formatNumber(backup.objectCount, 0)} obje`;
        elements.operationsDrill.textContent =
            `Verify: ${formatTimestamp(backup.verifiedAt)} · ` +
            `Drill: ${backup.restoreDrillStatus || "unknown"}` +
            (backup.restoreDrillAt ? ` · ${formatTimestamp(backup.restoreDrillAt)}` : "");
        elements.operationsSecurity.textContent = `${formatNumber(security.total, 0)} sinyal`;
        elements.operationsSecurityDetail.textContent =
            `En yüksek seviye: ${security.highestSeverity || "none"}`;
        setMessage(elements.operationsMessage);
    }

    async function loadOverview(tenantId) {
        setMessage(elements.operationsMessage, "Operasyon verileri yükleniyor...");

        try {
            const body = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/operations`
            );

            if (state.selectedTenantId === tenantId && body?.overview) {
                renderOverview(body.overview);
            }
        } catch (error) {
            if (state.selectedTenantId === tenantId) {
                setMessage(elements.operationsMessage, error.message, "error");
            }
        }
    }

    function showCreateForm() {
        state.mode = "create";
        state.selectedTenantId = null;
        resetForm();
        elements.emptyState.classList.add("hidden");
        elements.tenantForm.classList.remove("hidden");
        elements.formMode.textContent = "Yeni tenant";
        elements.formTitle.textContent = "Yeni işletme oluştur";
        elements.tenantId.disabled = false;
        elements.sector.disabled = false;
        elements.statusField.classList.add("hidden");
        elements.statusBadge.classList.add("hidden");
        elements.operationsPanel.classList.add("hidden");
        renderTenantList();
        elements.tenantId.focus();
    }

    function showTenant(tenant) {
        state.mode = "edit";
        state.selectedTenantId = tenant.tenantId;
        elements.emptyState.classList.add("hidden");
        elements.tenantForm.classList.remove("hidden");
        elements.formMode.textContent = tenant.tenantId;
        elements.formTitle.textContent = tenant.displayName;
        elements.tenantId.value = tenant.tenantId || "";
        elements.displayName.value = tenant.displayName || "";
        elements.sector.value = tenant.sector || "";
        elements.plan.value = tenant.plan || "starter";
        elements.status.value = tenant.status || "provisioning";
        elements.tenantId.disabled = true;
        elements.sector.disabled = true;
        elements.statusField.classList.remove("hidden");
        elements.statusBadge.classList.remove("hidden");
        elements.statusBadge.textContent = tenant.status || "provisioning";
        elements.operationsPanel.classList.remove("hidden");

        const profile = tenant.profile || {};
        elements.brandName.value = profile.brandName || "";
        elements.phone.value = profile.phone || "";
        elements.whatsapp.value = profile.whatsapp || "";
        elements.contactEmail.value = profile.email || "";
        elements.website.value = profile.website || "";
        elements.customDomain.value = profile.customDomain || "";
        elements.logoUrl.value = profile.logoUrl || "";
        elements.primaryColor.value = profile.primaryColor || "";
        elements.timezone.value = profile.timezone || "Europe/Istanbul";
        elements.address.value = profile.address || "";
        setFeatureFlags(tenant.features || {});
        setMessage(elements.formMessage);
        renderTenantList();
        loadOverview(tenant.tenantId);
    }

    function showEmpty() {
        state.mode = "none";
        state.selectedTenantId = null;
        elements.tenantForm.classList.add("hidden");
        elements.operationsPanel.classList.add("hidden");
        elements.emptyState.classList.remove("hidden");
        renderTenantList();
    }

    function renderTenantList() {
        const query = elements.tenantSearch.value.trim().toLocaleLowerCase("tr-TR");
        const tenants = state.tenants.filter(tenant => {
            if (!query) {
                return true;
            }

            return [tenant.displayName, tenant.tenantId, tenant.sector]
                .some(value => String(value || "").toLocaleLowerCase("tr-TR").includes(query));
        });

        elements.tenantList.replaceChildren();
        elements.tenantCount.textContent = `${state.tenants.length} işletme`;

        for (const tenant of tenants) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "tenant-card";

            if (tenant.tenantId === state.selectedTenantId) {
                button.classList.add("active");
            }

            const name = document.createElement("strong");
            name.textContent = tenant.displayName;
            const meta = document.createElement("span");
            meta.textContent = `${tenant.tenantId} • ${tenant.sector} • ${tenant.status}`;
            button.append(name, meta);
            button.addEventListener("click", () => showTenant(tenant));
            elements.tenantList.append(button);
        }

        if (tenants.length === 0) {
            const empty = document.createElement("p");
            empty.className = "muted";
            empty.textContent = query ? "Aramayla eşleşen işletme yok." : "Henüz işletme yok.";
            elements.tenantList.append(empty);
        }
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;

        if (!user) {
            throw new Error("Oturum bulunamadı.");
        }

        return user.getIdToken();
    }

    async function apiRequest(path, options = {}) {
        const token = await getIdToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);

        if (options.body && !headers.has("Content-Type")) {
            headers.set("Content-Type", "application/json");
        }

        const response = await fetch(path, {
            ...options,
            headers
        });

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

    async function loadTenants() {
        setBusy(true);

        try {
            const body = await apiRequest("/api/platform/tenants?limit=200");
            state.tenants = Array.isArray(body.tenants) ? body.tenants : [];
            renderTenantList();

            if (state.selectedTenantId) {
                const selected = state.tenants.find(item => item.tenantId === state.selectedTenantId);
                if (selected) {
                    showTenant(selected);
                } else {
                    showEmpty();
                }
            }
        } catch (error) {
            if (error.status === 403) {
                setMessage(elements.loginMessage, "Bu hesap Platform Admin yetkisine sahip değil.", "error");
                await firebase.auth().signOut();
                return;
            }

            setMessage(elements.formMessage, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    async function saveTenant(event) {
        event.preventDefault();
        setMessage(elements.formMessage);
        setBusy(true);

        try {
            if (state.mode === "create") {
                const payload = {
                    tenantId: elements.tenantId.value,
                    displayName: elements.displayName.value,
                    sector: elements.sector.value,
                    plan: elements.plan.value,
                    features: featuresFromForm(),
                    profile: profileFromForm()
                };
                const body = await apiRequest("/api/platform/tenants", {
                    method: "POST",
                    body: JSON.stringify(payload)
                });

                state.tenants.unshift(body.tenant);
                showTenant(body.tenant);
                setMessage(elements.formMessage, "İşletme oluşturuldu.", "success");
            } else if (state.mode === "edit") {
                const payload = {
                    displayName: elements.displayName.value,
                    plan: elements.plan.value,
                    status: elements.status.value,
                    features: featuresFromForm(),
                    profile: profileFromForm()
                };
                const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.selectedTenantId)}`, {
                    method: "PATCH",
                    body: JSON.stringify(payload)
                });

                const index = state.tenants.findIndex(item => item.tenantId === body.tenant.tenantId);
                if (index !== -1) {
                    state.tenants[index] = body.tenant;
                }
                showTenant(body.tenant);
                setMessage(elements.formMessage, "İşletme güncellendi.", "success");
            }
        } catch (error) {
            setMessage(elements.formMessage, error.message, "error");
        } finally {
            setBusy(false);
        }
    }

    if (!firebaseConfig) {
        setMessage(
            elements.loginMessage,
            "Platform Firebase web config henüz tanımlı değil. Production kurulumu tamamlanmalı.",
            "error"
        );
        elements.loginForm.querySelector("button[type=submit]").disabled = true;
        return;
    }

    firebase.initializeApp(firebaseConfig);

    elements.loginForm.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage(elements.loginMessage);

        try {
            await firebase.auth().signInWithEmailAndPassword(
                elements.loginEmail.value.trim(),
                elements.loginPassword.value
            );
        } catch {
            setMessage(elements.loginMessage, "Giriş başarısız. Bilgileri kontrol et.", "error");
        }
    });

    elements.logoutButton.addEventListener("click", () => firebase.auth().signOut());
    elements.refreshButton.addEventListener("click", loadTenants);
    elements.newTenantButton.addEventListener("click", showCreateForm);
    elements.cancelButton.addEventListener("click", showEmpty);
    elements.tenantSearch.addEventListener("input", renderTenantList);
    elements.tenantForm.addEventListener("submit", saveTenant);

    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            state.tenants = [];
            showEmpty();
            showLogin();
            return;
        }

        showApp(user);
        await loadTenants();
    });
})();
