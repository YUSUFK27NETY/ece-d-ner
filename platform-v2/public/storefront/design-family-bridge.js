(() => {
    "use strict";

    const DESIGN_FAMILIES = new Set([
        "modern",
        "warm",
        "bold",
        "corporate",
        "editorial",
        "minimal"
    ]);
    const DEFAULT_FAMILY = "modern";
    const originalFetch = window.fetch.bind(window);

    function normalizeFamily(value) {
        const family = String(value ?? "").trim().toLowerCase();
        return DESIGN_FAMILIES.has(family) ? family : DEFAULT_FAMILY;
    }

    function isStorefrontApiRequest(input) {
        try {
            const raw = typeof input === "string" || input instanceof URL
                ? String(input)
                : String(input?.url || "");
            const url = new URL(raw, window.location.origin);
            return url.origin === window.location.origin &&
                /^\/api\/public\/storefront\/[a-z0-9-]+$/.test(url.pathname);
        } catch {
            return false;
        }
    }

    async function applyFamilyFromResponse(response) {
        try {
            if (!response?.ok) return;
            const body = await response.clone().json();
            const family = normalizeFamily(body?.storefront?.presentation?.designFamily);
            document.documentElement.dataset.designFamily = family;
        } catch {
            document.documentElement.dataset.designFamily = DEFAULT_FAMILY;
        }
    }

    document.documentElement.dataset.designFamily = DEFAULT_FAMILY;

    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (isStorefrontApiRequest(args[0])) {
            void applyFamilyFromResponse(response);
        }
        return response;
    };
})();
