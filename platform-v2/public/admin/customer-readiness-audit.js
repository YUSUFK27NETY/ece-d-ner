(() => {
    "use strict";

    const formMode = document.getElementById("form-mode");
    const readinessPanel = document.getElementById("customer-readiness-panel");
    const readinessMessage = document.getElementById("customer-readiness-message");
    const summary = readinessPanel?.querySelector(".customer-readiness-summary");

    if (!formMode || !readinessPanel || !readinessMessage || !summary) {
        return;
    }

    const article = document.createElement("article");
    article.className = "metric-card";
    const label = document.createElement("span");
    label.textContent = "Son audit";
    const primary = document.createElement("strong");
    primary.textContent = "—";
    const detail = document.createElement("small");
    detail.textContent = "Salt okunur tenant audit görünürlüğü";
    article.append(label, primary, detail);
    summary.append(article);

    let requestVersion = 0;
    let scheduled = false;

    function canonicalTenantId(value) {
        return typeof value === "string" &&
            /^[a-z0-9][a-z0-9_-]{1,63}$/.test(value)
            ? value
            : null;
    }

    function isPlainRecord(value) {
        return Boolean(value) && typeof value === "object" &&
            !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
    }

    function readOwn(record, key) {
        if (!isPlainRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined;
    }

    function canonicalTimestamp(value) {
        if (typeof value !== "string") return null;
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) &&
            new Date(timestamp).toISOString() === value
            ? value
            : null;
    }

    function projectLastAudit(model, tenantId) {
        if (!isPlainRecord(model) ||
            readOwn(model, "tenantId") !== tenantId) {
            return null;
        }

        const status = readOwn(model, "status");
        const action = readOwn(model, "action");
        const createdAt = readOwn(model, "createdAt");
        if (!["available", "none", "unavailable"].includes(status)) {
            return null;
        }

        if (status === "available") {
            const timestamp = canonicalTimestamp(createdAt);
            if (typeof action !== "string" ||
                !/^[a-z0-9_.-]{3,120}$/i.test(action) || !timestamp) {
                return null;
            }
            return Object.freeze({ status, action, createdAt: timestamp });
        }

        if (action !== null || createdAt !== null) {
            return null;
        }
        return Object.freeze({ status, action: null, createdAt: null });
    }

    function formatTimestamp(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? "bilinmiyor"
            : date.toLocaleString("tr-TR");
    }

    function reset() {
        primary.textContent = "—";
        detail.textContent = "Salt okunur tenant audit görünürlüğü";
    }

    function render(model) {
        if (model.status === "available") {
            primary.textContent = model.action;
            detail.textContent = `Son kayıt: ${formatTimestamp(model.createdAt)}`;
            return;
        }
        if (model.status === "none") {
            primary.textContent = "Kayıt yok";
            detail.textContent = "Bu tenant için audit kaydı henüz yok";
            return;
        }
        primary.textContent = "Kullanılamıyor";
        detail.textContent = "Audit kaynağı şu anda okunamıyor";
    }

    async function load() {
        const version = ++requestVersion;
        const tenantId = canonicalTenantId(formMode.textContent.trim());
        if (!tenantId || readinessPanel.classList.contains("hidden")) {
            reset();
            return;
        }

        try {
            if (!window.firebase || !firebase.auth) throw new Error();
            const user = firebase.auth().currentUser;
            if (!user) throw new Error();
            const token = await user.getIdToken();
            const response = await fetch(
                `/api/platform/tenants/${encodeURIComponent(tenantId)}/last-audit`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            let body = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }
            if (!response.ok) throw new Error();
            const projected = projectLastAudit(body?.lastAudit, tenantId);
            if (!projected) throw new Error();
            if (version !== requestVersion ||
                canonicalTenantId(formMode.textContent.trim()) !== tenantId) {
                return;
            }
            render(projected);
        } catch {
            if (version !== requestVersion) return;
            primary.textContent = "Kullanılamıyor";
            detail.textContent = "Audit kaynağı şu anda okunamıyor";
        }
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
            scheduled = false;
            load();
        });
    }

    const observer = new MutationObserver(schedule);
    observer.observe(formMode, {
        childList: true,
        characterData: true,
        subtree: true
    });
    observer.observe(readinessMessage, {
        childList: true,
        characterData: true,
        subtree: true
    });
    observer.observe(readinessPanel, {
        attributes: true,
        attributeFilter: ["class"]
    });

    if (window.firebase?.auth) {
        firebase.auth().onAuthStateChanged(schedule);
    }
    schedule();
})();
