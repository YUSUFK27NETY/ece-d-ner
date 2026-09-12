(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const moduleGrid = document.getElementById("module-grid");
    if (!moduleGrid) return;

    function tenantIdFromPath() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || parts[0] !== "m") return "";
        const tenantId = decodeURIComponent(parts[1]);
        return TENANT_ID_PATTERN.test(tenantId) && tenantId.length >= 3 ? tenantId : "";
    }

    const tenantId = tenantIdFromPath();
    if (!tenantId) return;

    moduleGrid.addEventListener("click", event => {
        const link = event.target.closest("a");
        if (!link || !moduleGrid.contains(link)) return;
        const card = link.closest(".module-card");
        const title = card?.querySelector("h3")?.textContent?.trim();
        const destination = title === "Randevu"
            ? "appointments"
            : title === "Teklif"
                ? "quote"
                : null;
        if (!destination) return;
        event.preventDefault();
        window.location.assign(`/m/${encodeURIComponent(tenantId)}/${destination}`);
    });
})();
