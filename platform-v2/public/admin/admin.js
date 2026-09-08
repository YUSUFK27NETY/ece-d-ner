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
        operationsPlacement: document.getElementById("operations-placement"),
        operationsPlacementDetail: document.getElementById("operations-placement-detail"),
        operationsCapacity: document.getElementById("operations-capacity"),
        operationsSlo: document.getElementById("operations-slo"),
        operationsMigration: document.getElementById("operations-migration"),
        operationsMigrationDetail: document.getElementById("operations-migration-detail"),
        operationsQueue: document.getElementById("operations-queue"),
        operationsWorker: document.getElementById("operations-worker"),
        operationsCache: document.getElementById("operations-cache"),
        operationsCacheDetail: document.getElementById("operations-cache-detail"),
        operationsRelease: document.getElementById("operations-release"),
        operationsReleaseDetail: document.getElementById("operations-release-detail"),
        operationsResilience: document.getElementById("operations-resilience"),
        operationsResilienceDetail: document.getElementById("operations-resilience-detail"),
        operationsMessage: document.getElementById("operations-message"),
        customerReadinessPanel: document.getElementById("customer-readiness-panel"),
        customerReadinessMessage: document.getElementById("customer-readiness-message"),
        customerReadinessOverall: document.getElementById("customer-readiness-overall"),
        customerReadinessCanActivate: document.getElementById("customer-readiness-can-activate"),
        customerReadinessLifecycle: document.getElementById("customer-readiness-lifecycle"),
        customerReadinessEvaluatedAt: document.getElementById("customer-readiness-evaluated-at"),
        customerReadinessCards: document.getElementById("customer-readiness-cards"),
        planPreviewPanel: document.getElementById("plan-preview-panel"),
        planPreviewMessage: document.getElementById("plan-preview-message"),
        planPreviewTarget: document.getElementById("plan-preview-target"),
        planPreviewCurrent: document.getElementById("plan-preview-current"),
        planPreviewCurrentPolicy: document.getElementById("plan-preview-current-policy"),
        planPreviewRequested: document.getElementById("plan-preview-requested"),
        planPreviewAutomaticApply: document.getElementById("plan-preview-automatic-apply"),
        planPreviewFeatureSummary: document.getElementById("plan-preview-feature-summary"),
        planPreviewFeatures: document.getElementById("plan-preview-features"),
        planPreviewLimits: document.getElementById("plan-preview-limits"),
        securityAlertsPanel: document.getElementById("security-alerts-panel"),
        tenantSecurityAlerts: document.getElementById("tenant-security-alerts"),
        tenantSecurityAlertsMessage: document.getElementById("tenant-security-alerts-message"),
        platformSecurityAlerts: document.getElementById("platform-security-alerts"),
        platformSecurityAlertsMessage: document.getElementById("platform-security-alerts-message"),
        securityPosturePanel: document.getElementById("security-posture-panel"),
        securityPostureMessage: document.getElementById("security-posture-message"),
        securityPostureCards: document.getElementById("security-posture-cards"),
        saveButton: document.getElementById("save-button"),
        cancelButton: document.getElementById("cancel-button")
    };

    const state = {
        tenants: [],
        selectedTenantId: null,
        mode: "none",
        tenantAlertRequestVersion: 0,
        platformAlertRequestVersion: 0,
        securityPostureRequestVersion: 0,
        customerReadinessRequestVersion: 0,
        planCatalogRequestVersion: 0,
        planPreviewRequestVersion: 0,
        configuredPlanIds: []
    };

    const ALERT_SEVERITY_PRESENTATION = Object.freeze({
        info: Object.freeze({ label: "info", className: "severity-info" }),
        warning: Object.freeze({ label: "warning", className: "severity-warning" }),
        high: Object.freeze({ label: "high", className: "severity-high" }),
        critical: Object.freeze({ label: "critical", className: "severity-critical" })
    });

    const SECURITY_POSTURE_SOURCE_PRESENTATION = Object.freeze({
        active: Object.freeze({ label: "Aktif", className: "posture-state-active", isActive: true }),
        durable_runtime: Object.freeze({ label: "Aktif / kalıcı runtime", className: "posture-state-active", isActive: true }),
        contract_only: Object.freeze({ label: "Contract hazır", className: "posture-state-contract", isActive: false }),
        not_wired: Object.freeze({ label: "Runtime'a bağlı değil", className: "posture-state-not-wired", isActive: false }),
        external_verification_required: Object.freeze({ label: "Harici doğrulama gerekli", className: "posture-state-external", isActive: false }),
        unavailable: Object.freeze({ label: "Kullanılamıyor", className: "posture-state-unavailable", isActive: false })
    });
    const SECURITY_POSTURE_OVERALL_PRESENTATION = Object.freeze({
        partial_visibility: Object.freeze({ label: "Kısmi görünürlük", className: "posture-status-partial" }),
        degraded: Object.freeze({ label: "Azalmış görünürlük", className: "posture-status-degraded" }),
        healthy: Object.freeze({ label: "Sağlıklı", className: "posture-status-healthy" }),
        unknown: Object.freeze({ label: "Bilinmiyor", className: "posture-status-unknown" })
    });
    const SECURITY_POSTURE_UNKNOWN_SOURCE = Object.freeze({
        label: "Bilinmiyor",
        className: "posture-state-unavailable",
        isActive: false
    });
    const SECURITY_POSTURE_VALUE_LABELS = Object.freeze({
        ready: "Hazır",
        contract_ready: "Contract hazır",
        configured: "Yapılandırılmış",
        not_detected: "Algılanmadı"
    });
    const CUSTOMER_READINESS_STATUS_PRESENTATION = Object.freeze({
        ready: Object.freeze({ label: "Hazır", className: "readiness-state-ready" }),
        pending: Object.freeze({ label: "Bekliyor", className: "readiness-state-pending" }),
        blocked: Object.freeze({ label: "Engelli", className: "readiness-state-blocked" }),
        unavailable: Object.freeze({ label: "Kullanılamıyor", className: "readiness-state-unavailable" })
    });
    const CUSTOMER_READINESS_UNKNOWN_STATUS = Object.freeze({
        label: "Bilinmiyor",
        className: "readiness-state-unknown"
    });
    const CUSTOMER_READINESS_LIFECYCLE_LABELS = Object.freeze({
        provisioning: "Provisioning",
        active: "Active",
        suspended: "Suspended",
        archived: "Archived"
    });
    const CUSTOMER_READINESS_SOURCES = Object.freeze({
        profile: Object.freeze({
            title: "Profile",
            required: true,
            codes: Object.freeze(["PROFILE_INCOMPLETE", "PROFILE_INVALID", "PROFILE_UNAVAILABLE"])
        }),
        health: Object.freeze({
            title: "Health",
            required: true,
            codes: Object.freeze(["HEALTH_CHECK_PENDING", "HEALTH_CHECK_FAILED", "HEALTH_UNAVAILABLE"])
        }),
        plan: Object.freeze({
            title: "Plan",
            required: true,
            codes: Object.freeze(["PLAN_NOT_CONFIGURED", "PLAN_UNSUPPORTED", "PLAN_UNAVAILABLE"])
        }),
        adminBootstrap: Object.freeze({
            title: "Tenant Admin Bootstrap",
            required: true,
            codes: Object.freeze(["ADMIN_BOOTSTRAP_PENDING", "ADMIN_BOOTSTRAP_BLOCKED", "ADMIN_BOOTSTRAP_UNAVAILABLE"])
        }),
        backup: Object.freeze({
            title: "Backup/DR",
            required: true,
            codes: Object.freeze(["BACKUP_PENDING", "BACKUP_NOT_VERIFIED", "BACKUP_UNAVAILABLE"])
        }),
        security: Object.freeze({
            title: "Security",
            required: true,
            codes: Object.freeze(["SECURITY_REVIEW_PENDING", "SECURITY_BLOCKED", "SECURITY_UNAVAILABLE"])
        }),
        domain: Object.freeze({
            title: "Domain",
            required: false,
            codes: Object.freeze(["DOMAIN_NOT_CONFIGURED", "DOMAIN_PENDING", "DOMAIN_VERIFICATION_FAILED", "DOMAIN_UNAVAILABLE"])
        })
    });
    const PLAN_PREVIEW_FEATURES = Object.freeze({
        catalog: "Katalog",
        orders: "Sipariş",
        appointments: "Randevu",
        reservations: "Rezervasyon",
        whatsapp: "WhatsApp",
        inventory: "Stok",
        quotes: "Teklif",
        fleet: "Filo",
        gallery: "Galeri"
    });
    const PLAN_PREVIEW_CHANGE_PRESENTATION = Object.freeze({
        gained: Object.freeze({ label: "Kazanım", className: "plan-change-gained" }),
        lost: Object.freeze({ label: "Kayıp", className: "plan-change-lost" }),
        unchanged: Object.freeze({ label: "Değişmedi", className: "plan-change-unchanged" })
    });
    const PLAN_PREVIEW_LIMITS = Object.freeze({
        softRequestLimit: "Soft istek limiti",
        warningThreshold: "Uyarı eşiği",
        dedicatedReviewThreshold: "Dedicated review eşiği"
    });

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

    function safeAlertString(value, fallback = "—") {
        return typeof value === "string" && value.length > 0 ? value : fallback;
    }

    function projectAlertForDisplay(alert) {
        if (!alert || typeof alert !== "object" || Array.isArray(alert) ||
            Object.getPrototypeOf(alert) !== Object.prototype ||
            typeof alert.eventType !== "string" || typeof alert.reasonCode !== "string" ||
            typeof alert.correlationId !== "string" ||
            !Number.isSafeInteger(alert.eventCount) || alert.eventCount < 1) {
            return null;
        }

        const severity = Object.hasOwn(ALERT_SEVERITY_PRESENTATION, alert.severity)
            ? ALERT_SEVERITY_PRESENTATION[alert.severity]
            : Object.freeze({ label: "unknown", className: "severity-unknown" });

        return Object.freeze({
            severityLabel: severity.label,
            severityClass: severity.className,
            eventType: safeAlertString(alert.eventType),
            reasonCode: safeAlertString(alert.reasonCode),
            operation: safeAlertString(alert.operation),
            eventCount: alert.eventCount,
            firstSeenAt: safeAlertString(alert.firstSeenAt),
            lastSeenAt: safeAlertString(alert.lastSeenAt),
            correlationId: safeAlertString(alert.correlationId),
            actorId: safeAlertString(alert.actorId, ""),
            source: safeAlertString(alert.source, "")
        });
    }

    function appendAlertMeta(container, label, value) {
        const item = document.createElement("div");
        item.className = "security-alert-meta-item";
        const name = document.createElement("strong");
        name.textContent = label;
        const content = document.createElement("span");
        content.textContent = value;
        item.append(name, content);
        container.append(item);
    }

    function renderSecurityAlertList(container, message, alerts, emptyMessage) {
        container.replaceChildren();
        const projected = Array.isArray(alerts)
            ? alerts.map(projectAlertForDisplay).filter(Boolean)
            : [];

        if (projected.length === 0) {
            setMessage(
                message,
                Array.isArray(alerts) && alerts.length > 0
                    ? "Geçersiz güvenlik kaydı."
                    : emptyMessage,
                Array.isArray(alerts) && alerts.length > 0 ? "error" : ""
            );
            return;
        }

        setMessage(message);
        for (const alert of projected) {
            const card = document.createElement("article");
            card.className = "security-alert-card";
            const header = document.createElement("div");
            header.className = "security-alert-header";
            const badge = document.createElement("span");
            badge.className = "security-alert-badge";
            badge.classList.add(alert.severityClass);
            badge.textContent = alert.severityLabel;
            const eventType = document.createElement("strong");
            eventType.textContent = alert.eventType;
            header.append(badge, eventType);

            const reason = document.createElement("strong");
            reason.textContent = alert.reasonCode;
            const meta = document.createElement("div");
            meta.className = "security-alert-meta";
            appendAlertMeta(meta, "Operasyon", alert.operation);
            appendAlertMeta(meta, "Olay sayısı", String(alert.eventCount));
            appendAlertMeta(meta, "İlk görülme", formatTimestamp(alert.firstSeenAt));
            appendAlertMeta(meta, "Son görülme", formatTimestamp(alert.lastSeenAt));
            appendAlertMeta(meta, "Korelasyon", alert.correlationId);
            if (alert.actorId) appendAlertMeta(meta, "Actor", alert.actorId);
            if (alert.source) appendAlertMeta(meta, "Kaynak", alert.source);

            card.append(header, reason, meta);
            container.append(card);
        }
    }

    async function loadTenantSecurityAlerts(tenantId) {
        const requestVersion = ++state.tenantAlertRequestVersion;
        elements.tenantSecurityAlerts.replaceChildren();
        setMessage(
            elements.tenantSecurityAlertsMessage,
            "Tenant güvenlik uyarıları yükleniyor..."
        );

        try {
            const response = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/security-alerts?limit=20`
            );
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.tenantAlertRequestVersion) return;
            renderSecurityAlertList(
                elements.tenantSecurityAlerts,
                elements.tenantSecurityAlertsMessage,
                response?.alerts,
                "Bu tenant için güvenlik uyarısı yok."
            );
        } catch {
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.tenantAlertRequestVersion) return;
            elements.tenantSecurityAlerts.replaceChildren();
            setMessage(
                elements.tenantSecurityAlertsMessage,
                "Güvenlik uyarıları yüklenemedi.",
                "error"
            );
        }
    }

    async function loadPlatformSecurityAlerts() {
        const requestVersion = ++state.platformAlertRequestVersion;
        elements.platformSecurityAlerts.replaceChildren();
        setMessage(
            elements.platformSecurityAlertsMessage,
            "Platform güvenlik uyarıları yükleniyor..."
        );

        try {
            const response = await apiRequest("/api/platform/security-alerts?limit=20");
            if (requestVersion !== state.platformAlertRequestVersion) return;
            renderSecurityAlertList(
                elements.platformSecurityAlerts,
                elements.platformSecurityAlertsMessage,
                response?.alerts,
                "Platform güvenlik uyarısı yok."
            );
        } catch {
            if (requestVersion !== state.platformAlertRequestVersion) return;
            elements.platformSecurityAlerts.replaceChildren();
            setMessage(
                elements.platformSecurityAlertsMessage,
                "Güvenlik uyarıları yüklenemedi.",
                "error"
            );
        }
    }

    function isPlainReadinessRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function readReadinessValue(record, key) {
        if (!isPlainReadinessRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined;
    }

    function projectReadinessTimestamp(value) {
        if (value === null) return null;
        if (typeof value !== "string") return undefined;
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.toISOString() === value
            ? value
            : undefined;
    }

    function projectReadinessCheckForDisplay(source, check) {
        if (!isPlainReadinessRecord(check)) return null;
        const policy = CUSTOMER_READINESS_SOURCES[source];
        const status = readReadinessValue(check, "status");
        const code = readReadinessValue(check, "code");
        const observedAt = projectReadinessTimestamp(
            readReadinessValue(check, "observedAt")
        );
        if (!policy || !Object.hasOwn(CUSTOMER_READINESS_STATUS_PRESENTATION, status) ||
            (code !== null && !policy.codes.includes(code)) ||
            observedAt === undefined) {
            return null;
        }

        return Object.freeze({
            status,
            presentation: CUSTOMER_READINESS_STATUS_PRESENTATION[status],
            code,
            observedAt
        });
    }

    function aggregateReadinessChecks(checks) {
        const requiredStatuses = [];
        for (const source of Object.keys(CUSTOMER_READINESS_SOURCES)) {
            if (CUSTOMER_READINESS_SOURCES[source].required) {
                requiredStatuses.push(checks[source].status);
            }
        }
        for (const status of ["blocked", "unavailable", "pending"]) {
            if (requiredStatuses.includes(status)) return status;
        }
        return "ready";
    }

    function projectCustomerReadinessForDisplay(readiness, selectedTenantId) {
        if (!isPlainReadinessRecord(readiness) ||
            readReadinessValue(readiness, "tenantId") !== selectedTenantId) {
            return null;
        }

        const lifecycleStatus = readReadinessValue(readiness, "lifecycleStatus");
        const activationReadiness = readReadinessValue(readiness, "activationReadiness");
        const canActivate = readReadinessValue(readiness, "canActivate");
        const evaluatedAt = projectReadinessTimestamp(
            readReadinessValue(readiness, "evaluatedAt")
        );
        const rawChecks = readReadinessValue(readiness, "checks");
        if (!Object.hasOwn(CUSTOMER_READINESS_LIFECYCLE_LABELS, lifecycleStatus) ||
            !Object.hasOwn(CUSTOMER_READINESS_STATUS_PRESENTATION, activationReadiness) ||
            typeof canActivate !== "boolean" || evaluatedAt === undefined ||
            evaluatedAt === null || !isPlainReadinessRecord(rawChecks)) {
            return null;
        }

        const checks = {};
        for (const source of Object.keys(CUSTOMER_READINESS_SOURCES)) {
            const check = projectReadinessCheckForDisplay(
                source,
                readReadinessValue(rawChecks, source)
            );
            if (!check) return null;
            checks[source] = check;
        }

        const aggregate = aggregateReadinessChecks(checks);
        const expectedCanActivate = aggregate === "ready" &&
            lifecycleStatus === "provisioning";
        if (activationReadiness !== aggregate || canActivate !== expectedCanActivate) {
            return null;
        }

        return Object.freeze({
            lifecycleLabel: CUSTOMER_READINESS_LIFECYCLE_LABELS[lifecycleStatus],
            activation: CUSTOMER_READINESS_STATUS_PRESENTATION[activationReadiness],
            canActivate,
            evaluatedAt,
            checks: Object.freeze(checks)
        });
    }

    function resetCustomerReadiness() {
        elements.customerReadinessOverall.className = "";
        elements.customerReadinessOverall.textContent = "—";
        elements.customerReadinessCanActivate.textContent = "—";
        elements.customerReadinessLifecycle.textContent = "—";
        elements.customerReadinessEvaluatedAt.textContent = "—";
        elements.customerReadinessCards.replaceChildren();
    }

    function appendCustomerReadinessCard(title, check) {
        const article = document.createElement("article");
        article.className = "metric-card customer-readiness-card";
        const heading = document.createElement("span");
        heading.textContent = title;
        const status = document.createElement("span");
        status.className = "readiness-state";
        status.classList.add(check.presentation.className);
        status.textContent = check.presentation.label;
        const code = document.createElement("strong");
        code.textContent = check.code || "Kod yok";
        const observedAt = document.createElement("small");
        observedAt.textContent = check.observedAt
            ? `Gözlem: ${formatTimestamp(check.observedAt)}`
            : "Gözlem zamanı kullanılamıyor";
        article.append(heading, status, code, observedAt);
        elements.customerReadinessCards.append(article);
    }

    function renderCustomerReadiness(readiness, tenantId) {
        const display = projectCustomerReadinessForDisplay(readiness, tenantId);
        resetCustomerReadiness();
        if (!display) return false;

        elements.customerReadinessOverall.className = "readiness-state";
        elements.customerReadinessOverall.classList.add(display.activation.className);
        elements.customerReadinessOverall.textContent = display.activation.label;
        elements.customerReadinessCanActivate.textContent = display.canActivate
            ? "Evet"
            : "Hayır";
        elements.customerReadinessLifecycle.textContent = display.lifecycleLabel;
        elements.customerReadinessEvaluatedAt.textContent =
            `Değerlendirme: ${formatTimestamp(display.evaluatedAt)}`;
        for (const source of Object.keys(CUSTOMER_READINESS_SOURCES)) {
            appendCustomerReadinessCard(
                CUSTOMER_READINESS_SOURCES[source].title,
                display.checks[source]
            );
        }
        return true;
    }

    async function loadCustomerReadiness(tenantId) {
        const requestVersion = ++state.customerReadinessRequestVersion;
        resetCustomerReadiness();
        setMessage(elements.customerReadinessMessage, "Müşteri hazırlığı yükleniyor...");

        try {
            const response = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/readiness`
            );
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.customerReadinessRequestVersion) return;
            if (!renderCustomerReadiness(response?.readiness, tenantId)) {
                setMessage(
                    elements.customerReadinessMessage,
                    "Müşteri hazırlığı kullanılamıyor.",
                    "error"
                );
                return;
            }
            setMessage(elements.customerReadinessMessage);
        } catch {
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.customerReadinessRequestVersion) return;
            resetCustomerReadiness();
            setMessage(
                elements.customerReadinessMessage,
                "Müşteri hazırlığı yüklenemedi.",
                "error"
            );
        }
    }

    function isPlainPlanPreviewRecord(value) {
        return Boolean(value) && typeof value === "object" &&
            !Array.isArray(value) &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function readPlanPreviewValue(record, key) {
        if (!isPlainPlanPreviewRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined;
    }

    function projectPlanId(value) {
        return typeof value === "string" &&
            /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)
            ? value
            : null;
    }

    function projectPlanCatalogForDisplay(catalog) {
        if (!isPlainPlanPreviewRecord(catalog) ||
            readPlanPreviewValue(catalog, "schemaVersion") !== 1) {
            return null;
        }

        const rawPlanIds = readPlanPreviewValue(catalog, "planIds");
        if (!Array.isArray(rawPlanIds) ||
            Object.getPrototypeOf(rawPlanIds) !== Array.prototype ||
            rawPlanIds.length === 0) {
            return null;
        }

        const planIds = [];
        for (const rawPlanId of rawPlanIds) {
            const planId = projectPlanId(rawPlanId);
            if (!planId || planIds.includes(planId)) return null;
            planIds.push(planId);
        }
        if (planIds.join("\n") !== planIds.slice().sort().join("\n")) {
            return null;
        }

        return Object.freeze({ planIds: Object.freeze(planIds) });
    }

    function projectPlanPreviewFeatureForDisplay(value) {
        if (!isPlainPlanPreviewRecord(value)) return null;

        const feature = readPlanPreviewValue(value, "feature");
        const tenantEnabled = readPlanPreviewValue(value, "tenantEnabled");
        const currentPlanAllowed = readPlanPreviewValue(
            value,
            "currentPlanAllowed"
        );
        const targetPlanAllowed = readPlanPreviewValue(
            value,
            "targetPlanAllowed"
        );
        const currentEffective = readPlanPreviewValue(
            value,
            "currentEffective"
        );
        const targetEffective = readPlanPreviewValue(value, "targetEffective");
        const change = readPlanPreviewValue(value, "change");
        if (!Object.hasOwn(PLAN_PREVIEW_FEATURES, feature) ||
            [
                tenantEnabled,
                currentPlanAllowed,
                targetPlanAllowed,
                currentEffective,
                targetEffective
            ].some(item => typeof item !== "boolean") ||
            currentEffective !== (tenantEnabled && currentPlanAllowed) ||
            targetEffective !== (tenantEnabled && targetPlanAllowed) ||
            !Object.hasOwn(PLAN_PREVIEW_CHANGE_PRESENTATION, change)) {
            return null;
        }

        const expectedChange = !currentEffective && targetEffective
            ? "gained"
            : currentEffective && !targetEffective ? "lost" : "unchanged";
        if (change !== expectedChange) return null;

        return Object.freeze({
            feature,
            tenantEnabled,
            currentPlanAllowed,
            targetPlanAllowed,
            currentEffective,
            targetEffective,
            presentation: PLAN_PREVIEW_CHANGE_PRESENTATION[change]
        });
    }

    function projectPlanPreviewLimitValue(key, value) {
        if (key === "softRequestLimit") {
            return value === null ||
                (Number.isSafeInteger(value) && value >= 1)
                ? value
                : undefined;
        }
        if (key === "warningThreshold") {
            return Number.isFinite(value) && value > 0 && value <= 1
                ? value
                : undefined;
        }
        if (key === "dedicatedReviewThreshold") {
            return Number.isFinite(value) && value >= 1 && value <= 100
                ? value
                : undefined;
        }
        return undefined;
    }

    function derivePlanPreviewLimitChange(current, target) {
        const currentValue = current === null
            ? Number.POSITIVE_INFINITY
            : current;
        const targetValue = target === null
            ? Number.POSITIVE_INFINITY
            : target;
        if (targetValue > currentValue) return "increased";
        if (targetValue < currentValue) return "decreased";
        return "unchanged";
    }

    function projectPlanPreviewLimitForDisplay(key, value) {
        if (!isPlainPlanPreviewRecord(value)) return null;
        const current = projectPlanPreviewLimitValue(
            key,
            readPlanPreviewValue(value, "current")
        );
        const target = projectPlanPreviewLimitValue(
            key,
            readPlanPreviewValue(value, "target")
        );
        const change = readPlanPreviewValue(value, "change");
        if (current === undefined || target === undefined ||
            !["increased", "decreased", "unchanged"].includes(change) ||
            change !== derivePlanPreviewLimitChange(current, target)) {
            return null;
        }

        return Object.freeze({ current, target, change });
    }

    function projectCommercialPlanPreviewForDisplay(
        preview,
        selectedTenantId,
        selectedTargetPlan,
        configuredPlanIds
    ) {
        if (!isPlainPlanPreviewRecord(preview) ||
            readPlanPreviewValue(preview, "schemaVersion") !== 1 ||
            readPlanPreviewValue(preview, "tenantId") !== selectedTenantId) {
            return null;
        }

        const currentPlan = projectPlanId(
            readPlanPreviewValue(preview, "currentPlan")
        );
        const targetPlan = projectPlanId(
            readPlanPreviewValue(preview, "targetPlan")
        );
        const currentPlanConfigured = readPlanPreviewValue(
            preview,
            "currentPlanConfigured"
        );
        const currentUsesDefaultPolicyFallback = readPlanPreviewValue(
            preview,
            "currentUsesDefaultPolicyFallback"
        );
        const automaticApply = readPlanPreviewValue(preview, "automaticApply");
        const rawFeatures = readPlanPreviewValue(preview, "features");
        const rawLimits = readPlanPreviewValue(preview, "limits");
        if (!currentPlan || targetPlan !== selectedTargetPlan ||
            !configuredPlanIds.includes(targetPlan) ||
            typeof currentPlanConfigured !== "boolean" ||
            typeof currentUsesDefaultPolicyFallback !== "boolean" ||
            automaticApply !== false ||
            currentPlanConfigured !== configuredPlanIds.includes(currentPlan) ||
            currentUsesDefaultPolicyFallback === currentPlanConfigured ||
            !Array.isArray(rawFeatures) ||
            rawFeatures.length !== Object.keys(PLAN_PREVIEW_FEATURES).length ||
            !isPlainPlanPreviewRecord(rawLimits)) {
            return null;
        }

        const features = {};
        for (const rawFeature of rawFeatures) {
            const item = projectPlanPreviewFeatureForDisplay(rawFeature);
            if (!item || Object.hasOwn(features, item.feature)) return null;
            features[item.feature] = item;
        }
        if (Object.keys(features).length !==
            Object.keys(PLAN_PREVIEW_FEATURES).length) {
            return null;
        }

        const limits = {};
        for (const key of Object.keys(PLAN_PREVIEW_LIMITS)) {
            const item = projectPlanPreviewLimitForDisplay(
                key,
                readPlanPreviewValue(rawLimits, key)
            );
            if (!item) return null;
            limits[key] = item;
        }

        return Object.freeze({
            currentPlan,
            targetPlan,
            currentPlanConfigured,
            currentUsesDefaultPolicyFallback,
            automaticApply,
            features: Object.freeze(features),
            limits: Object.freeze(limits)
        });
    }

    function resetCommercialPlanPreview() {
        elements.planPreviewCurrent.textContent = "—";
        elements.planPreviewCurrentPolicy.textContent = "—";
        elements.planPreviewRequested.textContent = "—";
        elements.planPreviewAutomaticApply.textContent = "—";
        elements.planPreviewFeatureSummary.textContent = "—";
        elements.planPreviewFeatures.replaceChildren();
        elements.planPreviewLimits.replaceChildren();
    }

    function resetPlanPreviewTarget() {
        elements.planPreviewTarget.replaceChildren();
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "Plan kataloğu kullanılamıyor";
        elements.planPreviewTarget.append(option);
        elements.planPreviewTarget["dis" + "abled"] = true;
    }

    function populatePlanPreviewTarget(planIds, currentPlan) {
        elements.planPreviewTarget.replaceChildren();
        for (const planId of planIds) {
            const option = document.createElement("option");
            option.value = planId;
            option.textContent = planId;
            elements.planPreviewTarget.append(option);
        }
        elements.planPreviewTarget.value = planIds.includes(currentPlan)
            ? currentPlan
            : planIds[0];
        elements.planPreviewTarget["dis" + "abled"] = false;
        return elements.planPreviewTarget.value;
    }

    function appendPlanPreviewFeatureCard(title, item) {
        const article = document.createElement("article");
        article.className = "metric-card plan-preview-card";
        const heading = document.createElement("span");
        heading.textContent = title;
        const change = document.createElement("span");
        change.className = "plan-change";
        change.classList.add(item.presentation.className);
        change.textContent = item.presentation.label;
        const effective = document.createElement("strong");
        effective.textContent =
            `Effective: ${item.currentEffective ? "açık" : "kapalı"} → ` +
            `${item.targetEffective ? "açık" : "kapalı"}`;
        const detail = document.createElement("small");
        detail.textContent =
            `Tenant flag: ${item.tenantEnabled ? "açık" : "kapalı"} · ` +
            `Plan izni: ${item.currentPlanAllowed ? "var" : "yok"} → ` +
            `${item.targetPlanAllowed ? "var" : "yok"}`;
        article.append(heading, change, effective, detail);
        elements.planPreviewFeatures.append(article);
    }

    function formatPlanPreviewLimit(key, value) {
        if (value === null) return "Sınırsız";
        return key === "softRequestLimit"
            ? formatNumber(value, 0)
            : formatNumber(value, 2);
    }

    function appendPlanPreviewLimitCard(key, item) {
        const article = document.createElement("article");
        article.className = "metric-card plan-preview-card";
        const heading = document.createElement("span");
        heading.textContent = PLAN_PREVIEW_LIMITS[key];
        const change = document.createElement("span");
        change.className = "plan-change";
        change.classList.add(
            item.change === "unchanged"
                ? "plan-change-unchanged"
                : item.change === "increased"
                    ? "plan-change-gained"
                    : "plan-change-lost"
        );
        change.textContent = item.change === "unchanged"
            ? "Değişmedi"
            : item.change === "increased" ? "Arttı" : "Azaldı";
        const values = document.createElement("strong");
        values.textContent =
            `${formatPlanPreviewLimit(key, item.current)} → ` +
            formatPlanPreviewLimit(key, item.target);
        const detail = document.createElement("small");
        detail.textContent = "Teknik policy karşılaştırması";
        article.append(heading, change, values, detail);
        elements.planPreviewLimits.append(article);
    }

    function renderCommercialPlanPreview(preview, tenantId, targetPlan) {
        const display = projectCommercialPlanPreviewForDisplay(
            preview,
            tenantId,
            targetPlan,
            state.configuredPlanIds
        );
        resetCommercialPlanPreview();
        if (!display) return false;

        elements.planPreviewCurrent.textContent = display.currentPlan;
        elements.planPreviewCurrentPolicy.textContent =
            display.currentUsesDefaultPolicyFallback
                ? "Yapılandırılmamış · default-policy fallback"
                : "Config planı";
        elements.planPreviewRequested.textContent = display.targetPlan;
        elements.planPreviewAutomaticApply.textContent = "Hayır";

        const counts = { gained: 0, lost: 0, unchanged: 0 };
        for (const feature of Object.keys(PLAN_PREVIEW_FEATURES)) {
            const item = display.features[feature];
            const change = item.presentation ===
                PLAN_PREVIEW_CHANGE_PRESENTATION.gained
                ? "gained"
                : item.presentation === PLAN_PREVIEW_CHANGE_PRESENTATION.lost
                    ? "lost"
                    : "unchanged";
            counts[change] += 1;
            appendPlanPreviewFeatureCard(
                PLAN_PREVIEW_FEATURES[feature],
                item
            );
        }
        elements.planPreviewFeatureSummary.textContent =
            `${counts.gained} kazanım · ${counts.lost} kayıp · ` +
            `${counts.unchanged} değişmedi`;
        for (const key of Object.keys(PLAN_PREVIEW_LIMITS)) {
            appendPlanPreviewLimitCard(key, display.limits[key]);
        }
        return true;
    }

    async function loadCommercialPlanPreview(tenantId, targetPlan) {
        const requestVersion = ++state.planPreviewRequestVersion;
        resetCommercialPlanPreview();
        setMessage(elements.planPreviewMessage, "Plan önizlemesi yükleniyor...");

        try {
            const response = await apiRequest(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/plan-preview?targetPlan=${encodeURIComponent(targetPlan)}`
            );
            if (state.selectedTenantId !== tenantId) return;
            if (elements.planPreviewTarget.value !== targetPlan) return;
            if (requestVersion !== state.planPreviewRequestVersion) return;
            if (!renderCommercialPlanPreview(
                response?.preview,
                tenantId,
                targetPlan
            )) {
                setMessage(
                    elements.planPreviewMessage,
                    "Plan önizlemesi kullanılamıyor.",
                    "error"
                );
                return;
            }
            setMessage(elements.planPreviewMessage);
        } catch {
            if (state.selectedTenantId !== tenantId) return;
            if (elements.planPreviewTarget.value !== targetPlan) return;
            if (requestVersion !== state.planPreviewRequestVersion) return;
            resetCommercialPlanPreview();
            setMessage(
                elements.planPreviewMessage,
                "Plan önizlemesi yüklenemedi.",
                "error"
            );
        }
    }

    async function loadCommercialPlanCatalog(tenantId, currentPlan) {
        const requestVersion = ++state.planCatalogRequestVersion;
        state.planPreviewRequestVersion += 1;
        state.configuredPlanIds = [];
        resetCommercialPlanPreview();
        resetPlanPreviewTarget();
        setMessage(elements.planPreviewMessage, "Plan kataloğu yükleniyor...");

        try {
            const response = await apiRequest("/api/platform/plans");
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.planCatalogRequestVersion) return;
            const catalog = projectPlanCatalogForDisplay(response?.catalog);
            if (!catalog) {
                setMessage(
                    elements.planPreviewMessage,
                    "Plan kataloğu kullanılamıyor.",
                    "error"
                );
                return;
            }

            state.configuredPlanIds = catalog.planIds;
            const targetPlan = populatePlanPreviewTarget(
                catalog.planIds,
                currentPlan
            );
            await loadCommercialPlanPreview(tenantId, targetPlan);
        } catch {
            if (state.selectedTenantId !== tenantId) return;
            if (requestVersion !== state.planCatalogRequestVersion) return;
            state.configuredPlanIds = [];
            resetCommercialPlanPreview();
            resetPlanPreviewTarget();
            setMessage(
                elements.planPreviewMessage,
                "Plan kataloğu yüklenemedi.",
                "error"
            );
        }
    }

    function renderOverview(overview) {
        const daily = overview.usage?.daily || {};
        const monthly = overview.usage?.monthly || {};
        const cost = overview.cost || {};
        const plan = overview.plan || {};
        const backup = overview.backup || {};
        const security = overview.security || {};
        const placement = overview.placement || {};
        const capacity = overview.capacity || {};
        const migration = overview.migration || {};
        const queue = overview.queue || {};
        const cache = overview.cache || {};
        const release = overview.release || {};
        const resilience = overview.resilience || {};

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
        elements.operationsPlacement.textContent = `${placement.type || "unknown"} · ${placement.status || "unknown"}`;
        elements.operationsPlacementDetail.textContent =
            `${placement.region || "bölge yok"} · ${placement.releaseChannel || "kanal yok"}`;
        elements.operationsCapacity.textContent = capacity.status || "unknown";
        elements.operationsSlo.textContent =
            `SLO: ${capacity.sloStatus || "unknown"} · p95 ${formatNumber(capacity.latencyP95Ms)} ms`;
        elements.operationsMigration.textContent = migration.state || "idle";
        elements.operationsMigrationDetail.textContent = migration.destinationPlacementType
            ? `${migration.sourcePlacementType || "unknown"} → ${migration.destinationPlacementType}`
            : "Aktif placement taşıması yok";
        elements.operationsQueue.textContent = `${formatNumber(queue.backlog, 0)} bekleyen · ${formatNumber(queue.running, 0)} çalışan`;
        elements.operationsWorker.textContent =
            `Worker: ${queue.workerHealth || "unknown"} · DLQ ${formatNumber(queue.deadLetter, 0)}`;
        elements.operationsCache.textContent = `${formatNumber(cache.publicEntries, 0)} public entry`;
        elements.operationsCacheDetail.textContent =
            `${formatNumber(cache.fresh, 0)} fresh · ${formatNumber(cache.stale, 0)} stale · ` +
            `son invalidation ${formatTimestamp(cache.lastInvalidatedAt)}`;
        elements.operationsRelease.textContent = `${release.stage || "stable"} · ${release.health || "unknown"}`;
        elements.operationsReleaseDetail.textContent =
            `${release.cohort || "cohort yok"} · rollback ${release.rollbackSignal ? "sinyali var" : "sinyali yok"}`;
        elements.operationsResilience.textContent = resilience.status || "unknown";
        elements.operationsResilienceDetail.textContent =
            `${formatNumber(resilience.dependencies?.length, 0)} provider bağımlılığı`;
        setMessage(elements.operationsMessage);
    }

    function isPlainPostureRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function readPostureValue(record, key) {
        if (!isPlainPostureRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined;
    }

    function projectSourceState(record) {
        const value = readPostureValue(record, "sourceState");
        return typeof value === "string" &&
            Object.hasOwn(SECURITY_POSTURE_SOURCE_PRESENTATION, value)
            ? SECURITY_POSTURE_SOURCE_PRESENTATION[value]
            : SECURITY_POSTURE_UNKNOWN_SOURCE;
    }

    function projectOverallStatus(value) {
        return typeof value === "string" &&
            Object.hasOwn(SECURITY_POSTURE_OVERALL_PRESENTATION, value)
            ? SECURITY_POSTURE_OVERALL_PRESENTATION[value]
            : SECURITY_POSTURE_OVERALL_PRESENTATION.unknown;
    }

    function projectPostureValue(value) {
        return typeof value === "string" &&
            Object.hasOwn(SECURITY_POSTURE_VALUE_LABELS, value)
            ? SECURITY_POSTURE_VALUE_LABELS[value]
            : "Bilinmiyor";
    }

    function projectPostureCount(record, key, source) {
        const value = readPostureValue(record, key);
        return source.isActive && Number.isSafeInteger(value) && value >= 0
            ? value
            : null;
    }

    function projectPostureTimestamp(value) {
        if (typeof value !== "string") return null;
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.toISOString() === value
            ? value
            : null;
    }

    function projectSecurityPostureForDisplay(posture) {
        if (!isPlainPostureRecord(posture) ||
            readPostureValue(posture, "schemaVersion") !== 1) {
            return null;
        }

        const generatedAt = projectPostureTimestamp(
            readPostureValue(posture, "generatedAt")
        );
        const identity = readPostureValue(posture, "identity");
        const secrets = readPostureValue(posture, "secrets");
        const alerts = readPostureValue(posture, "alerts");
        const incidents = readPostureValue(posture, "incidents");
        const breakGlass = readPostureValue(posture, "breakGlass");
        const supplyChain = readPostureValue(posture, "supplyChain");
        if (!generatedAt || ![identity, secrets, alerts, incidents, breakGlass, supplyChain]
            .every(isPlainPostureRecord)) {
            return null;
        }

        const overall = projectOverallStatus(readPostureValue(posture, "overallStatus"));
        const identitySource = projectSourceState(identity);
        const secretSource = projectSourceState(secrets);
        const alertSource = projectSourceState(alerts);
        const incidentSource = projectSourceState(incidents);
        const breakGlassSource = projectSourceState(breakGlass);
        const supplyChainSource = projectSourceState(supplyChain);
        const secretCount = projectPostureCount(secrets, "count", secretSource);
        const overdueCount = projectPostureCount(secrets, "overdue", secretSource);
        const alertCount = projectPostureCount(alerts, "recentVisibleCount", alertSource);
        const openIncidentCount = projectPostureCount(incidents, "openCount", incidentSource);
        const criticalIncidentCount = projectPostureCount(incidents, "criticalCount", incidentSource);
        const activeSessionCount = projectPostureCount(breakGlass, "activeSessions", breakGlassSource);
        const recentUsageCount = projectPostureCount(breakGlass, "recentUsageCount", breakGlassSource);
        const ttlMs = readPostureValue(identity, "elevatedSessionTtlMs");
        const factorTypeCount = readPostureValue(identity, "requiredFactorTypeCount");
        const safeTtlMs = Number.isSafeInteger(ttlMs) && ttlMs > 0 ? ttlMs : null;
        const safeFactorTypeCount = Number.isSafeInteger(factorTypeCount) &&
            factorTypeCount >= 0 ? factorTypeCount : null;
        const highestSeverityValue = readPostureValue(alerts, "highestSeverity");
        const highestSeverity = ["info", "warning", "high", "critical"]
            .includes(highestSeverityValue) ? highestSeverityValue : "—";

        return Object.freeze({
            overall: Object.freeze({
                presentation: overall,
                primary: overall.label,
                detail: `Üretim: ${formatTimestamp(generatedAt)}`
            }),
            identity: Object.freeze({
                presentation: identitySource,
                primary: `Step-up contract: ${projectPostureValue(readPostureValue(identity, "contractStatus"))}`,
                detail:
                    `Runtime enforcement: ${projectSourceState({ sourceState: readPostureValue(identity, "runtimeEnforcement") }).label} · ` +
                    `Elevated session: ${projectSourceState({ sourceState: readPostureValue(identity, "elevatedSessionStatus") }).label} · ` +
                    `MFA readiness: ${projectPostureValue(readPostureValue(identity, "mfaReadiness"))} · ` +
                    `Enrollment: ${projectSourceState({ sourceState: readPostureValue(identity, "enrollmentStatus") }).label} · ` +
                    `TTL: ${safeTtlMs === null ? "—" : `${formatNumber(safeTtlMs / 1000, 0)} sn`} · ` +
                    `Faktör türü: ${safeFactorTypeCount === null ? "—" : formatNumber(safeFactorTypeCount, 0)}`
            }),
            secrets: Object.freeze({
                presentation: secretSource,
                primary: secretCount === null
                    ? "Ölçüm kaynağı bağlı değil"
                    : `${formatNumber(secretCount, 0)} lifecycle kaydı`,
                detail:
                    `Gecikmiş: ${overdueCount === null ? "—" : formatNumber(overdueCount, 0)} · ` +
                    `Sağlık: ${projectSourceState({ sourceState: readPostureValue(secrets, "health") }).label}`
            }),
            alerts: Object.freeze({
                presentation: alertSource,
                primary: `Son görünür uyarılar: ${alertCount === null ? "—" : formatNumber(alertCount, 0)}`,
                detail:
                    `En yüksek seviye: ${highestSeverity} · ` +
                    `Son görülme: ${projectPostureTimestamp(readPostureValue(alerts, "lastSeenAt"))
                        ? formatTimestamp(readPostureValue(alerts, "lastSeenAt"))
                        : "—"}`
            }),
            incidents: Object.freeze({
                presentation: incidentSource,
                primary: openIncidentCount === null
                    ? "Canlı incident kaynağı bağlı değil"
                    : `${formatNumber(openIncidentCount, 0)} açık incident`,
                detail: `Critical: ${criticalIncidentCount === null ? "—" : formatNumber(criticalIncidentCount, 0)}`
            }),
            breakGlass: Object.freeze({
                presentation: breakGlassSource,
                primary: activeSessionCount === null
                    ? "Canlı break-glass kaynağı bağlı değil"
                    : `${formatNumber(activeSessionCount, 0)} aktif oturum`,
                detail: `Yakın kullanım: ${recentUsageCount === null ? "—" : formatNumber(recentUsageCount, 0)}`
            }),
            supplyChain: Object.freeze({
                presentation: supplyChainSource,
                primary:
                    `SBOM: ${projectPostureValue(readPostureValue(supplyChain, "sbomBaseline"))} · ` +
                    `CodeQL: ${projectPostureValue(readPostureValue(supplyChain, "codeqlBaseline"))}`,
                detail:
                    `Canlı workflow: ${projectSourceState({ sourceState: readPostureValue(supplyChain, "liveWorkflowStatus") }).label}`
            })
        });
    }

    function appendSecurityPostureCard(title, card) {
        const article = document.createElement("article");
        article.className = "metric-card security-posture-card";
        const heading = document.createElement("span");
        heading.textContent = title;
        const status = document.createElement("span");
        status.className = "posture-state";
        status.classList.add(card.presentation.className);
        status.textContent = card.presentation.label;
        const primary = document.createElement("strong");
        primary.textContent = card.primary;
        const detail = document.createElement("small");
        detail.textContent = card.detail;
        article.append(heading, status, primary, detail);
        elements.securityPostureCards.append(article);
    }

    function renderSecurityPosture(posture) {
        const display = projectSecurityPostureForDisplay(posture);
        elements.securityPostureCards.replaceChildren();
        if (!display) return false;

        appendSecurityPostureCard("Overall", display.overall);
        appendSecurityPostureCard("Identity / Step-up", display.identity);
        appendSecurityPostureCard("Secret Lifecycle", display.secrets);
        appendSecurityPostureCard("Security Alerts", display.alerts);
        appendSecurityPostureCard("Incidents", display.incidents);
        appendSecurityPostureCard("Break-glass", display.breakGlass);
        appendSecurityPostureCard("Supply-chain", display.supplyChain);
        return true;
    }

    async function loadSecurityPosture() {
        const requestVersion = ++state.securityPostureRequestVersion;
        elements.securityPostureCards.replaceChildren();
        setMessage(elements.securityPostureMessage, "Güvenlik duruşu yükleniyor...");

        try {
            const response = await apiRequest("/api/platform/security-posture");
            if (requestVersion !== state.securityPostureRequestVersion) return;
            if (!renderSecurityPosture(response?.posture)) {
                setMessage(
                    elements.securityPostureMessage,
                    "Güvenlik duruşu kullanılamıyor.",
                    "error"
                );
                return;
            }
            setMessage(elements.securityPostureMessage);
        } catch {
            if (requestVersion !== state.securityPostureRequestVersion) return;
            elements.securityPostureCards.replaceChildren();
            setMessage(
                elements.securityPostureMessage,
                "Güvenlik duruşu yüklenemedi.",
                "error"
            );
        }
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
        elements.customerReadinessPanel.classList.add("hidden");
        elements.planPreviewPanel.classList.add("hidden");
        elements.securityAlertsPanel.classList.add("hidden");
        elements.securityPosturePanel.classList.add("hidden");
        state.tenantAlertRequestVersion += 1;
        state.platformAlertRequestVersion += 1;
        state.securityPostureRequestVersion += 1;
        state.customerReadinessRequestVersion += 1;
        state.planCatalogRequestVersion += 1;
        state.planPreviewRequestVersion += 1;
        state.configuredPlanIds = [];
        resetCustomerReadiness();
        setMessage(elements.customerReadinessMessage);
        resetCommercialPlanPreview();
        resetPlanPreviewTarget();
        setMessage(elements.planPreviewMessage);
        elements.securityPostureCards.replaceChildren();
        setMessage(elements.securityPostureMessage);
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
        elements.customerReadinessPanel.classList.remove("hidden");
        elements.planPreviewPanel.classList.remove("hidden");
        elements.securityAlertsPanel.classList.remove("hidden");
        elements.securityPosturePanel.classList.remove("hidden");

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
        loadCustomerReadiness(tenant.tenantId);
        loadCommercialPlanCatalog(tenant.tenantId, tenant.plan);
        loadTenantSecurityAlerts(tenant.tenantId);
        loadPlatformSecurityAlerts();
        loadSecurityPosture();
    }

    function showEmpty() {
        state.mode = "none";
        state.selectedTenantId = null;
        elements.tenantForm.classList.add("hidden");
        elements.operationsPanel.classList.add("hidden");
        elements.customerReadinessPanel.classList.add("hidden");
        elements.planPreviewPanel.classList.add("hidden");
        elements.securityAlertsPanel.classList.add("hidden");
        elements.securityPosturePanel.classList.add("hidden");
        state.tenantAlertRequestVersion += 1;
        state.platformAlertRequestVersion += 1;
        state.securityPostureRequestVersion += 1;
        state.customerReadinessRequestVersion += 1;
        state.planCatalogRequestVersion += 1;
        state.planPreviewRequestVersion += 1;
        state.configuredPlanIds = [];
        resetCustomerReadiness();
        setMessage(elements.customerReadinessMessage);
        resetCommercialPlanPreview();
        resetPlanPreviewTarget();
        setMessage(elements.planPreviewMessage);
        elements.securityPostureCards.replaceChildren();
        setMessage(elements.securityPostureMessage);
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
    elements.planPreviewTarget.addEventListener("change", () => {
        const tenantId = state.selectedTenantId;
        const targetPlan = elements.planPreviewTarget.value;
        if (state.mode === "edit" && tenantId &&
            state.configuredPlanIds.includes(targetPlan)) {
            loadCommercialPlanPreview(tenantId, targetPlan);
        }
    });
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
