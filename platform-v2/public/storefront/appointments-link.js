(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const moduleGrid = document.getElementById("module-grid");
    const catalogSection = document.getElementById("catalog-section");
    if (!moduleGrid) return;

    function tenantIdFromPath() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || parts[0] !== "m") return "";
        const tenantId = decodeURIComponent(parts[1]);
        return TENANT_ID_PATTERN.test(tenantId) && tenantId.length >= 3 ? tenantId : "";
    }

    function preferredContactLink() {
        return document.querySelector('#contact-chips a[href^="https://wa.me/"]') ||
            document.querySelector('#contact-chips a[href^="tel:"]');
    }

    const tenantId = tenantIdFromPath();
    if (!tenantId) return;

    moduleGrid.addEventListener("click", event => {
        const link = event.target.closest("a");
        if (!link || !moduleGrid.contains(link)) return;
        const card = link.closest(".module-card");
        const title = card?.querySelector("h3")?.textContent?.trim();

        if (title === "Sipariş" && link.hash === "#catalog-section" &&
            (!catalogSection || catalogSection.classList.contains("hidden"))) {
            event.preventDefault();
            const fallback = preferredContactLink();
            if (fallback) fallback.click();
            else window.location.assign("#contact");
            return;
        }

        let destination = null;
        if (title === "Randevu") {
            destination = `/m/${encodeURIComponent(tenantId)}/appointments`;
        } else if (title === "Teklif") {
            destination = `/m/${encodeURIComponent(tenantId)}/quote`;
        }
        if (!destination) return;
        event.preventDefault();
        window.location.assign(destination);
    });
})();