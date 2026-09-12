(() => {
    "use strict";

    const FEATURE_LABELS = Object.freeze({
        catalog: "Katalog", orders: "Sipariş", appointments: "Randevu",
        reservations: "Rezervasyon", whatsapp: "WhatsApp", inventory: "Stok",
        quotes: "Teklif", crm: "CRM", fleet: "Filo", gallery: "Galeri"
    });
    const SIMPLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
    const templateSelect = document.getElementById("sector-template");
    const templateSummary = document.getElementById("sector-template-summary");
    const sectorInput = document.getElementById("sector");
    const featureGrid = document.getElementById("feature-grid");

    if (!templateSelect || !templateSummary || !sectorInput || !featureGrid ||
        typeof firebase === "undefined" || !firebase.auth) return;

    const state = { templates: new Map(), featureKeys: Object.freeze([]), loaded: false, loading: false };

    function installQuickSetupLink() {
        const actions = document.querySelector(".top-actions");
        if (!actions || document.getElementById("quick-setup-link")) return;
        const link = document.createElement("a");
        link.id = "quick-setup-link";
        link.href = "/admin/quick-setup.html";
        link.className = "secondary compact";
        link.textContent = "Hızlı Kurulum";
        actions.insertBefore(link, actions.firstChild);
    }

    function isPlainRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function readOwn(record, key) {
        if (!isPlainRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value") ? descriptor.value : undefined;
    }

    function validFeatureKeys(features) {
        if (!isPlainRecord(features)) return null;
        const keys = Object.keys(features).sort();
        if (keys.length < 1 || keys.length > 50 ||
            keys.some(key => !SIMPLE_ID_PATTERN.test(key) || typeof features[key] !== "boolean")) return null;
        return Object.freeze(keys);
    }

    function sameKeys(left, right) {
        return left.length === right.length && left.every((key, index) => key === right[index]);
    }

    function projectTemplate(raw, expectedKeys = null) {
        if (!isPlainRecord(raw)) return null;
        const id = readOwn(raw, "id");
        const label = readOwn(raw, "label");
        const sector = readOwn(raw, "sector");
        const description = readOwn(raw, "description");
        const features = readOwn(raw, "features");
        const keys = validFeatureKeys(features);
        if (typeof id !== "string" || !SIMPLE_ID_PATTERN.test(id) ||
            typeof sector !== "string" || !SIMPLE_ID_PATTERN.test(sector) ||
            typeof label !== "string" || label.length < 2 || label.length > 80 ||
            typeof description !== "string" || description.length < 2 || description.length > 220 ||
            !keys || expectedKeys && !sameKeys(keys, expectedKeys)) return null;
        return Object.freeze({ id, label, sector, description, features: Object.freeze({ ...features }), keys });
    }

    function projectCatalog(rawCatalog) {
        if (!isPlainRecord(rawCatalog) || readOwn(rawCatalog, "schemaVersion") !== 1) return null;
        const rawTemplates = readOwn(rawCatalog, "templates");
        if (!Array.isArray(rawTemplates) || rawTemplates.length < 1 || rawTemplates.length > 50) return null;
        const first = projectTemplate(rawTemplates[0]);
        if (!first) return null;
        const templates = [first];
        const ids = new Set([first.id]);
        for (const raw of rawTemplates.slice(1)) {
            const template = projectTemplate(raw, first.keys);
            if (!template || ids.has(template.id)) return null;
            ids.add(template.id); templates.push(template);
        }
        return Object.freeze({ templates: Object.freeze(templates), featureKeys: first.keys });
    }

    function featureLabel(key) { return FEATURE_LABELS[key] || key.replace(/[-_]/g, " "); }

    function renderFeatureGrid() {
        const fragment = document.createDocumentFragment();
        for (const key of state.featureKeys) {
            const label = document.createElement("label");
            const input = document.createElement("input");
            input.type = "checkbox"; input.dataset.feature = key;
            label.append(input, document.createTextNode(` ${featureLabel(key)}`));
            fragment.append(label);
        }
        featureGrid.replaceChildren(fragment);
    }

    function featureInputs() {
        return new Map([...featureGrid.querySelectorAll("input[data-feature]")].map(input => [input.dataset.feature, input]));
    }

    function applyTemplate(template) {
        if (sectorInput.disabled) return;
        const inputs = featureInputs();
        if (inputs.size !== state.featureKeys.length) {
            templateSummary.textContent = "Özellik alanları eksik; şablon uygulanmadı.";
            return;
        }
        sectorInput.value = template.sector;
        for (const key of state.featureKeys) inputs.get(key).checked = template.features[key];
        const enabled = state.featureKeys.filter(key => template.features[key]).map(featureLabel);
        templateSummary.textContent = `${template.description} Açık modüller: ${enabled.join(", ") || "yok"}.`;
    }

    function resetSelectionForMode() {
        templateSelect.value = "";
        templateSummary.textContent = sectorInput.disabled
            ? "Mevcut işletmede şablon otomatik uygulanmaz; modüller elle yönetilir."
            : "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin.";
    }

    function syncAvailability() {
        const editable = !sectorInput.disabled;
        templateSelect.disabled = !state.loaded || !editable;
        if (!editable) resetSelectionForMode();
        else if (!templateSelect.value) templateSummary.textContent = state.loaded
            ? "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin."
            : "Sektör şablonları yükleniyor...";
    }

    function renderCatalog(catalog) {
        state.templates = new Map(catalog.templates.map(template => [template.id, template]));
        state.featureKeys = catalog.featureKeys; state.loaded = true;
        renderFeatureGrid(); templateSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = ""; placeholder.textContent = "Sektör şablonu seçin"; templateSelect.append(placeholder);
        for (const template of catalog.templates) {
            const option = document.createElement("option");
            option.value = template.id; option.textContent = template.label; templateSelect.append(option);
        }
        syncAvailability();
    }

    async function apiRequest(path) {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        const token = await user.getIdToken();
        const response = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
        let body = null; try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || "Sektör şablonları alınamadı.");
        return body;
    }

    async function loadTemplates() {
        if (state.loading || state.loaded) return;
        state.loading = true; templateSelect.disabled = true;
        templateSummary.textContent = "Sektör şablonları yükleniyor...";
        try {
            const body = await apiRequest("/api/platform/sector-templates");
            const catalog = projectCatalog(body?.catalog);
            if (!catalog) throw new Error("Sektör şablonu yanıtı geçersiz.");
            renderCatalog(catalog);
        } catch {
            state.loaded = false; state.templates = new Map(); state.featureKeys = Object.freeze([]);
            templateSelect.replaceChildren();
            const option = document.createElement("option");
            option.value = ""; option.textContent = "Şablonlar kullanılamıyor"; templateSelect.append(option);
            templateSelect.disabled = true;
            templateSummary.textContent = "Şablonlar yüklenemedi; sektör ve özellikleri elle girebilirsin.";
        } finally { state.loading = false; }
    }

    templateSelect.addEventListener("change", () => {
        if (sectorInput.disabled) return;
        const template = state.templates.get(templateSelect.value);
        if (template) applyTemplate(template);
        else templateSummary.textContent = "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin.";
    });

    new MutationObserver(syncAvailability).observe(sectorInput, { attributes: true, attributeFilter: ["disabled"] });
    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            state.loaded = false; state.templates = new Map(); state.featureKeys = Object.freeze([]); templateSelect.disabled = true;
            return;
        }
        loadTemplates();
    });

    installQuickSetupLink();
    syncAvailability();
})();

(() => {
    "use strict";
    if (document.querySelector('script[data-plan-package-presets="true"]')) return;
    const script = document.createElement("script");
    script.src = "/admin/plan-packages.js";
    script.async = true;
    script.dataset.planPackagePresets = "true";
    document.head.append(script);
})();
