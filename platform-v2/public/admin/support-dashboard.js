(() => {
    "use strict";

    const adminAuth = window.PLATFORM_ADMIN_AUTH;
    const HEALTH_LABELS = Object.freeze({
        healthy: "Sağlıklı",
        attention: "Dikkat",
        critical: "Kritik",
        unknown: "Bilinmiyor"
    });
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    const el = {
        session: document.getElementById("support-session"),
        refresh: document.getElementById("support-refresh"),
        message: document.getElementById("support-message"),
        search: document.getElementById("support-search"),
        filter: document.getElementById("support-filter"),
        generatedAt: document.getElementById("support-generated-at"),
        rows: document.getElementById("support-rows"),
        empty: document.getElementById("support-empty"),
        total: document.getElementById("support-total"),
        healthy: document.getElementById("support-healthy"),
        attention: document.getElementById("support-attention"),
        critical: document.getElementById("support-critical"),
        unknown: document.getElementById("support-unknown")
    };

    const state = {
        busy: false,
        rows: [],
        generatedAt: null,
        requestVersion: 0
    };

    function setMessage(text = "", type = "") {
        el.message.textContent = text;
        el.message.classList.remove("error", "success");
        if (type) el.message.classList.add(type);
    }

    function setBusy(value) {
        state.busy = value;
        el.refresh.disabled = value || !adminAuth?.currentUser;
    }

    function formatTimestamp(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "—";
        return new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short"
        }).format(date);
    }

    function requireTenantRow(row) {
        if (!row || typeof row !== "object" || Array.isArray(row) ||
            typeof row.tenantId !== "string" ||
            !TENANT_ID_PATTERN.test(row.tenantId) ||
            typeof row.displayName !== "string" ||
            !Object.hasOwn(HEALTH_LABELS, row.health) ||
            !Number.isSafeInteger(row.requestsToday) || row.requestsToday < 0 ||
            !Number.isSafeInteger(row.errorsToday) || row.errorsToday < 0 ||
            !row.operational || typeof row.operational !== "object" ||
            !row.security || typeof row.security !== "object") {
            throw new Error("Destek merkezi tenant yanıtı doğrulanamadı.");
        }
        return row;
    }

    function projectSupport(body) {
        const support = body?.support;
        if (!support || support.schemaVersion !== 1 ||
            typeof support.generatedAt !== "string" ||
            !Array.isArray(support.tenants) ||
            !support.totals || typeof support.totals !== "object") {
            throw new Error("Destek merkezi yanıtı doğrulanamadı.");
        }

        const rows = support.tenants.map(requireTenantRow);
        const total = rows.length;
        const calculated = { healthy: 0, attention: 0, critical: 0, unknown: 0 };
        for (const row of rows) calculated[row.health] += 1;

        if (support.totals.total !== total ||
            Object.entries(calculated).some(([key, value]) => support.totals[key] !== value)) {
            throw new Error("Destek merkezi sayaçları doğrulanamadı.");
        }

        return { rows, generatedAt: support.generatedAt, totals: { total, ...calculated } };
    }

    async function getIdToken() {
        const user = adminAuth?.currentUser;
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
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function appendTextCell(row, primary, secondary = "") {
        const cell = document.createElement("td");
        const main = document.createElement("div");
        main.textContent = primary;
        cell.append(main);
        if (secondary) {
            const detail = document.createElement("small");
            detail.className = "support-cell-detail";
            detail.textContent = secondary;
            cell.append(detail);
        }
        row.append(cell);
    }

    function businessCell(item) {
        const cell = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "support-business";
        const name = document.createElement("strong");
        name.textContent = item.displayName;
        const meta = document.createElement("small");
        meta.textContent = `${item.tenantId} · ${item.sector || "sektör yok"} · ${item.plan || "plan yok"}`;
        wrap.append(name, meta);
        cell.append(wrap);
        return cell;
    }

    function healthCell(item) {
        const cell = document.createElement("td");
        const badge = document.createElement("span");
        badge.className = `support-health ${item.health}`;
        badge.textContent = HEALTH_LABELS[item.health];
        cell.append(badge);
        return cell;
    }

    function lastErrorText(lastError) {
        if (!lastError) return ["—", ""];
        const operation = lastError.operation || "İşlem bilinmiyor";
        const status = Number.isInteger(lastError.statusCode)
            ? `HTTP ${lastError.statusCode}`
            : "Durum kodu yok";
        return [`${operation} · ${status}`, formatTimestamp(lastError.occurredAt)];
    }

    function operationalAlertText(operational) {
        const total = Number.isSafeInteger(operational?.total) ? operational.total : 0;
        const severity = typeof operational?.highestSeverity === "string"
            ? operational.highestSeverity
            : "none";
        const latest = operational?.latest;
        const detail = latest && typeof latest === "object"
            ? `${String(latest.operation || "İşlem bilinmiyor")} · ${Number.isInteger(latest.statusCode) ? `HTTP ${latest.statusCode}` : "Durum kodu yok"}`
            : severity === "none" ? "Alarm yok" : `En yüksek: ${severity}`;
        return [`${total} olay · ${severity}`, detail];
    }

    function actionsCell(item) {
        const cell = document.createElement("td");
        const wrap = document.createElement("div");
        wrap.className = "support-actions";

        const security = document.createElement("a");
        security.className = "button secondary compact";
        security.href = `/admin/security-review.html?tenantId=${encodeURIComponent(item.tenantId)}`;
        security.textContent = "Güvenlik";

        const setup = document.createElement("a");
        setup.className = "button secondary compact";
        setup.href = `/admin/quick-setup.html?tenantId=${encodeURIComponent(item.tenantId)}`;
        setup.textContent = "Tenant";

        wrap.append(security, setup);

        if (item.lifecycleStatus === "active") {
            const live = document.createElement("a");
            live.className = "button secondary compact";
            live.href = `/m/${encodeURIComponent(item.tenantId)}`;
            live.target = "_blank";
            live.rel = "noopener";
            live.textContent = "Canlı";
            wrap.append(live);
        }

        cell.append(wrap);
        return cell;
    }

    function filteredRows() {
        const query = el.search.value.trim().toLocaleLowerCase("tr-TR");
        const filter = el.filter.value;
        return state.rows.filter(item => {
            const matchesQuery = !query ||
                [item.displayName, item.tenantId, item.sector, item.plan]
                    .some(value => String(value || "")
                        .toLocaleLowerCase("tr-TR")
                        .includes(query));
            const matchesFilter = filter === "all" || item.health === filter;
            return matchesQuery && matchesFilter;
        });
    }

    function renderRows() {
        el.rows.replaceChildren();
        const rows = filteredRows();

        for (const item of rows) {
            const row = document.createElement("tr");
            row.append(businessCell(item));
            row.append(healthCell(item));
            appendTextCell(row, item.lifecycleStatus || "unknown");
            appendTextCell(
                row,
                `${item.requestsToday} istek`,
                `${item.errorsToday} hata`
            );
            const [alarmTitle, alarmDetail] = operationalAlertText(item.operational);
            appendTextCell(row, alarmTitle, alarmDetail);
            appendTextCell(
                row,
                `Son kayıtlar: ${item.security.total || 0} sinyal`,
                `En yüksek: ${item.security.highestSeverity || "none"}`
            );
            const [errorTitle, errorTime] = lastErrorText(item.lastError);
            appendTextCell(row, errorTitle, errorTime);
            row.append(actionsCell(item));
            el.rows.append(row);
        }

        el.empty.classList.toggle("hidden", rows.length !== 0);
    }

    function renderSummary(totals) {
        el.total.textContent = String(totals.total);
        el.healthy.textContent = String(totals.healthy);
        el.attention.textContent = String(totals.attention);
        el.critical.textContent = String(totals.critical);
        el.unknown.textContent = String(totals.unknown);
        el.generatedAt.textContent = `Son güncelleme: ${formatTimestamp(state.generatedAt)}`;
    }

    async function loadSupport() {
        const version = ++state.requestVersion;
        setBusy(true);
        setMessage("Destek durumu yükleniyor…");
        try {
            const projected = projectSupport(
                await apiRequest("/api/platform/support-overview?limit=200")
            );
            if (version !== state.requestVersion) return;
            state.rows = projected.rows;
            state.generatedAt = projected.generatedAt;
            renderSummary(projected.totals);
            renderRows();
            if (projected.totals.critical > 0) {
                setMessage("Kritik durumda tenant var; inceleme gerekli.", "error");
            } else if (projected.totals.attention > 0) {
                setMessage("İncelenmesi gereken tenantlar var.");
            } else {
                setMessage("Görünür kritik/dikkat durumu yok.", "success");
            }
        } catch (error) {
            if (version !== state.requestVersion) return;
            state.rows = [];
            state.generatedAt = null;
            renderSummary({ total: 0, healthy: 0, attention: 0, critical: 0, unknown: 0 });
            renderRows();
            setMessage(error.message || "Destek merkezi yüklenemedi.", "error");
        } finally {
            if (version === state.requestVersion) setBusy(false);
        }
    }

    if (!adminAuth) {
        el.session.textContent = "Platform Admin auth izolasyonu kullanılamıyor.";
        el.refresh.disabled = true;
        setMessage("Destek Merkezi başlatılamadı.", "error");
        return;
    }

    el.refresh.addEventListener("click", loadSupport);
    el.search.addEventListener("input", renderRows);
    el.filter.addEventListener("change", renderRows);

    adminAuth.onAuthStateChanged(user => {
        state.requestVersion += 1;
        if (!user) {
            state.rows = [];
            renderRows();
            el.session.textContent = "Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.";
            el.refresh.disabled = true;
            return;
        }

        el.session.textContent = user.email || user.uid;
        void loadSupport();
    });
})();
