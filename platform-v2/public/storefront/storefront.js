(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
    const SECTOR_COPY = Object.freeze({
        restaurant: ["Restoran & Online Menü", "Menüyü inceleyin, favorilerinizi seçin ve işletmeyle hemen iletişime geçin."],
        cafe: ["Kafe & Dijital Menü", "Menüyü, ürünleri ve işletmenin online hizmetlerini tek sayfada keşfedin."],
        market: ["Market & Online Katalog", "Güncel ürünleri inceleyin ve siparişinizi hızlıca hazırlayın."],
        barber: ["Berber & Online Randevu", "Hizmetleri inceleyin ve randevu için işletmeyle iletişime geçin."],
        beauty: ["Güzellik & Bakım", "Hizmetleri keşfedin ve size uygun randevu için iletişime geçin."],
        clinic: ["Klinik & Hizmetler", "Hizmetleri ve iletişim bilgilerini tek noktadan inceleyin."],
        hotel: ["Konaklama & Rezervasyon", "Oda ve hizmet seçeneklerini inceleyip rezervasyon için iletişime geçin."],
        retail: ["Mağaza & Online Katalog", "Ürünleri keşfedin ve işletmeyle doğrudan iletişime geçin."],
        "auto-expertise": ["Oto Ekspertiz & Randevu", "Paketleri inceleyin ve aracınız için randevu talebi oluşturun."],
        "rent-a-car": ["Araç Kiralama & Rezervasyon", "Araç seçeneklerini inceleyip rezervasyon için iletişime geçin."],
        "manufacturing-b2b": ["Üretim & B2B", "Ürün portföyünü inceleyin ve ticari teklif talebinizi iletin."],
        "wholesale-b2b": ["Toptan & B2B", "Ürünleri inceleyin ve toplu alım teklifinizi işletmeye iletin."],
        "professional-services": ["Profesyonel Hizmetler", "Hizmetleri inceleyin, randevu veya teklif için iletişime geçin."],
        general: ["Dijital İşletme", "İşletmenin hizmetleri ve iletişim bilgileri artık tek bağlantıda."]
    });
    const MODULES = Object.freeze({
        orders: Object.freeze({ icon: "🛒", title: "Sipariş", text: "Ürünleri seçip siparişinizi hızlıca hazırlayın.", action: "Siparişe Başla" }),
        appointments: Object.freeze({ icon: "📅", title: "Randevu", text: "Uygun randevu için işletmeyle hemen iletişime geçin.", action: "Randevu İste" }),
        reservations: Object.freeze({ icon: "🗓️", title: "Rezervasyon", text: "Rezervasyon talebinizi doğrudan işletmeye iletin.", action: "Rezervasyon İste" }),
        quotes: Object.freeze({ icon: "📄", title: "Teklif", text: "Ürün veya hizmet için hızlı teklif talebi oluşturun.", action: "Teklif İste" }),
        fleet: Object.freeze({ icon: "🚘", title: "Filo", text: "Araç ve filo seçenekleri hakkında bilgi alın.", action: "Bilgi Al" }),
        whatsapp: Object.freeze({ icon: "💬", title: "WhatsApp", text: "İşletmeye WhatsApp üzerinden doğrudan ulaşın.", action: "Mesaj Gönder" })
    });

    const el = Object.freeze({
        loading: document.getElementById("loading"),
        errorView: document.getElementById("error-view"),
        errorMessage: document.getElementById("error-message"),
        retry: document.getElementById("retry-button"),
        storefront: document.getElementById("storefront"),
        logo: document.getElementById("logo"),
        logoFallback: document.getElementById("logo-fallback"),
        headerBrand: document.getElementById("header-brand"),
        headerSector: document.getElementById("header-sector"),
        headerWhatsapp: document.getElementById("header-whatsapp"),
        share: document.getElementById("share-button"),
        sectorBadge: document.getElementById("sector-badge"),
        heroTitle: document.getElementById("hero-title"),
        heroText: document.getElementById("hero-text"),
        heroActions: document.getElementById("hero-actions"),
        contactChips: document.getElementById("contact-chips"),
        moduleSection: document.getElementById("module-section"),
        moduleGrid: document.getElementById("module-grid"),
        catalogSection: document.getElementById("catalog-section"),
        catalogTitle: document.getElementById("catalog-title"),
        catalogSubtitle: document.getElementById("catalog-subtitle"),
        catalogSearch: document.getElementById("catalog-search"),
        categoryList: document.getElementById("category-list"),
        productGrid: document.getElementById("product-grid"),
        addressCard: document.getElementById("address-card"),
        addressText: document.getElementById("address-text"),
        phoneCard: document.getElementById("phone-card"),
        phoneText: document.getElementById("phone-text"),
        websiteCard: document.getElementById("website-card"),
        websiteLink: document.getElementById("website-link"),
        emailCard: document.getElementById("email-card"),
        emailLink: document.getElementById("email-link"),
        footerBrand: document.getElementById("footer-brand"),
        cartBar: document.getElementById("cart-bar"),
        cartCount: document.getElementById("cart-count"),
        cartTotal: document.getElementById("cart-total"),
        cartOpen: document.getElementById("cart-open"),
        cartModal: document.getElementById("cart-modal"),
        cartClose: document.getElementById("cart-close"),
        cartItems: document.getElementById("cart-items"),
        modalTotal: document.getElementById("modal-total"),
        cartWhatsapp: document.getElementById("cart-whatsapp"),
        toast: document.getElementById("toast")
    });

    const state = {
        tenantId: "",
        tenant: null,
        products: [],
        activeCategory: "Tümü",
        search: "",
        cart: new Map()
    };

    function showToast(text) {
        el.toast.textContent = text;
        el.toast.classList.add("show");
        window.setTimeout(() => el.toast.classList.remove("show"), 2300);
    }

    function readTenantId() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 2 || parts[0] !== "m") return "";
        const candidate = decodeURIComponent(parts[1]);
        return TENANT_ID_PATTERN.test(candidate) && candidate.length >= 3 ? candidate : "";
    }

    function phoneDigits(value) {
        return String(value || "").replace(/\D/g, "").replace(/^00/, "");
    }

    function telHref(value) {
        const digits = phoneDigits(value);
        return digits ? `tel:+${digits.replace(/^0+/, "")}` : "";
    }

    function whatsappHref(value, text = "") {
        let digits = phoneDigits(value);
        if (digits.startsWith("0")) digits = `90${digits.slice(1)}`;
        if (!digits) return "";
        const query = text ? `?text=${encodeURIComponent(text)}` : "";
        return `https://wa.me/${digits}${query}`;
    }

    function money(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return "—";
        return `${number.toLocaleString("tr-TR", {
            minimumFractionDigits: Number.isInteger(number) ? 0 : 2,
            maximumFractionDigits: 2
        })} ₺`;
    }

    function copyForSector(sector) {
        return SECTOR_COPY[sector] || ["Dijital İşletme", "Ürünleri, hizmetleri ve işletme bilgilerini tek sayfadan inceleyin."];
    }

    function actionLink(text, href, secondary = false) {
        const link = document.createElement("a");
        link.className = "hero-action";
        if (secondary) link.classList.add("secondary");
        link.textContent = text;
        link.href = href;
        if (href.startsWith("http")) {
            link.target = "_blank";
            link.rel = "noopener";
        }
        return link;
    }

    function contactChip(text, href) {
        const link = document.createElement("a");
        link.className = "contact-chip";
        link.textContent = text;
        link.href = href;
        if (href.startsWith("http")) {
            link.target = "_blank";
            link.rel = "noopener";
        }
        return link;
    }

    function moduleContactHref(title) {
        const profile = state.tenant.profile || {};
        const wa = whatsappHref(
            profile.whatsapp,
            `Merhaba, ${state.tenant.profile?.brandName || state.tenant.displayName} için ${title.toLocaleLowerCase("tr-TR")} hakkında bilgi almak istiyorum.`
        );
        if (wa) return wa;
        return telHref(profile.phone) || "#contact";
    }

    function renderBrand() {
        const tenant = state.tenant;
        const profile = tenant.profile || {};
        const name = profile.brandName || tenant.displayName || tenant.tenantId;
        const [sectorLabel, heroText] = copyForSector(tenant.sector);

        document.title = `${name} | Dijital İşletme`;
        if (COLOR_PATTERN.test(profile.primaryColor || "")) {
            document.documentElement.style.setProperty("--brand", profile.primaryColor);
            const metaTheme = document.querySelector('meta[name="theme-color"]');
            if (metaTheme) metaTheme.setAttribute("content", profile.primaryColor);
        }

        el.headerBrand.textContent = name;
        el.headerSector.textContent = sectorLabel;
        el.sectorBadge.textContent = sectorLabel;
        el.heroTitle.textContent = name;
        el.heroText.textContent = heroText;
        el.footerBrand.textContent = name;
        el.logoFallback.textContent = name.trim().slice(0, 1).toLocaleUpperCase("tr-TR") || "İ";

        if (profile.logoUrl) {
            el.logo.src = profile.logoUrl;
            el.logo.onload = () => {
                el.logo.classList.remove("hidden");
                el.logoFallback.classList.add("hidden");
            };
            el.logo.onerror = () => {
                el.logo.classList.add("hidden");
                el.logoFallback.classList.remove("hidden");
            };
        }

        const wa = whatsappHref(profile.whatsapp);
        if (wa && tenant.features?.whatsapp) {
            el.headerWhatsapp.href = wa;
            el.headerWhatsapp.classList.remove("hidden");
        } else {
            el.headerWhatsapp.classList.add("hidden");
        }
    }

    function renderHeroActions() {
        el.heroActions.replaceChildren();
        el.contactChips.replaceChildren();
        const profile = state.tenant.profile || {};
        const features = state.tenant.features || {};

        if (features.catalog && state.products.length) {
            el.heroActions.append(actionLink("Ürünleri İncele", "#catalog-section"));
        }
        if (features.appointments) {
            el.heroActions.append(actionLink("Randevu İste", moduleContactHref("Randevu"), !features.catalog));
        } else if (features.reservations) {
            el.heroActions.append(actionLink("Rezervasyon İste", moduleContactHref("Rezervasyon"), !features.catalog));
        } else if (features.quotes) {
            el.heroActions.append(actionLink("Teklif İste", moduleContactHref("Teklif"), !features.catalog));
        }

        const phone = telHref(profile.phone);
        const wa = whatsappHref(profile.whatsapp);
        if (phone) el.contactChips.append(contactChip(`☎ ${profile.phone}`, phone));
        if (wa && features.whatsapp) el.contactChips.append(contactChip("💬 WhatsApp", wa));
        if (profile.address) {
            const chip = document.createElement("span");
            chip.className = "contact-chip";
            chip.textContent = `⌖ ${profile.address}`;
            el.contactChips.append(chip);
        }
    }

    function renderModules() {
        el.moduleGrid.replaceChildren();
        const features = state.tenant.features || {};
        const active = Object.keys(MODULES).filter(key => features[key] === true);
        if (!active.length) {
            el.moduleSection.classList.add("hidden");
            return;
        }

        for (const key of active) {
            const module = MODULES[key];
            const card = document.createElement("article");
            card.className = "module-card";
            const icon = document.createElement("div");
            icon.className = "module-icon";
            icon.textContent = module.icon;
            const title = document.createElement("h3");
            title.textContent = module.title;
            const text = document.createElement("p");
            text.textContent = module.text;
            const action = document.createElement("a");
            action.textContent = module.action;
            action.href = key === "orders" && state.products.length
                ? "#catalog-section"
                : moduleContactHref(module.title);
            if (action.href.startsWith("http")) {
                action.target = "_blank";
                action.rel = "noopener";
            }
            card.append(icon, title, text, action);
            el.moduleGrid.append(card);
        }
        el.moduleSection.classList.remove("hidden");
    }

    function categories() {
        return ["Tümü", ...new Set(state.products.map(product => product.category))];
    }

    function renderCategories() {
        el.categoryList.replaceChildren();
        for (const category of categories()) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "category-button";
            if (category === state.activeCategory) button.classList.add("active");
            button.textContent = category;
            button.addEventListener("click", () => {
                state.activeCategory = category;
                renderCategories();
                renderProducts();
            });
            el.categoryList.append(button);
        }
    }

    function canUseWhatsAppCart() {
        return state.tenant?.features?.orders === true &&
            state.tenant?.features?.whatsapp === true &&
            Boolean(whatsappHref(state.tenant?.profile?.whatsapp));
    }

    function addToCart(product) {
        const current = state.cart.get(product.productId);
        state.cart.set(product.productId, {
            product,
            quantity: current ? current.quantity + 1 : 1
        });
        renderCartBar();
        showToast("Sepete eklendi.");
    }

    function productCard(product) {
        const card = document.createElement("article");
        card.className = "product-card";
        const category = document.createElement("small");
        category.textContent = product.category;
        const title = document.createElement("h3");
        title.textContent = product.name;
        const description = document.createElement("p");
        description.textContent = product.description || "İşletmenin güncel ürün/hizmet seçeneği.";
        const bottom = document.createElement("div");
        bottom.className = "product-bottom";
        const price = document.createElement("div");
        price.className = "product-price";
        price.textContent = money(product.price);
        bottom.append(price);
        if (canUseWhatsAppCart()) {
            const add = document.createElement("button");
            add.type = "button";
            add.className = "add-button";
            add.textContent = "+ Sepete Ekle";
            add.addEventListener("click", () => addToCart(product));
            bottom.append(add);
        }
        card.append(category, title, description, bottom);
        return card;
    }

    function renderProducts() {
        el.productGrid.replaceChildren();
        const query = state.search.toLocaleLowerCase("tr-TR");
        const filtered = state.products.filter(product => {
            const inCategory = state.activeCategory === "Tümü" || product.category === state.activeCategory;
            const haystack = `${product.name} ${product.description} ${product.category}`.toLocaleLowerCase("tr-TR");
            return inCategory && (!query || haystack.includes(query));
        });
        if (!filtered.length) {
            const empty = document.createElement("div");
            empty.className = "info-card";
            empty.textContent = "Aramanızla eşleşen ürün veya hizmet bulunamadı.";
            el.productGrid.append(empty);
            return;
        }
        for (const product of filtered) el.productGrid.append(productCard(product));
    }

    function renderCatalog() {
        if (state.tenant.features?.catalog !== true || !state.products.length) {
            el.catalogSection.classList.add("hidden");
            return;
        }
        const sector = state.tenant.sector;
        const serviceSectors = new Set(["barber", "beauty", "clinic", "auto-expertise", "professional-services"]);
        if (serviceSectors.has(sector)) {
            el.catalogTitle.textContent = "Hizmetler & Paketler";
            el.catalogSubtitle.textContent = "Güncel hizmet seçeneklerini ve fiyatları inceleyin.";
        } else if (sector.includes("b2b")) {
            el.catalogTitle.textContent = "Ürün Portföyü";
            el.catalogSubtitle.textContent = "Ürünleri inceleyip ticari teklif için işletmeyle iletişime geçin.";
        } else {
            el.catalogTitle.textContent = "Ürünler & Menü";
            el.catalogSubtitle.textContent = "Güncel seçenekleri, kategorileri ve fiyatları inceleyin.";
        }
        state.activeCategory = "Tümü";
        renderCategories();
        renderProducts();
        el.catalogSection.classList.remove("hidden");
    }

    function renderContactInfo() {
        const profile = state.tenant.profile || {};
        if (profile.address) {
            el.addressText.textContent = profile.address;
            el.addressCard.classList.remove("hidden");
        }
        if (profile.phone) {
            el.phoneText.textContent = profile.phone;
            el.phoneCard.classList.remove("hidden");
        }
        if (profile.website) {
            el.websiteLink.href = profile.website;
            el.websiteCard.classList.remove("hidden");
        }
        if (profile.email) {
            el.emailLink.textContent = profile.email;
            el.emailLink.href = `mailto:${profile.email}`;
            el.emailCard.classList.remove("hidden");
        }
    }

    function cartSummary() {
        let count = 0;
        let total = 0;
        for (const { product, quantity } of state.cart.values()) {
            count += quantity;
            total += product.price * quantity;
        }
        return { count, total: Math.round(total * 100) / 100 };
    }

    function renderCartBar() {
        const { count, total } = cartSummary();
        el.cartCount.textContent = String(count);
        el.cartTotal.textContent = money(total);
        el.cartBar.classList.toggle("hidden", !canUseWhatsAppCart() || count === 0);
    }

    function changeCart(productId, delta) {
        const current = state.cart.get(productId);
        if (!current) return;
        const quantity = current.quantity + delta;
        if (quantity <= 0) state.cart.delete(productId);
        else state.cart.set(productId, { ...current, quantity });
        renderCartBar();
        renderCartModal();
    }

    function renderCartModal() {
        el.cartItems.replaceChildren();
        if (!state.cart.size) {
            const empty = document.createElement("p");
            empty.className = "muted-note";
            empty.textContent = "Sepetiniz boş.";
            el.cartItems.append(empty);
        } else {
            for (const { product, quantity } of state.cart.values()) {
                const row = document.createElement("div");
                row.className = "cart-item";
                const info = document.createElement("div");
                const name = document.createElement("strong");
                name.textContent = product.name;
                const price = document.createElement("small");
                price.textContent = `${money(product.price)} × ${quantity}`;
                const controls = document.createElement("div");
                controls.className = "cart-controls";
                const minus = document.createElement("button");
                minus.type = "button";
                minus.textContent = "−";
                minus.addEventListener("click", () => changeCart(product.productId, -1));
                const qty = document.createElement("strong");
                qty.textContent = String(quantity);
                const plus = document.createElement("button");
                plus.type = "button";
                plus.textContent = "+";
                plus.addEventListener("click", () => changeCart(product.productId, 1));
                controls.append(minus, qty, plus);
                info.append(name, price, controls);
                const lineTotal = document.createElement("strong");
                lineTotal.textContent = money(product.price * quantity);
                row.append(info, lineTotal);
                el.cartItems.append(row);
            }
        }
        el.modalTotal.textContent = money(cartSummary().total);
        el.cartWhatsapp.disabled = state.cart.size === 0;
    }

    function openCart() {
        if (!canUseWhatsAppCart()) return;
        renderCartModal();
        el.cartModal.classList.remove("hidden");
    }

    function closeCart() {
        el.cartModal.classList.add("hidden");
    }

    function sendCartToWhatsApp() {
        if (!state.cart.size) return;
        const name = state.tenant.profile?.brandName || state.tenant.displayName;
        const lines = [`Merhaba ${name}, sipariş vermek istiyorum:`, ""];
        for (const { product, quantity } of state.cart.values()) {
            lines.push(`• ${product.name} × ${quantity} — ${money(product.price * quantity)}`);
        }
        lines.push("", `Toplam: ${money(cartSummary().total)}`, `Menü: ${window.location.href}`);
        const href = whatsappHref(state.tenant.profile?.whatsapp, lines.join("\n"));
        if (href) window.open(href, "_blank", "noopener");
    }

    async function sharePage() {
        const name = state.tenant?.profile?.brandName || state.tenant?.displayName || "İşletme";
        try {
            if (navigator.share) {
                await navigator.share({ title: name, url: window.location.href });
                return;
            }
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(window.location.href);
                showToast("Bağlantı kopyalandı.");
                return;
            }
            showToast("Bağlantıyı adres çubuğundan paylaşabilirsiniz.");
        } catch {
            // User-cancelled share actions do not need an error surface.
        }
    }

    function renderStorefront(payload) {
        const storefront = payload?.storefront;
        if (!storefront?.tenant || storefront.tenant.tenantId !== state.tenantId ||
            !Array.isArray(storefront.products)) {
            throw new Error("İşletme verisi doğrulanamadı.");
        }
        state.tenant = storefront.tenant;
        state.products = storefront.products;
        state.cart.clear();
        state.search = "";
        el.catalogSearch.value = "";
        renderBrand();
        renderHeroActions();
        renderModules();
        renderCatalog();
        renderContactInfo();
        renderCartBar();
        el.errorView.classList.add("hidden");
        el.loading.classList.add("hidden");
        el.storefront.classList.remove("hidden");
    }

    function showError(message) {
        el.loading.classList.add("hidden");
        el.storefront.classList.add("hidden");
        el.errorMessage.textContent = message;
        el.errorView.classList.remove("hidden");
    }

    async function load() {
        state.tenantId = readTenantId();
        if (!state.tenantId) {
            showError("İşletme bağlantısı geçersiz.");
            return;
        }
        el.errorView.classList.add("hidden");
        el.storefront.classList.add("hidden");
        el.loading.classList.remove("hidden");
        try {
            const response = await fetch(`/api/public/storefront/${encodeURIComponent(state.tenantId)}`, {
                headers: { Accept: "application/json" }
            });
            let body = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }
            if (!response.ok) {
                throw new Error(body?.message || "İşletme sayfası yüklenemedi.");
            }
            renderStorefront(body);
        } catch (error) {
            showError(error.message || "İşletme sayfası yüklenemedi.");
        }
    }

    el.retry.addEventListener("click", load);
    el.share.addEventListener("click", sharePage);
    el.catalogSearch.addEventListener("input", () => {
        state.search = el.catalogSearch.value.trim();
        renderProducts();
    });
    el.cartOpen.addEventListener("click", openCart);
    el.cartClose.addEventListener("click", closeCart);
    el.cartWhatsapp.addEventListener("click", sendCartToWhatsApp);
    el.cartModal.addEventListener("click", event => {
        if (event.target === el.cartModal) closeCart();
    });

    load();
})();
