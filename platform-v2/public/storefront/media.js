(() => {
    "use strict";

    const grid = document.getElementById("product-grid");
    if (!grid) return;

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const state = { products: [], galleryEnabled: false };

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

    function money(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        return `${number.toLocaleString("tr-TR", {
            minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
            maximumFractionDigits: 2
        })} ₺`;
    }

    function keyForProduct(product) {
        return [
            String(product.name || ""),
            String(product.category || ""),
            money(product.price),
            String(product.description || "İşletmenin güncel ürün/hizmet seçeneği.")
        ].join("\u0000");
    }

    function keyForCard(card) {
        const title = card.querySelector("h3")?.textContent || "";
        const category = card.querySelector("small")?.textContent || "";
        const price = card.querySelector(".product-price")?.textContent || "";
        const description = card.querySelector("p")?.textContent || "";
        return [title, category, price, description].join("\u0000");
    }

    function decorate() {
        if (!state.galleryEnabled || !state.products.length) return;
        const byKey = new Map();
        for (const product of state.products) {
            if (typeof product?.imageUrl !== "string" || !product.imageUrl.startsWith("https://")) continue;
            const key = keyForProduct(product);
            if (!byKey.has(key)) byKey.set(key, []);
            byKey.get(key).push(product.imageUrl);
        }

        for (const card of grid.querySelectorAll(".product-card")) {
            if (card.querySelector(".product-media-frame")) continue;
            const candidates = byKey.get(keyForCard(card));
            if (!candidates?.length) continue;
            const imageUrl = candidates.shift();

            const frame = document.createElement("div");
            frame.className = "product-media-frame";
            const image = document.createElement("img");
            image.src = imageUrl;
            image.alt = card.querySelector("h3")?.textContent || "Ürün görseli";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => frame.remove(), { once: true });
            frame.append(image);
            card.prepend(frame);
        }
    }

    async function applyProductsFromResponse(response) {
        try {
            if (!response?.ok) return;
            const payload = await response.clone().json();
            const storefront = payload?.storefront;
            if (storefront?.tenant?.tenantId !== tenantId || !Array.isArray(storefront.products)) return;
            state.galleryEnabled = storefront.tenant?.features?.gallery === true;
            state.products = storefront.products;
            decorate();
        } catch {
            // Storefront remains usable without optional product media decoration.
        }
    }

    const observer = new MutationObserver(() => decorate());
    observer.observe(grid, { childList: true });

    window.fetch = async (...args) => {
        const response = await originalFetch(...args);
        if (isCurrentStorefrontRequest(args[0])) {
            void applyProductsFromResponse(response);
        }
        return response;
    };
})();
