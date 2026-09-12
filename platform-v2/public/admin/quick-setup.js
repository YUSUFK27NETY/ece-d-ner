(() => {
    "use strict";

    const bootstrap = window.PLATFORM_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const FEATURE_LABELS = Object.freeze({
        catalog: "Katalog", orders: "Sipariş", appointments: "Randevu",
        reservations: "Rezervasyon", whatsapp: "WhatsApp", inventory: "Stok",
        quotes: "Teklif", crm: "CRM", fleet: "Filo", gallery: "Galeri"
    });
    const READINESS_LABELS = Object.freeze({
        profile: "Profil", health: "Sistem sağlığı", plan: "Plan",
        adminBootstrap: "Owner / Admin Bootstrap", backup: "Backup",
        security: "Security Review", domain: "Domain (opsiyonel)"
    });

    const byId = id => document.getElementById(id);
    const el = Object.freeze({
        session: byId("wizard-session"), message: byId("wizard-message"),
        tenantId: byId("tenant-id"), displayName: byId("display-name"),
        templateId: byId("template-id"), sector: byId("sector"), plan: byId("plan"),
        templateSummary: byId("template-summary"), featureGrid: byId("feature-grid"),
        tenantStatus: byId("tenant-status"), loadTenant: byId("load-tenant"),
        saveBusiness: byId("save-business"), saveProfile: byId("save-profile"),
        brandName: byId("brand-name"), phone: byId("phone"), whatsapp: byId("whatsapp"),
        contactEmail: byId("contact-email"), instagramUrl: byId("instagram-url"),
        googleUrl: byId("google-url"), website: byId("website"), logoUrl: byId("logo-url"),
        primaryColor: byId("primary-color"), timezone: byId("timezone"),
        address: byId("address"), businessHours: byId("business-hours"),
        profileState: byId("profile-state"), minimumChecks: byId("minimum-checks"),
        contentState: byId("content-state"), catalogStatus: byId("catalog-status"),
        productName: byId("product-name"), productCategory: byId("product-category"),
        productPrice: byId("product-price"), createProduct: byId("create-product"),
        ownerUid: byId("owner-uid"), bindOwner: byId("bind-owner"),
        firebaseUsers: byId("firebase-users"), readinessState: byId("readiness-state"),
        readinessChecks: byId("readiness-checks"), refreshReadiness: byId("refresh-readiness"),
        securityReviewLink: byId("security-review-link"), backupLink: byId("backup-link"),
        activationState: byId("activation-state"), tenantPreview: byId("tenant-preview"),
        activateTenant: byId("activate-tenant"), deliveryState: byId("delivery-state"),
        deliveryLinks: byId("delivery-links"), qrBox: byId("qr-box"),
        qrPreview: byId("qr-preview"), downloadQr: byId("download-qr")
    });

    const state = {
        templates: new Map(), featureKeys: Object.freeze([]), tenant: null,
        readiness: null, products: [], catalogState: "unknown", delivery: null,
        qrUrl: null, qrBlob: null, busy: false
    };

    function setMessage(text = "", type = "") {
        el.message.textContent = text;
        el.message.classList.remove("error", "success");
        if (type) el.message.classList.add(type);
    }

    function setBadge(node, text, status = "") {
        node.textContent = text;
        node.className = "badge";
        if (status) node.classList.add(status);
    }

    function canonicalTenantId(value) {
        const raw = String(value ?? "");
        const tenantId = raw.trim().toLowerCase();
        if (raw !== tenantId || tenantId.length < 3 || tenantId.length > 63 ||
            !TENANT_ID_PATTERN.test(tenantId)) {
            throw new Error("Tenant ID 3-63 karakter olmalı; küçük harf, rakam ve iç konumlarda tire kullan.");
        }
        return tenantId;
    }

    function safeText(value) {
        return typeof value === "string" ? value : "";
    }

    function optionalInput(input) {
        const value = input.value.trim();
        return value || null;
    }

    async function getIdToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken();
    }

    async function apiRequest(path, options = {}) {
        const token = await getIdToken();
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        const response = await fetch(path, { ...options, headers });
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    async function apiBlob(path) {
        const token = await getIdToken();
        const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) {
            let body = null;
            try { body = await response.json(); } catch { body = null; }
            const error = new Error(body?.message || `QR alınamadı (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return response.blob();
    }

    function featureLabel(key) {
        return FEATURE_LABELS[key] || key.replace(/[-_]/g, " ");
    }

    function validateTemplateCatalog(raw) {
        const templates = raw?.templates;
        if (raw?.schemaVersion !== 1 || !Array.isArray(templates) || templates.length < 1) {
            throw new Error("Sektör şablonu kataloğu geçersiz.");
        }
        const firstFeatures = templates[0]?.features;
        if (!firstFeatures || typeof firstFeatures !== "object" || Array.isArray(firstFeatures)) {
            throw new Error("Sektör feature kataloğu geçersiz.");
        }
        const featureKeys = Object.keys(firstFeatures).sort();
        if (featureKeys.length < 1 || featureKeys.length > 50) throw new Error("Feature kataloğu geçersiz.");
        const map = new Map();
        for (const template of templates) {
            const keys = Object.keys(template?.features || {}).sort();
            if (typeof template?.id !== "string" || typeof template?.label !== "string" ||
                typeof template?.sector !== "string" || keys.length !== featureKeys.length ||
                !keys.every((key, index) => key === featureKeys[index]) ||
                keys.some(key => typeof template.features[key] !== "boolean")) {
                throw new Error("Sektör şablonu geçersiz.");
            }
            map.set(template.id, Object.freeze({
                id: template.id, label: template.label, sector: template.sector,
                description: safeText(template.description), features: Object.freeze({ ...template.features })
            }));
        }
        return Object.freeze({ map, featureKeys: Object.freeze(featureKeys) });
    }

    function renderFeatureGrid() {
        const fragment = document.createDocumentFragment();
        for (const key of state.featureKeys) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox";
            input.dataset.feature = key;
            label.append(input, document.createTextNode(` ${featureLabel(key)}`));
            fragment.append(label);
        }
        el.featureGrid.replaceChildren(fragment);
    }

    function featureInputs() {
        return new Map([...el.featureGrid.querySelectorAll("input[data-feature]")]
            .map(input => [input.dataset.feature, input]));
    }

    function collectFeatures() {
        const inputs = featureInputs();
        const features = {};
        for (const key of state.featureKeys) {
            const input = inputs.get(key);
            if (!input) throw new Error("Feature alanları eksik.");
            features[key] = input.checked;
        }
        return features;
    }

    function applyFeatures(features) {
        const inputs = featureInputs();
        for (const key of state.featureKeys) {
            if (inputs.has(key)) inputs.get(key).checked = features?.[key] === true;
        }
    }

    async function loadTemplates() {
        const body = await apiRequest("/api/platform/sector-templates");
        const catalog = validateTemplateCatalog(body?.catalog);
        state.templates = catalog.map;
        state.featureKeys = catalog.featureKeys;
        renderFeatureGrid();
        el.templateId.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Sektör şablonu seç";
        el.templateId.append(placeholder);
        for (const template of state.templates.values()) {
            const option = document.createElement("option");
            option.value = template.id;
            option.textContent = template.label;
            el.templateId.append(option);
        }
    }

    function applySelectedTemplate() {
        if (state.tenant) return;
        const template = state.templates.get(el.templateId.value);
        if (!template) {
            el.sector.value = "";
            el.templateSummary.textContent = "Şablon server tarafından öneri olarak gelir; modülleri kaydetmeden önce değiştirebilirsin.";
            return;
        }
        el.sector.value = template.sector;
        applyFeatures(template.features);
        const enabled = state.featureKeys.filter(key => template.features[key]).map(featureLabel);
        el.templateSummary.textContent = `${template.description} Önerilen modüller: ${enabled.join(", ") || "yok"}.`;
    }

    function collectProfile() {
        return {
            brandName: optionalInput(el.brandName), phone: optionalInput(el.phone),
            whatsapp: optionalInput(el.whatsapp), email: optionalInput(el.contactEmail),
            website: optionalInput(el.website), instagramUrl: optionalInput(el.instagramUrl),
            googleUrl: optionalInput(el.googleUrl), logoUrl: optionalInput(el.logoUrl),
            primaryColor: optionalInput(el.primaryColor), address: optionalInput(el.address),
            businessHours: optionalInput(el.businessHours),
            timezone: el.timezone.value.trim() || "Europe/Istanbul"
        };
    }

    function populateProfile(profile = {}) {
        el.brandName.value = safeText(profile.brandName); el.phone.value = safeText(profile.phone);
        el.whatsapp.value = safeText(profile.whatsapp); el.contactEmail.value = safeText(profile.email);
        el.website.value = safeText(profile.website); el.instagramUrl.value = safeText(profile.instagramUrl);
        el.googleUrl.value = safeText(profile.googleUrl); el.logoUrl.value = safeText(profile.logoUrl);
        el.primaryColor.value = safeText(profile.primaryColor); el.address.value = safeText(profile.address);
        el.businessHours.value = safeText(profile.businessHours);
        el.timezone.value = safeText(profile.timezone) || "Europe/Istanbul";
    }

    function lockIdentityForExisting() {
        const existing = Boolean(state.tenant);
        el.tenantId.disabled = existing;
        el.templateId.disabled = existing;
        el.sector.readOnly = true;
        if (existing) {
            el.templateId.value = "";
            el.templateSummary.textContent = "Mevcut tenant: şablon otomatik yeniden uygulanmaz. Kayıtlı modüller doğrudan gösteriliyor.";
        }
    }

    function setMutableControls() {
        const mutable = !state.tenant || state.tenant.status === "provisioning";
        for (const node of [el.displayName, el.plan, el.brandName, el.phone, el.whatsapp,
            el.contactEmail, el.website, el.instagramUrl, el.googleUrl, el.logoUrl,
            el.primaryColor, el.timezone, el.address, el.businessHours]) {
            node.disabled = state.busy || !mutable;
        }
        for (const input of featureInputs().values()) input.disabled = state.busy || !mutable;
        el.saveBusiness.disabled = state.busy || !mutable;
        el.saveProfile.disabled = state.busy || !state.tenant || !mutable;
        el.loadTenant.disabled = state.busy || Boolean(state.tenant);
        el.createProduct.disabled = state.busy || !state.tenant || !mutable ||
            state.tenant.features?.catalog !== true;
        const ownerReady = state.readiness?.checks?.adminBootstrap?.status === "ready";
        el.ownerUid.disabled = state.busy || !state.tenant || !mutable || ownerReady;
        el.bindOwner.disabled = state.busy || !state.tenant || !mutable || ownerReady;
        el.refreshReadiness.disabled = state.busy || !state.tenant;
        syncActivationButton();
    }

    function setBusy(value) {
        state.busy = value;
        setMutableControls();
    }

    function profileChecklist() {
        const tenant = state.tenant;
        const profile = tenant?.profile || {};
        const catalogRequired = tenant?.features?.catalog === true;
        return Object.freeze([
            { key: "brand", label: "Marka", ready: Boolean(profile.brandName), detail: profile.brandName ? "Marka adı kayıtlı." : "Marka adı eksik." },
            { key: "contact", label: "İletişim", ready: Boolean(profile.phone || profile.whatsapp || profile.email), detail: profile.phone || profile.whatsapp || profile.email ? "En az bir iletişim kanalı kayıtlı." : "Telefon, WhatsApp veya e-posta gerekli." },
            { key: "hours", label: "Çalışma saatleri", ready: Boolean(profile.businessHours), detail: profile.businessHours ? "Çalışma saatleri kayıtlı." : "Çalışma saatleri eksik." },
            { key: "catalog", label: "Katalog / hizmet içeriği", ready: !catalogRequired || state.catalogState === "ready", detail: !catalogRequired ? "Catalog modülü bu tenant için kapalı; zorunlu değil." : state.catalogState === "ready" ? `${state.products.length} aktif öğe bulundu.` : state.catalogState === "unavailable" ? "Catalog durumu doğrulanamadı." : "En az bir aktif katalog/hizmet öğesi ekle." }
        ]);
    }

    function renderMinimumChecks() {
        if (!state.tenant) {
            el.minimumChecks.replaceChildren();
            setBadge(el.profileState, "Bekliyor");
            setBadge(el.contentState, "Bekliyor");
            return false;
        }
        const checks = profileChecklist();
        const fragment = document.createDocumentFragment();
        for (const check of checks) {
            const card = document.createElement("div");
            card.className = `check-item ${check.ready ? "ready" : "pending"}`;
            const strong = document.createElement("strong");
            strong.textContent = `${check.ready ? "✓" : "○"} ${check.label}`;
            const small = document.createElement("small");
            small.textContent = check.detail;
            card.append(strong, small);
            fragment.append(card);
        }
        el.minimumChecks.replaceChildren(fragment);
        const profileReady = checks.filter(check => check.key !== "catalog").every(check => check.ready);
        const allReady = checks.every(check => check.ready);
        setBadge(el.profileState, profileReady ? "Hazır" : "Eksik", profileReady ? "ready" : "pending");
        setBadge(el.contentState, allReady ? "Hazır" : "Eksik", allReady ? "ready" : "pending");
        return allReady;
    }

    function renderReadiness() {
        el.readinessChecks.replaceChildren();
        const readiness = state.readiness;
        if (!readiness) {
            setBadge(el.readinessState, "Bekliyor");
            return;
        }
        setBadge(el.readinessState, readiness.activationReadiness, readiness.activationReadiness);
        const fragment = document.createDocumentFragment();
        for (const [source, check] of Object.entries(readiness.checks || {})) {
            const card = document.createElement("div");
            card.className = `check-item ${check.status}`;
            const strong = document.createElement("strong");
            strong.textContent = `${READINESS_LABELS[source] || source}: ${check.status}`;
            const small = document.createElement("small");
            small.textContent = check.code || "Hazır";
            card.append(strong, small);
            fragment.append(card);
        }
        el.readinessChecks.append(fragment);
    }

    function appendPreviewMetric(parent, label, value) {
        const box = document.createElement("div");
        const strong = document.createElement("strong"); strong.textContent = label;
        const valueNode = document.createElement("div"); valueNode.textContent = value || "—";
        box.append(strong, valueNode); parent.append(box);
    }

    function renderPreview() {
        el.tenantPreview.replaceChildren();
        if (!state.tenant) return;
        const title = document.createElement("h3");
        title.textContent = state.tenant.profile?.brandName || state.tenant.displayName;
        const subtitle = document.createElement("p");
        subtitle.className = "muted";
        subtitle.textContent = `${state.tenant.tenantId} · ${state.tenant.sector} · ${state.tenant.status}`;
        const meta = document.createElement("div"); meta.className = "preview-meta";
        appendPreviewMetric(meta, "İletişim", state.tenant.profile?.phone || state.tenant.profile?.whatsapp || state.tenant.profile?.email);
        appendPreviewMetric(meta, "Çalışma saatleri", state.tenant.profile?.businessHours);
        appendPreviewMetric(meta, "Aktif modüller", Object.entries(state.tenant.features || {}).filter(([, enabled]) => enabled).map(([key]) => featureLabel(key)).join(", "));
        appendPreviewMetric(meta, "Readiness", state.readiness?.activationReadiness || "—");
        el.tenantPreview.append(title, subtitle, meta);
    }

    function clearQr() {
        if (state.qrUrl) URL.revokeObjectURL(state.qrUrl);
        state.qrUrl = null; state.qrBlob = null;
        el.qrPreview.replaceChildren(); el.qrBox.classList.add("hidden");
    }

    function createDeliveryItem(label, url) {
        const card = document.createElement("div"); card.className = "delivery-item";
        const strong = document.createElement("strong"); strong.textContent = label;
        if (url) {
            const link = document.createElement("a"); link.href = url; link.textContent = url;
            link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(strong, link);
        } else {
            const small = document.createElement("small"); small.textContent = "Yapılandırılmadı / yetkili değil."; card.append(strong, small);
        }
        return card;
    }

    async function renderDelivery() {
        el.deliveryLinks.replaceChildren(); clearQr();
        if (!state.delivery) { setBadge(el.deliveryState, "Bekliyor"); return; }
        const d = state.delivery;
        setBadge(el.deliveryState, d.publicAvailable ? "Teslime hazır" : "Aktivasyon bekliyor", d.publicAvailable ? "ready" : "pending");
        el.deliveryLinks.append(
            createDeliveryItem("Canonical müşteri linki", d.canonicalPublicUrl),
            createDeliveryItem("WhatsApp", d.channels?.whatsapp),
            createDeliveryItem("Instagram", d.channels?.instagram),
            createDeliveryItem("Google", d.channels?.google)
        );
        if (!d.qrAvailable || !state.tenant) return;
        try {
            const blob = await apiBlob(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/delivery/qr.svg`);
            if (!/^image\/svg\+xml(?:;|$)/i.test(blob.type)) throw new Error("QR yanıt türü geçersiz.");
            state.qrBlob = blob; state.qrUrl = URL.createObjectURL(blob);
            const image = document.createElement("img"); image.src = state.qrUrl; image.alt = `${state.tenant.displayName} QR kodu`; image.width = 210; image.height = 210;
            el.qrPreview.replaceChildren(image); el.qrBox.classList.remove("hidden");
        } catch (error) {
            setMessage(error.message || "QR alınamadı.", "error");
        }
    }

    function renderTenant() {
        const tenant = state.tenant;
        if (!tenant) {
            setBadge(el.tenantStatus, "Yeni");
            lockIdentityForExisting(); renderMinimumChecks(); renderReadiness(); renderPreview();
            return;
        }
        el.tenantId.value = tenant.tenantId; el.displayName.value = tenant.displayName;
        el.sector.value = tenant.sector; el.plan.value = tenant.plan;
        applyFeatures(tenant.features || {}); populateProfile(tenant.profile || {});
        setBadge(el.tenantStatus, tenant.status, tenant.status);
        lockIdentityForExisting(); renderMinimumChecks(); renderReadiness(); renderPreview();
        const encoded = encodeURIComponent(tenant.tenantId);
        el.securityReviewLink.href = `/admin/security-review.html?tenantId=${encoded}`;
        el.backupLink.href = `/admin/backup-diagnostic.html?tenantId=${encoded}`;
        setMutableControls();
    }

    async function refreshCatalog() {
        if (!state.tenant?.features?.catalog) {
            state.products = []; state.catalogState = "not-required";
            el.catalogStatus.textContent = "Catalog modülü kapalı; minimum katalog öğesi zorunlu değil.";
            return;
        }
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/catalog/products?limit=100&includeArchived=false`);
            state.products = Array.isArray(body?.products) ? body.products : [];
            state.catalogState = state.products.length > 0 ? "ready" : "pending";
            el.catalogStatus.textContent = state.products.length > 0
                ? `${state.products.length} aktif katalog/hizmet öğesi mevcut.`
                : "Henüz aktif katalog/hizmet öğesi yok.";
        } catch {
            state.products = []; state.catalogState = "unavailable";
            el.catalogStatus.textContent = "Catalog durumu doğrulanamadı; plan/entitlement veya servis durumunu kontrol et.";
        }
    }

    async function refreshReadiness() {
        if (!state.tenant) return;
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/readiness`);
            state.readiness = body?.readiness || null;
        } catch {
            state.readiness = null;
        }
        renderReadiness(); setMutableControls(); renderPreview();
    }

    async function refreshDelivery() {
        if (!state.tenant) { state.delivery = null; await renderDelivery(); return; }
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/delivery`);
            state.delivery = body?.delivery || null;
        } catch {
            state.delivery = null;
        }
        await renderDelivery();
    }

    async function refreshDerivedState() {
        if (!state.tenant) return;
        await Promise.all([refreshCatalog(), refreshReadiness(), refreshDelivery()]);
        renderMinimumChecks(); renderPreview(); setMutableControls();
    }

    async function loadTenant(tenantIdValue = el.tenantId.value) {
        const tenantId = canonicalTenantId(tenantIdValue);
        setBusy(true); setMessage("Tenant yükleniyor…");
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}`);
            if (!body?.success || body?.tenant?.tenantId !== tenantId) throw new Error("Tenant yanıtı doğrulanamadı.");
            state.tenant = body.tenant; state.readiness = null; state.delivery = null; state.products = [];
            renderTenant(); await refreshDerivedState(); setMessage("Tenant kaldığı yerden yüklendi.", "success");
        } catch (error) {
            setMessage(error.message || "Tenant yüklenemedi.", "error");
        } finally { setBusy(false); }
    }

    async function saveBusiness() {
        setBusy(true); setMessage();
        try {
            const tenantId = canonicalTenantId(el.tenantId.value);
            const displayName = el.displayName.value.trim();
            const plan = el.plan.value.trim().toLowerCase();
            const features = collectFeatures();
            if (displayName.length < 2 || displayName.length > 120) throw new Error("İşletme adı 2-120 karakter olmalı.");
            if (!state.tenant) {
                const template = state.templates.get(el.templateId.value);
                if (!template || el.sector.value !== template.sector) throw new Error("Geçerli bir sektör şablonu seç.");
                try {
                    const body = await apiRequest("/api/platform/tenants", {
                        method: "POST",
                        body: JSON.stringify({ tenantId, displayName, sector: template.sector, plan, features, profile: collectProfile() })
                    });
                    state.tenant = body?.tenant;
                    if (!state.tenant || state.tenant.tenantId !== tenantId) throw new Error("Tenant oluşturma yanıtı doğrulanamadı.");
                    setMessage("Tenant oluşturuldu. Wizard kaldığı yerden tekrar açılabilir.", "success");
                } catch (error) {
                    if (error.status !== 409) throw error;
                    const existing = await apiRequest(`/api/platform/tenants/${encodeURIComponent(tenantId)}`);
                    if (!existing?.tenant || existing.tenant.tenantId !== tenantId) throw error;
                    state.tenant = existing.tenant;
                    setMessage("Tenant zaten vardı; duplicate oluşturulmadı, mevcut kurulum açıldı.", "success");
                }
            } else {
                if (state.tenant.status !== "provisioning") throw new Error("Wizard yalnız provisioning tenantı değiştirebilir.");
                const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}`, {
                    method: "PATCH", body: JSON.stringify({ displayName, plan, features })
                });
                state.tenant = body?.tenant;
                if (!state.tenant) throw new Error("Tenant güncellemesi doğrulanamadı.");
                setMessage("İşletme ve modül ayarları kaydedildi.", "success");
            }
            renderTenant(); await refreshDerivedState();
        } catch (error) { setMessage(error.message || "İşletme kaydedilemedi.", "error"); }
        finally { setBusy(false); }
    }

    async function saveProfile() {
        if (!state.tenant) return setMessage("Önce tenant oluştur veya yükle.", "error");
        if (state.tenant.status !== "provisioning") return setMessage("Wizard yalnız provisioning tenantı değiştirebilir.", "error");
        setBusy(true); setMessage();
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}`, {
                method: "PATCH", body: JSON.stringify({ profile: collectProfile() })
            });
            state.tenant = body?.tenant;
            if (!state.tenant) throw new Error("Profil güncellemesi doğrulanamadı.");
            renderTenant(); await refreshDerivedState(); setMessage("Profil ve çalışma saatleri kaydedildi.", "success");
        } catch (error) { setMessage(error.message || "Profil kaydedilemedi.", "error"); }
        finally { setBusy(false); }
    }

    async function createProduct() {
        if (!state.tenant?.features?.catalog) return setMessage("Catalog modülü açık değil.", "error");
        const name = el.productName.value.trim(); const category = el.productCategory.value.trim();
        const price = Number(el.productPrice.value);
        if (name.length < 2 || !category || !Number.isFinite(price) || price <= 0) return setMessage("İlk katalog öğesi alanları geçersiz.", "error");
        setBusy(true); setMessage();
        try {
            await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/catalog/products`, {
                method: "POST", body: JSON.stringify({ name, category, price })
            });
            el.productName.value = ""; el.productPrice.value = "";
            await refreshCatalog(); renderMinimumChecks(); syncActivationButton();
            setMessage("İlk katalog/hizmet öğesi eklendi.", "success");
        } catch (error) { setMessage(error.message || "Catalog öğesi eklenemedi.", "error"); }
        finally { setBusy(false); }
    }

    async function bindOwner() {
        if (!state.tenant || state.tenant.status !== "provisioning") return setMessage("Owner yalnız provisioning tenant için bağlanabilir.", "error");
        const firebaseUid = el.ownerUid.value.trim();
        if (!firebaseUid || firebaseUid.length > 128 || /[\u0000-\u001f\u007f]/.test(firebaseUid)) return setMessage("Firebase User UID geçersiz.", "error");
        el.ownerUid.value = ""; setBusy(true); setMessage();
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/admin-bootstrap/initial-owner`, {
                method: "POST", body: JSON.stringify({ firebaseUid })
            });
            if (body?.bootstrap?.tenantId !== state.tenant.tenantId || body.bootstrap.adminBootstrap !== "verified") throw new Error("Owner bootstrap yanıtı doğrulanamadı.");
            await refreshReadiness(); setMessage("Tenant Owner bağlandı.", "success");
        } catch (error) { setMessage(error.message || "Owner bağlanamadı.", "error"); }
        finally { setBusy(false); }
    }

    function minimumReady() {
        return Boolean(state.tenant) && profileChecklist().every(check => check.ready);
    }

    function syncActivationButton() {
        const lifecycleReady = state.tenant?.status === "provisioning" && state.readiness?.canActivate === true;
        const checklistReady = minimumReady();
        el.activateTenant.disabled = state.busy || !lifecycleReady || !checklistReady;
        if (state.tenant?.status === "active") setBadge(el.activationState, "Aktif", "active");
        else if (lifecycleReady && checklistReady) setBadge(el.activationState, "Aktivasyona hazır", "ready");
        else if (state.tenant) setBadge(el.activationState, "Eksikler var", "pending");
        else setBadge(el.activationState, "Bekliyor");
    }

    async function activateTenant() {
        if (!state.tenant || !minimumReady() || state.readiness?.canActivate !== true) return setMessage("Tenant henüz aktivasyona hazır değil.", "error");
        setBusy(true); setMessage("Aktivasyon backend readiness ile doğrulanıyor…");
        try {
            const body = await apiRequest(`/api/platform/tenants/${encodeURIComponent(state.tenant.tenantId)}/lifecycle/activate`, { method: "POST" });
            if (body?.tenant?.tenantId !== state.tenant.tenantId || body.tenant.status !== "active") throw new Error("Aktivasyon yanıtı doğrulanamadı.");
            state.tenant = body.tenant; renderTenant(); await refreshDerivedState(); setMessage("Tenant aktif. Teslimat linkleri ve QR hazır.", "success");
        } catch (error) { setMessage(error.message || "Tenant aktive edilemedi.", "error"); }
        finally { setBusy(false); }
    }

    function openFirebaseUsers(event) {
        event.preventDefault();
        const projectId = firebaseConfig?.projectId;
        if (typeof projectId !== "string" || !/^[a-z0-9-]{4,64}$/i.test(projectId)) return setMessage("Firebase proje kimliği kullanılamıyor.", "error");
        window.open(`https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication/users`, "_blank", "noopener,noreferrer");
    }

    function downloadQr() {
        if (!state.qrUrl || !state.tenant) return;
        const link = document.createElement("a");
        link.href = state.qrUrl; link.download = `${state.tenant.tenantId}-qr.svg`; link.rel = "noopener";
        document.body.append(link); link.click(); link.remove();
    }

    el.templateId.addEventListener("change", applySelectedTemplate);
    el.loadTenant.addEventListener("click", () => loadTenant());
    el.saveBusiness.addEventListener("click", saveBusiness);
    el.saveProfile.addEventListener("click", saveProfile);
    el.createProduct.addEventListener("click", createProduct);
    el.bindOwner.addEventListener("click", bindOwner);
    el.firebaseUsers.addEventListener("click", openFirebaseUsers);
    el.refreshReadiness.addEventListener("click", async () => { setBusy(true); await refreshReadiness(); setBusy(false); });
    el.activateTenant.addEventListener("click", activateTenant);
    el.downloadQr.addEventListener("click", downloadQr);
    window.addEventListener("beforeunload", clearQr);

    if (!firebaseConfig || typeof firebase === "undefined") {
        setMessage("Platform Firebase web config kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);
    setBusy(true);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.session.textContent = "Platform Admin oturumu bulunamadı.";
            setMessage("Önce Merkezi Yönetim sayfasında Platform Admin hesabıyla giriş yap.", "error");
            setBusy(true); return;
        }
        el.session.textContent = user.email || "Doğrulanmış Platform Admin";
        try {
            await loadTemplates();
            applySelectedTemplate();
            const queryTenantId = new URLSearchParams(window.location.search).get("tenantId");
            setBusy(false);
            if (queryTenantId) {
                el.tenantId.value = queryTenantId;
                await loadTenant(queryTenantId);
            } else {
                renderTenant(); setMutableControls();
            }
        } catch (error) {
            setBusy(false); setMessage(error.message || "Wizard başlatılamadı.", "error");
        }
    });
})();
