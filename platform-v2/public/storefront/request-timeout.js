(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const STOREFRONT_TIMEOUT_MS = 18_000;

    function tenantIdFromPath() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || parts[0] !== "m") return "";
        const tenantId = decodeURIComponent(parts[1]);
        return tenantId.length >= 3 && TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
    }

    const tenantId = tenantIdFromPath();
    if (!tenantId) return;

    const originalFetch = window.fetch.bind(window);
    const expectedStorefrontPath = `/api/public/storefront/${encodeURIComponent(tenantId)}`;

    function isCurrentStorefrontRequest(input) {
        try {
            const raw = typeof input === "string" || input instanceof URL
                ? String(input)
                : String(input?.url || "");
            const url = new URL(raw, window.location.origin);
            return url.origin === window.location.origin &&
                url.pathname === expectedStorefrontPath &&
                url.search === "";
        } catch {
            return false;
        }
    }

    function callerSignal(input, init) {
        if (init?.signal) return init.signal;
        if (typeof Request === "function" && input instanceof Request) return input.signal;
        return null;
    }

    window.fetch = async (...args) => {
        if (!isCurrentStorefrontRequest(args[0])) {
            return originalFetch(...args);
        }

        const init = args[1] && typeof args[1] === "object" ? args[1] : {};
        if (callerSignal(args[0], init) || typeof AbortController !== "function") {
            return originalFetch(...args);
        }

        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), STOREFRONT_TIMEOUT_MS);
        try {
            return await originalFetch(args[0], { ...init, signal: controller.signal });
        } catch (error) {
            if (controller.signal.aborted) {
                throw new Error("İşletme sayfası zaman aşımına uğradı. Tekrar deneyin.");
            }
            throw error;
        } finally {
            window.clearTimeout(timer);
        }
    };
})();
