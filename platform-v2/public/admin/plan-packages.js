(function planPackageModule(root, factory) {
    "use strict";

    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.PLATFORM_PLAN_PACKAGES = api;
    }
})(typeof window === "undefined" ? null : window, () => {
    "use strict";

    const FEATURE_LABELS = Object.freeze({
        catalog: "Katalog / Ürün-Hizmet",
        orders: "Sipariş",
        appointments: "Randevu",
        reservations: "Rezervasyon",
        whatsapp: "WhatsApp",
        inventory: "Stok",
        quotes: "Teklif / B2B",
        crm: "CRM / Raporlama",
        fleet: "Filo",
        gallery: "Galeri"
    });

    const PACKAGE_ORDER = Object.freeze([
        "starter",
        "business",
        "business_pro"
    ]);

    const PLAN_PACKAGE_CATALOG = Object.freeze({
        starter: Object.freeze({
            id: "starter",
            label: "Starter",
            description: "Temel dijital işletme paketi",
            features: Object.freeze({
                catalog: true,
                orders: false,
                appointments: false,
                reservations: false,
                whatsapp: true,
                inventory: false,
                quotes: false,
                crm: false,
                fleet: false,
                gallery: true
            })
        }),
        business: Object.freeze({
            id: "business",
            label: "Business",
            description: "Günlük operasyon paketi",
            features: Object.freeze({
                catalog: true,
                orders: true,
                appointments: true,
                reservations: true,
                whatsapp: true,
                inventory: true,
                quotes: false,
                crm: false,
                fleet: false,
                gallery: true
            })
        }),
        business_pro: Object.freeze({
            id: "business_pro",
            label: "Business Pro",
            description: "CRM, B2B ve gelişmiş operasyon paketi",
            features: Object.freeze({
                catalog: true,
                orders: true,
                appointments: true,
                reservations: true,
                whatsapp: true,
                inventory: true,
                quotes: true,
                crm: true,
                fleet: true,
                gallery: true
            })
        })
    });

    function normalizePlanId(value) {
        const planId = String(value ?? "").trim().toLowerCase();
        if (planId === "business-pro" || planId === "business pro") {
            return "business_pro";
        }
        return planId;
    }

    function getPlanPackage(value) {
        const planId = normalizePlanId(value);
        return Object.hasOwn(PLAN_PACKAGE_CATALOG, planId)
            ? PLAN_PACKAGE_CATALOG[planId]
            : null;
    }

    function suggestedFeaturesForPlan(value) {
        const planPackage = getPlanPackage(value);
        return planPackage ? { ...planPackage.features } : null;
    }

    function featureSummary(value) {
        const planPackage = getPlanPackage(value);
        if (!planPackage) return "Özel / mevcut plan";

        const enabled = Object.entries(planPackage.features)
            .filter(([, isEnabled]) => isEnabled)
            .map(([feature]) => FEATURE_LABELS[feature] || feature);

        return `${planPackage.description}: ${enabled.join(", ")}.`;
    }

    function createFeatureLabel(documentRef, feature) {
        const label = documentRef.createElement("label");
        const input = documentRef.createElement("input");
        input.type = "checkbox";
        input.dataset.feature = feature;
        label.append(
            input,
            documentRef.createTextNode(` ${FEATURE_LABELS[feature] || feature}`)
        );
        return label;
    }

    function ensureKnownFeatureInputs(documentRef, featureGrid) {
        if (!featureGrid) return;

        const existing = new Set(
            [...featureGrid.querySelectorAll("input[data-feature]")]
                .map(input => input.dataset.feature)
        );

        for (const feature of Object.keys(FEATURE_LABELS)) {
            if (!existing.has(feature)) {
                featureGrid.append(createFeatureLabel(documentRef, feature));
            }
        }
    }

    function relabelFeatureInputs(documentRef, featureGrid) {
        if (!featureGrid) return;

        for (const input of featureGrid.querySelectorAll("input[data-feature]")) {
            const label = input.closest("label");
            if (!label) continue;
            const text = FEATURE_LABELS[input.dataset.feature];
            if (!text) continue;

            const textNodes = [...label.childNodes]
                .filter(node => node.nodeType === 3);
            for (const node of textNodes) node.remove();
            label.append(documentRef.createTextNode(` ${text}`));
        }
    }

    function applyPlanSuggestion(featureGrid, value) {
        const features = suggestedFeaturesForPlan(value);
        if (!featureGrid || !features) return false;

        for (const input of featureGrid.querySelectorAll("input[data-feature]")) {
            if (Object.hasOwn(features, input.dataset.feature)) {
                input.checked = features[input.dataset.feature] === true;
            }
        }
        return true;
    }

    function initializePlanPackagePicker(documentRef = globalThis.document) {
        if (!documentRef || typeof documentRef.getElementById !== "function") {
            return null;
        }

        const planInput = documentRef.getElementById("plan");
        const featureGrid = documentRef.getElementById("feature-grid");
        if (!planInput || !featureGrid || documentRef.getElementById("plan-package-picker")) {
            return null;
        }

        ensureKnownFeatureInputs(documentRef, featureGrid);
        relabelFeatureInputs(documentRef, featureGrid);

        const picker = documentRef.createElement("div");
        picker.id = "plan-package-picker";
        picker.className = "plan-package-picker";

        const title = documentRef.createElement("strong");
        title.textContent = "Paket önerisi";

        const actions = documentRef.createElement("div");
        actions.className = "actions";

        const status = documentRef.createElement("small");
        status.id = "plan-package-status";
        status.className = "muted";
        status.textContent = featureSummary(planInput.value);

        const buttons = new Map();

        function syncSelection() {
            const selected = normalizePlanId(planInput.value);
            for (const [planId, button] of buttons) {
                const active = selected === planId;
                button.setAttribute("aria-pressed", active ? "true" : "false");
                button.classList.toggle("primary", active);
                button.classList.toggle("secondary", !active);
                button.disabled = planInput.disabled;
            }
            status.textContent = featureSummary(planInput.value);
        }

        for (const planId of PACKAGE_ORDER) {
            const planPackage = PLAN_PACKAGE_CATALOG[planId];
            const button = documentRef.createElement("button");
            button.type = "button";
            button.className = "secondary compact";
            button.textContent = planPackage.label;
            button.dataset.planPackage = planId;
            button.addEventListener("click", () => {
                if (planInput.disabled) return;
                planInput.value = planId;
                ensureKnownFeatureInputs(documentRef, featureGrid);
                relabelFeatureInputs(documentRef, featureGrid);
                applyPlanSuggestion(featureGrid, planId);
                planInput.dispatchEvent(new Event("input", { bubbles: true }));
                planInput.dispatchEvent(new Event("change", { bubbles: true }));
                syncSelection();
            });
            buttons.set(planId, button);
            actions.append(button);
        }

        const note = documentRef.createElement("small");
        note.className = "muted";
        note.textContent = "Paket yalnız modül önerisi uygular. Kaydetmeden önce özellikleri tek tek değiştirebilirsin.";

        picker.append(title, actions, status, note);

        const planLabel = planInput.closest("label");
        if (planLabel?.parentNode) {
            planLabel.insertAdjacentElement("afterend", picker);
        } else {
            planInput.insertAdjacentElement("afterend", picker);
        }

        const gridObserver = typeof MutationObserver === "function"
            ? new MutationObserver(() => {
                ensureKnownFeatureInputs(documentRef, featureGrid);
                relabelFeatureInputs(documentRef, featureGrid);
            })
            : null;
        gridObserver?.observe(featureGrid, { childList: true, subtree: true });

        const planObserver = typeof MutationObserver === "function"
            ? new MutationObserver(syncSelection)
            : null;
        planObserver?.observe(planInput, { attributes: true, attributeFilter: ["disabled"] });

        planInput.addEventListener("input", syncSelection);
        planInput.addEventListener("change", syncSelection);
        syncSelection();

        return Object.freeze({
            picker,
            planInput,
            featureGrid,
            destroy() {
                gridObserver?.disconnect();
                planObserver?.disconnect();
                picker.remove();
            }
        });
    }

    if (typeof document !== "undefined") {
        initializePlanPackagePicker(document);
    }

    return Object.freeze({
        FEATURE_LABELS,
        PLAN_PACKAGE_CATALOG,
        PACKAGE_ORDER,
        normalizePlanId,
        getPlanPackage,
        suggestedFeaturesForPlan,
        featureSummary,
        applyPlanSuggestion,
        initializePlanPackagePicker
    });
});
