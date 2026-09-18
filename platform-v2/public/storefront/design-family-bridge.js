(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const DESIGN_FAMILIES = new Set([
        "modern",
        "warm",
        "bold",
        "corporate",
        "editorial",
        "minimal"
    ]);
    const OFFERING_KINDS = new Set([
        "menu",
        "catalog",
        "services",
        "accommodation",
        "fleet",
        "portfolio",
        "offerings"
    ]);
    const DEFAULT_FAMILY = "modern";
    const DEFAULT_OFFERING = Object.freeze({
        kind: "offerings",
        label: "Ürünler & Hizmetler"
    });
    const originalFetch = window.fetch.bind(window);
    let currentOffering = DEFAULT_OFFERING;

    function tenantIdFromPath() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || parts[0] !== "m") return "";
        try {
            const tenantId = decodeURIComponent(parts[1]);
            return tenantId.length >= 3 && TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
        } catch {
            return "";
        }
    }

    const tenantId = tenantIdFromPath();
    const expectedStorefrontPath = tenantId
        ? `/api/public/storefront/${encodeURIComponent(tenantId)}`
        : "";

    function normalizeFamily(value) {
        const family = String(value ?? "").trim().toLowerCase();
        return DESIGN_FAMILIES.has(family) ? family : DEFAULT_FAMILY;
    }

    function normalizeOffering(value) {
        const input = value && typeof value === "object" && !Array.isArray(value)
            ? value
            : {};
        const candidateKind = String(input.offeringKind ?? "").trim().toLowerCase();
        const kind = OFFERING_KINDS.has(candidateKind)
            ? candidateKind
            : DEFAULT_OFFERING.kind;
        const rawLabel = String(input.offeringLabel ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").trim();
        const label = rawLabel.slice(0, 80) || DEFAULT_OFFERING.label;
        return Object.freeze({ kind, label });
    }

    function catalogCopy(offering) {
        switch (offering.kind) {
        case "menu":
            return [
                "Ürünler & Menü",
                "Güncel seçenekleri, kategorileri ve fiyatları inceleyin."
            ];
        case "services":
            return [
                offering.label.includes("Paket") ? "Hizmetler & Paketler" : offering.label,
                "Güncel hizmet seçeneklerini ve fiyatları inceleyin."
            ];
        case "catalog":
            return [
                offering.label,
                "Güncel ürünleri, kategorileri ve fiyatları inceleyin."
            ];
        case "accommodation":
            return [
                offering.label,
                "Güncel oda ve hizmet seçeneklerini inceleyin."
            ];
        case "fleet":
            return [
                offering.label,
                "Güncel araç seçeneklerini ve detaylarını inceleyin."
            ];
        case "portfolio":
            return [
                offering.label,
                "Ürünleri inceleyip ticari teklif için işletmeyle iletişime geçin."
            ];
        default:
            return [
                offering.label,
                "Güncel ürün ve hizmet seçeneklerini inceleyin."
            ];
        }
    }

    function applyCatalogSemantics() {
        const section = document.getElementById("catalog-section");
        if (!section || section.classList.contains("hidden")) return;

        const title = document.getElementById("catalog-title");
        const subtitle = document.getElementById("catalog-subtitle");
        if (!title || !subtitle) return;

        const [titleText, subtitleText] = catalogCopy(currentOffering);
        title.textContent = titleText;
        subtitle.textContent = subtitleText;
        document.documentElement.dataset.offeringKind = currentOffering.kind;
    }

    function watchCatalogRendering() {
        const section = document.getElementById("catalog-section");
        if (!section || typeof MutationObserver !== "function") return;

        const observer = new MutationObserver(() => {
            if (!section.classList.contains("hidden")) {
                applyCatalogSemantics();
            }
        });
        observer.observe(section, { attributes: true, attributeFilter: ["class"] });
    }

    function isCurrentStorefrontRequest(input) {
        if (!expectedStorefrontPath) return false;
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

    async function applyPresentationMetadataFromResponse(response) {
        try {
            if (!response?.ok) return;
            const body = await response.clone().json();
            const presentation = body?.storefront?.presentation;
            const family = normalizeFamily(presentation?.designFamily);
            currentOffering = normalizeOffering(presentation?.sector);
            document.documentElement.dataset.designFamily = family;
            document.documentElement.dataset.offeringKind = currentOffering.kind;
            applyCatalogSemantics();
        } catch {
            currentOffering = DEFAULT_OFFERING;
            document.documentElement.dataset.designFamily = DEFAULT_FAMILY;
            document.documentElement.dataset.offeringKind = DEFAULT_OFFERING.kind;
        }
    }

    document.documentElement.dataset.designFamily = DEFAULT_FAMILY;
    document.documentElement.dataset.offeringKind = DEFAULT_OFFERING.kind;
    watchCatalogRendering();

    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (isCurrentStorefrontRequest(args[0])) {
            void applyPresentationMetadataFromResponse(response);
        }
        return response;
    };
})();
