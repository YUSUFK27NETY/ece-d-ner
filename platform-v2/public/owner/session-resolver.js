(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const OWNER_ROLES = new Set(["tenant_owner", "tenant_admin"]);

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return tenantId.length >= 3 && tenantId.length <= 63 &&
            TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
    }

    async function resolve(user) {
        if (!user || typeof user.getIdToken !== "function") {
            throw new Error("İşletme oturumu bulunamadı.");
        }

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
        if (!tenantId || !OWNER_ROLES.has(session?.role)) {
            throw new Error("İşletme hesabı doğrulanamadı.");
        }

        try {
            window.sessionStorage.setItem("platformOwnerTenantId", tenantId);
        } catch {
            // Convenience only. Authorization never relies on browser storage.
        }

        return Object.freeze({
            tenantId,
            role: session.role
        });
    }

    window.OWNER_SESSION_RESOLVER = Object.freeze({ resolve });
})();
