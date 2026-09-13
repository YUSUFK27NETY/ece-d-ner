(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const ownerButton = document.getElementById("owner-entry-button");
    const ownerTenantInput = document.getElementById("tenant-id");
    const customerForm = document.getElementById("customer-entry-form");
    const customerTenantInput = document.getElementById("customer-tenant-id");
    const customerMessage = document.getElementById("customer-entry-message");

    if (!ownerButton || !ownerTenantInput || !customerForm ||
        !customerTenantInput || !customerMessage) {
        return;
    }

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return tenantId.length >= 3 && tenantId.length <= 63 &&
            TENANT_ID_PATTERN.test(tenantId)
            ? tenantId
            : "";
    }

    function setCustomerMessage(text = "", type = "") {
        customerMessage.textContent = text;
        customerMessage.className = "message";
        if (type) customerMessage.classList.add(type);
    }

    function readInitialTenantId() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeTenantId(params.get("tenant"));
        if (fromUrl) return fromUrl;

        try {
            return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId"));
        } catch {
            return "";
        }
    }

    const initialTenantId = readInitialTenantId();
    if (initialTenantId) {
        ownerTenantInput.value = initialTenantId;
        customerTenantInput.value = initialTenantId;
    }

    ownerButton.addEventListener("click", () => {
        const customerTenantId = normalizeTenantId(customerTenantInput.value);
        if (customerTenantId && !normalizeTenantId(ownerTenantInput.value)) {
            ownerTenantInput.value = customerTenantId;
        }
        document.getElementById("owner-login")?.scrollIntoView({
            behavior: "smooth",
            block: "start"
        });
        window.setTimeout(() => ownerTenantInput.focus(), 250);
    });

    ownerTenantInput.addEventListener("input", () => {
        const tenantId = normalizeTenantId(ownerTenantInput.value);
        if (tenantId) customerTenantInput.value = tenantId;
    });

    customerForm.addEventListener("submit", event => {
        event.preventDefault();
        setCustomerMessage();
        const tenantId = normalizeTenantId(customerTenantInput.value);
        if (!tenantId) {
            setCustomerMessage("Geçerli işletme kodu girin.", "error");
            customerTenantInput.focus();
            return;
        }
        window.location.assign(`/m/${encodeURIComponent(tenantId)}`);
    });
})();
