(() => {
    "use strict";

    const FEATURE_KEYS = Object.freeze([
        "catalog",
        "orders",
        "appointments",
        "reservations",
        "whatsapp",
        "inventory",
        "quotes",
        "fleet",
        "gallery"
    ]);
    const FEATURE_LABELS = Object.freeze({
        catalog: "Katalog",
        orders: "Sipariş",
        appointments: "Randevu",
        reservations: "Rezervasyon",
        whatsapp: "WhatsApp",
        inventory: "Stok",
        quotes: "Teklif",
        fleet: "Filo",
        gallery: "Galeri"
    });
    const SIMPLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

    const templateSelect = document.getElementById("sector-template");
    const templateSummary = document.getElementById("sector-template-summary");
    const sectorInput = document.getElementById("sector");
    const featureGrid = document.getElementById("feature-grid");

    if (!templateSelect || !templateSummary || !sectorInput || !featureGrid ||
        typeof firebase === "undefined" || !firebase.auth) {
        return;
    }

    const state = {
        templates: new Map(),
        loaded: false,
        loading: false
    };

    function isPlainRecord(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value) &&
            Object.getPrototypeOf(value) === Object.prototype;
    }

    function readOwn(record, key) {
        if (!isPlainRecord(record)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(record, key);
        return descriptor && Object.hasOwn(descriptor, "value")
            ? descriptor.value
            : undefined;
    }

    function projectTemplate(raw) {
        if (!isPlainRecord(raw)) return null;

        const id = readOwn(raw, "id");
        const label = readOwn(raw, "label");
        const sector = readOwn(raw, "sector");
        const description = readOwn(raw, "description");
        const rawFeatures = readOwn(raw, "features");

        if (typeof id !== "string" || !SIMPLE_ID_PATTERN.test(id) ||
            typeof sector !== "string" || !SIMPLE_ID_PATTERN.test(sector) ||
            typeof label !== "string" || label.length < 2 || label.length > 80 ||
            typeof description !== "string" || description.length < 2 ||
            description.length > 220 || !isPlainRecord(rawFeatures)) {
            return null;
        }

        const rawFeatureKeys = Object.keys(rawFeatures);
        if (rawFeatureKeys.length !== FEATURE_KEYS.length ||
            rawFeatureKeys.some(key => !FEATURE_KEYS.includes(key))) {
            return null;
        }

        const features = {};
        for (const key of FEATURE_KEYS) {
            const value = readOwn(rawFeatures, key);
            if (typeof value !== "boolean") return null;
            features[key] = value;
        }

        return Object.freeze({
            id,
            label,
            sector,
            description,
            features: Object.freeze(features)
        });
    }

    function projectCatalog(rawCatalog) {
        if (!isPlainRecord(rawCatalog) || readOwn(rawCatalog, "schemaVersion") !== 1) {
            return null;
        }

        const rawTemplates = readOwn(rawCatalog, "templates");
        if (!Array.isArray(rawTemplates) || rawTemplates.length < 1 ||
            rawTemplates.length > 50) {
            return null;
        }

        const templates = [];
        const ids = new Set();
        for (const raw of rawTemplates) {
            const template = projectTemplate(raw);
            if (!template || ids.has(template.id)) return null;
            ids.add(template.id);
            templates.push(template);
        }

        return Object.freeze(templates);
    }

    function featureInputs() {
        return new Map(
            [...featureGrid.querySelectorAll("input[data-feature]")]
                .map(input => [input.dataset.feature, input])
                .filter(([key]) => FEATURE_KEYS.includes(key))
        );
    }

    function enabledFeatureLabels(template) {
        return FEATURE_KEYS
            .filter(key => template.features[key])
            .map(key => FEATURE_LABELS[key]);
    }

    function applyTemplate(template) {
        if (sectorInput.disabled) return;

        const inputs = featureInputs();
        if (inputs.size !== FEATURE_KEYS.length) {
            templateSummary.textContent = "Özellik alanları eksik; şablon uygulanmadı.";
            return;
        }

        sectorInput.value = template.sector;
        for (const key of FEATURE_KEYS) {
            inputs.get(key).checked = template.features[key];
        }

        const enabled = enabledFeatureLabels(template);
        templateSummary.textContent = `${template.description} Açık modüller: ${enabled.join(", ") || "yok"}.`;
    }

    function renderCatalog(templates) {
        state.templates = new Map(templates.map(template => [template.id, template]));
        state.loaded = true;
        templateSelect.replaceChildren();

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Sektör şablonu seçin";
        templateSelect.append(placeholder);

        for (const template of templates) {
            const option = document.createElement("option");
            option.value = template.id;
            option.textContent = template.label;
            templateSelect.append(option);
        }

        syncAvailability();
    }

    function resetSelectionForMode() {
        templateSelect.value = "";
        if (sectorInput.disabled) {
            templateSummary.textContent = "Mevcut işletmede şablon otomatik uygulanmaz; modüller elle yönetilir.";
        } else {
            templateSummary.textContent = "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin.";
        }
    }

    function syncAvailability() {
        const editable = !sectorInput.disabled;
        templateSelect.disabled = !state.loaded || !editable;
        if (!editable) {
            resetSelectionForMode();
        } else if (!templateSelect.value) {
            templateSummary.textContent = state.loaded
                ? "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin."
                : "Sektör şablonları yükleniyor...";
        }
    }

    async function apiRequest(path) {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");

        const token = await user.getIdToken();
        const response = await fetch(path, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });

        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (!response.ok) {
            throw new Error(body?.message || "Sektör şablonları alınamadı.");
        }

        return body;
    }

    async function loadTemplates() {
        if (state.loading || state.loaded) return;
        state.loading = true;
        templateSelect.disabled = true;
        templateSummary.textContent = "Sektör şablonları yükleniyor...";

        try {
            const body = await apiRequest("/api/platform/sector-templates");
            const templates = projectCatalog(body?.catalog);
            if (!templates) throw new Error("Sektör şablonu yanıtı geçersiz.");
            renderCatalog(templates);
        } catch {
            state.loaded = false;
            state.templates = new Map();
            templateSelect.replaceChildren();
            const option = document.createElement("option");
            option.value = "";
            option.textContent = "Şablonlar kullanılamıyor";
            templateSelect.append(option);
            templateSelect.disabled = true;
            templateSummary.textContent = "Şablonlar yüklenemedi; sektör ve özellikleri elle girebilirsin.";
        } finally {
            state.loading = false;
        }
    }

    templateSelect.addEventListener("change", () => {
        if (sectorInput.disabled) return;
        const template = state.templates.get(templateSelect.value);
        if (!template) {
            templateSummary.textContent = "Şablon seçince sektör ve önerilen modüller otomatik dolar; kaydetmeden önce değiştirebilirsin.";
            return;
        }
        applyTemplate(template);
    });

    const modeObserver = new MutationObserver(() => syncAvailability());
    modeObserver.observe(sectorInput, {
        attributes: true,
        attributeFilter: ["disabled"]
    });

    firebase.auth().onAuthStateChanged(user => {
        if (!user) {
            state.loaded = false;
            state.templates = new Map();
            templateSelect.disabled = true;
            return;
        }
        loadTemplates();
    });

    syncAvailability();
})();
