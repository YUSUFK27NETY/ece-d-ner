"use strict";

const PLAN_SERVICE_IDS = Object.freeze([
    "starter",
    "business",
    "business_pro"
]);

const CORE_MANAGED_SERVICES = Object.freeze([
    "managed_runtime",
    "security_maintenance",
    "backup_management",
    "platform_bug_fixes",
    "supported_device_compatibility"
]);

const STANDARD_EXCLUSIONS = Object.freeze([
    "new_feature_or_module_development",
    "full_redesign_or_rebrand",
    "custom_third_party_integrations",
    "third_party_fees_unless_agreed",
    "professional_photo_video_content_production",
    "unlimited_revision_or_data_entry",
    "twenty_four_seven_sla_unless_separately_agreed"
]);

function normalizePlanId(value) {
    const planId = String(value ?? "").trim().toLowerCase();
    if (planId === "business-pro" || planId === "business pro") {
        return "business_pro";
    }
    return planId;
}

function freezeContract(contract) {
    return Object.freeze({
        ...contract,
        managedServices: Object.freeze([...contract.managedServices]),
        customerFacingIncludes: Object.freeze([...contract.customerFacingIncludes]),
        exclusions: Object.freeze([...contract.exclusions]),
        support: Object.freeze({ ...contract.support })
    });
}

const PLAN_SERVICE_CONTRACTS = Object.freeze({
    starter: freezeContract({
        id: "starter",
        label: "Starter",
        servicePromise: "İşletmenin profesyonel dijital varlığını güvenli, güncel ve çalışır tutan yönetilen hizmet.",
        managedServices: [
            ...CORE_MANAGED_SERVICES,
            "basic_content_change_support"
        ],
        support: {
            priority: "standard",
            contentChangeLevel: "basic",
            enabledModuleSupport: "standard",
            presentationSupport: "standard",
            serviceReview: "reactive"
        },
        customerFacingIncludes: [
            "Sistem ve yayın altyapısının teknik takibi",
            "Güvenlik ve bakım güncellemeleri",
            "Yedekleme yönetimi ve geri yükleme hazırlığı",
            "Platform kaynaklı hataların giderilmesi",
            "Desteklenen telefon ve tarayıcı uyumluluğunun korunması",
            "Temel ürün, hizmet, fiyat ve içerik güncelleme desteği"
        ],
        exclusions: STANDARD_EXCLUSIONS
    }),
    business: freezeContract({
        id: "business",
        label: "Business",
        servicePromise: "Müşteri kazanımı ve işletme akışlarını destekleyen dijital sistemin yönetimi, bakımı ve öncelikli desteği.",
        managedServices: [
            ...CORE_MANAGED_SERVICES,
            "expanded_content_change_support",
            "priority_support",
            "enabled_operational_module_support",
            "conversion_flow_maintenance",
            "campaign_content_support",
            "monthly_service_review"
        ],
        support: {
            priority: "priority",
            contentChangeLevel: "expanded",
            enabledModuleSupport: "priority",
            presentationSupport: "advanced",
            serviceReview: "monthly"
        },
        customerFacingIncludes: [
            "Starter kapsamındaki tüm yönetilen teknik hizmetler",
            "Öncelikli teknik destek",
            "Aktif sipariş, randevu, rezervasyon ve benzeri modüllerde işletim desteği",
            "Daha geniş ürün, hizmet, kampanya ve içerik güncelleme desteği",
            "Müşteri dönüşüm akışlarının teknik olarak çalışır tutulması",
            "Aylık sistem ve hizmet sağlığı kontrolü"
        ],
        exclusions: STANDARD_EXCLUSIONS
    }),
    business_pro: freezeContract({
        id: "business_pro",
        label: "Business Pro",
        servicePromise: "Markaya özel premium dijital deneyimin proaktif teknik yönetimi, yüksek öncelikli desteği ve kontrollü sürekli iyileştirmesi.",
        managedServices: [
            ...CORE_MANAGED_SERVICES,
            "advanced_content_change_support",
            "highest_priority_support",
            "enabled_operational_module_support",
            "conversion_flow_maintenance",
            "campaign_content_support",
            "monthly_service_review",
            "proactive_technical_review",
            "brand_presentation_maintenance",
            "minor_presentation_improvements"
        ],
        support: {
            priority: "highest",
            contentChangeLevel: "advanced",
            enabledModuleSupport: "highest",
            presentationSupport: "premium_managed",
            serviceReview: "monthly_proactive"
        },
        customerFacingIncludes: [
            "Business kapsamındaki tüm yönetilen teknik hizmetler",
            "En yüksek destek önceliği; ayrıca süre garantisi verilmez",
            "Premium marka ve sunum yapısının teknik bakımı",
            "Gelişmiş içerik ve kampanya değişiklik desteği",
            "Proaktif teknik sağlık ve uyumluluk kontrolü",
            "Kapsamı sınırlı küçük sunum ve deneyim iyileştirmeleri"
        ],
        exclusions: STANDARD_EXCLUSIONS
    })
});

function getPlanServiceContract(value) {
    const planId = normalizePlanId(value);
    return Object.hasOwn(PLAN_SERVICE_CONTRACTS, planId)
        ? PLAN_SERVICE_CONTRACTS[planId]
        : null;
}

function getPlanServiceCatalog() {
    return Object.freeze({
        schemaVersion: 1,
        pricingManagedSeparately: true,
        contracts: PLAN_SERVICE_CONTRACTS
    });
}

module.exports = {
    CORE_MANAGED_SERVICES,
    PLAN_SERVICE_CONTRACTS,
    PLAN_SERVICE_IDS,
    STANDARD_EXCLUSIONS,
    getPlanServiceCatalog,
    getPlanServiceContract,
    normalizePlanId
};
