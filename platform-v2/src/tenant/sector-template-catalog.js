const { FEATURE_CATALOG, createFeatureFlags } = require("./feature-catalog");

const SIMPLE_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;

function requireTemplateId(value, label) {
    const normalized = String(value ?? "").trim().toLowerCase();

    if (!SIMPLE_ID_PATTERN.test(normalized)) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return normalized;
}

function requireTemplateText(value, label, maxLength) {
    const text = String(value ?? "").trim();

    if (text.length < 2 || text.length > maxLength) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return text;
}

function createTemplateFeatures(enabledFeatures = []) {
    if (!Array.isArray(enabledFeatures)) {
        throw new TypeError("Sektör şablonu feature listesi dizi olmalı.");
    }

    const overrides = {};
    for (const feature of Object.keys(FEATURE_CATALOG)) {
        overrides[feature] = false;
    }

    for (const feature of enabledFeatures) {
        if (typeof feature !== "string" || !(feature in FEATURE_CATALOG)) {
            throw new TypeError(`Bilinmeyen sektör şablonu feature'ı: ${feature}`);
        }
        overrides[feature] = true;
    }

    return createFeatureFlags(overrides);
}

function createSectorTemplate({
    id,
    label,
    sector,
    description,
    enabledFeatures = []
}) {
    return Object.freeze({
        id: requireTemplateId(id, "Şablon ID"),
        label: requireTemplateText(label, "Şablon adı", 80),
        sector: requireTemplateId(sector, "Sektör"),
        description: requireTemplateText(description, "Şablon açıklaması", 220),
        features: createTemplateFeatures(enabledFeatures)
    });
}

const SECTOR_TEMPLATE_CATALOG = Object.freeze([
    createSectorTemplate({
        id: "restaurant",
        label: "Restoran / Döner / Fast Food",
        sector: "restaurant",
        description: "Menü, online sipariş, WhatsApp ve galeri odaklı restoran kurulumu.",
        enabledFeatures: ["catalog", "orders", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "cafe",
        label: "Kafe / Pastane / Baklava",
        sector: "cafe",
        description: "Ürün menüsü, sipariş, masa rezervasyonu, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "orders", "reservations", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "market",
        label: "Market / Hızlı Sipariş",
        sector: "market",
        description: "Ürün kataloğu, sipariş, stok, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "orders", "inventory", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "barber",
        label: "Berber / Kuaför",
        sector: "barber",
        description: "Hizmet kataloğu, online randevu, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "appointments", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "beauty",
        label: "Güzellik / Bakım",
        sector: "beauty",
        description: "Hizmet kataloğu, online randevu, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "appointments", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "clinic",
        label: "Klinik / Sağlık Hizmeti",
        sector: "clinic",
        description: "Hizmet tanıtımı, randevu, WhatsApp ve galeri; klinik iş akışına başlangıç şablonu.",
        enabledFeatures: ["catalog", "appointments", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "hotel",
        label: "Otel / Konaklama",
        sector: "hotel",
        description: "Oda/hizmet kataloğu, rezervasyon, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "reservations", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "retail",
        label: "Mağaza / Perakende",
        sector: "retail",
        description: "Ürün kataloğu, sipariş, stok, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "orders", "inventory", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "auto-expertise",
        label: "Oto Ekspertiz / Servis",
        sector: "auto-expertise",
        description: "Paket/hizmet kataloğu, randevu, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "appointments", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "rent-a-car",
        label: "Rent a Car / Araç Kiralama",
        sector: "rent-a-car",
        description: "Araç kataloğu, rezervasyon, filo, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "reservations", "whatsapp", "fleet", "gallery"]
    }),
    createSectorTemplate({
        id: "manufacturing-b2b",
        label: "Fabrika / Üretici / B2B",
        sector: "manufacturing-b2b",
        description: "Ürün kataloğu, teklif/RFQ, WhatsApp ve kurumsal galeri.",
        enabledFeatures: ["catalog", "quotes", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "wholesale-b2b",
        label: "Toptancı / Bayi / B2B",
        sector: "wholesale-b2b",
        description: "Katalog, stok, teklif/RFQ, WhatsApp ve galeri.",
        enabledFeatures: ["catalog", "inventory", "quotes", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "professional-services",
        label: "Profesyonel Hizmet / Danışmanlık",
        sector: "professional-services",
        description: "Randevu, teklif talebi, WhatsApp ve kurumsal galeri.",
        enabledFeatures: ["appointments", "quotes", "whatsapp", "gallery"]
    }),
    createSectorTemplate({
        id: "general",
        label: "Genel İşletme / Tanıtım Sitesi",
        sector: "general",
        description: "WhatsApp ve galeri ile sade kurumsal başlangıç; diğer modüller elle açılabilir.",
        enabledFeatures: ["whatsapp", "gallery"]
    })
]);

function getSectorTemplateCatalog() {
    return Object.freeze({
        schemaVersion: 1,
        templates: SECTOR_TEMPLATE_CATALOG
    });
}

module.exports = {
    SECTOR_TEMPLATE_CATALOG,
    createSectorTemplate,
    getSectorTemplateCatalog
};
