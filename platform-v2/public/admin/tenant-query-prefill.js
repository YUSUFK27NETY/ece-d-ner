(() => {
    "use strict";

    const tenantId = new URLSearchParams(window.location.search).get("tenantId");
    if (typeof tenantId !== "string" || tenantId.length < 3 || tenantId.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(tenantId)) {
        return;
    }

    for (const id of [
        "bootstrap-tenant-id",
        "security-review-tenant-id",
        "backup-diagnostic-tenant-id"
    ]) {
        const input = document.getElementById(id);
        if (!input || input.value) continue;
        input.value = tenantId;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
})();
