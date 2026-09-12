(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const el = Object.freeze({
        form: document.getElementById("quote-form"),
        company: document.getElementById("company-name"),
        country: document.getElementById("country"),
        contact: document.getElementById("contact-name"),
        email: document.getElementById("email"),
        phone: document.getElementById("phone"),
        note: document.getElementById("note"),
        items: document.getElementById("items"),
        addItem: document.getElementById("add-item"),
        submit: document.getElementById("submit-button"),
        message: document.getElementById("form-message"),
        success: document.getElementById("success-view"),
        code: document.getElementById("quote-code"),
        brand: document.getElementById("brand-title"),
        back: document.getElementById("back-link"),
        successBack: document.getElementById("success-back")
    });
    if (Object.values(el).some(value => value === null)) return;

    function tenantIdFromPath() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 3 || parts[0] !== "m" || parts[2] !== "quote") return "";
        const tenantId = decodeURIComponent(parts[1]);
        return TENANT_ID_PATTERN.test(tenantId) && tenantId.length >= 3 ? tenantId : "";
    }

    const tenantId = tenantIdFromPath();
    if (!tenantId) {
        el.form.classList.add("hidden");
        el.message.textContent = "İşletme bağlantısı geçersiz.";
        return;
    }
    const home = `/m/${encodeURIComponent(tenantId)}`;
    el.back.href = home;
    el.successBack.href = home;

    function showMessage(text = "", type = "") {
        el.message.textContent = text;
        el.message.className = "message";
        if (type) el.message.classList.add(type);
    }

    function makeIdempotencyKey() {
        if (window.crypto?.randomUUID) return `rfq:${window.crypto.randomUUID()}`;
        return `rfq:${Date.now()}:${Math.random().toString(36).slice(2, 14)}`;
    }
    let idempotencyKey = makeIdempotencyKey();

    function createItemRow() {
        const row = document.createElement("div");
        row.className = "item-row";

        const descLabel = document.createElement("label");
        descLabel.textContent = "Ürün / hizmet";
        const description = document.createElement("input");
        description.maxLength = 220;
        description.required = true;
        description.placeholder = "Örn. 10 mm paslanmaz sac";
        description.dataset.field = "description";
        descLabel.append(description);

        const qtyLabel = document.createElement("label");
        qtyLabel.textContent = "Miktar";
        const quantity = document.createElement("input");
        quantity.type = "number";
        quantity.min = "1";
        quantity.max = "1000000";
        quantity.step = "1";
        quantity.value = "1";
        quantity.required = true;
        quantity.dataset.field = "quantity";
        qtyLabel.append(quantity);

        const unitLabel = document.createElement("label");
        unitLabel.textContent = "Birim";
        const unit = document.createElement("input");
        unit.maxLength = 40;
        unit.placeholder = "adet / kg";
        unit.dataset.field = "unit";
        unitLabel.append(unit);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger remove-item";
        remove.textContent = "Kaldır";
        remove.addEventListener("click", () => {
            if (el.items.children.length <= 1) {
                showMessage("En az bir teklif kalemi gerekli.", "error");
                return;
            }
            row.remove();
        });

        row.append(descLabel, qtyLabel, unitLabel, remove);
        return row;
    }

    function readItems() {
        return [...el.items.querySelectorAll(".item-row")].map(row => ({
            description: row.querySelector('[data-field="description"]').value.trim(),
            quantity: Number(row.querySelector('[data-field="quantity"]').value),
            unit: row.querySelector('[data-field="unit"]').value.trim() || null
        }));
    }

    async function loadBrand() {
        try {
            const response = await fetch(`/api/public/storefront/${encodeURIComponent(tenantId)}`, {
                headers: { Accept: "application/json" }
            });
            const body = await response.json();
            if (!response.ok || body?.storefront?.features?.quotes !== true) {
                throw new Error("Bu işletme teklif talebi kabul etmiyor.");
            }
            const storefront = body.storefront;
            el.brand.textContent = `${storefront.profile?.brandName || storefront.displayName || "İşletme"} — Teklif Talebi`;
        } catch (error) {
            el.form.querySelectorAll("input,textarea,button").forEach(control => { control.disabled = true; });
            showMessage(error.message || "Teklif formu kullanılamıyor.", "error");
        }
    }

    el.items.append(createItemRow());
    el.addItem.addEventListener("click", () => {
        if (el.items.children.length >= 25) {
            showMessage("En fazla 25 teklif kalemi eklenebilir.", "error");
            return;
        }
        el.items.append(createItemRow());
    });

    el.form.addEventListener("submit", async event => {
        event.preventDefault();
        showMessage();
        const email = el.email.value.trim();
        const phone = el.phone.value.trim();
        if (!email && !phone) {
            showMessage("E-posta veya telefon alanlarından en az birini doldurun.", "error");
            return;
        }
        const items = readItems();
        if (!items.length || items.some(item => item.description.length < 2 || !Number.isInteger(item.quantity) || item.quantity < 1)) {
            showMessage("Teklif kalemlerini ve miktarları kontrol edin.", "error");
            return;
        }
        const payload = {
            companyName: el.company.value.trim(),
            country: el.country.value.trim(),
            contactName: el.contact.value.trim(),
            email: email || null,
            phone: phone || null,
            items,
            note: el.note.value.trim() || null
        };
        el.submit.disabled = true;
        try {
            const response = await fetch(`/api/public/quotes/${encodeURIComponent(tenantId)}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    "Idempotency-Key": idempotencyKey
                },
                body: JSON.stringify(payload)
            });
            let body = null;
            try { body = await response.json(); } catch { body = null; }
            if (!response.ok || !body?.quote?.quoteId) {
                throw new Error(body?.message || `Teklif talebi gönderilemedi (${response.status}).`);
            }
            el.code.textContent = body.quote.quoteId;
            el.form.classList.add("hidden");
            el.success.classList.remove("hidden");
            idempotencyKey = makeIdempotencyKey();
        } catch (error) {
            showMessage(error.message, "error");
        } finally {
            el.submit.disabled = false;
        }
    });

    loadBrand();
})();
