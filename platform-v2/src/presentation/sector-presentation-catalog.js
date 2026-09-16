function createSectorAdapter({
    sector,
    offeringKind,
    offeringLabel,
    primaryActionFeature = null
}) {
    return Object.freeze({
        sector,
        offeringKind,
        offeringLabel,
        primaryActionFeature
    });
}

const GENERAL_ADAPTER = createSectorAdapter({
    sector: "general",
    offeringKind: "offerings",
    offeringLabel: "Ürünler & Hizmetler",
    primaryActionFeature: "whatsapp"
});

const SECTOR_PRESENTATION_CATALOG = Object.freeze({
    restaurant: createSectorAdapter({
        sector: "restaurant",
        offeringKind: "menu",
        offeringLabel: "Menü",
        primaryActionFeature: "orders"
    }),
    cafe: createSectorAdapter({
        sector: "cafe",
        offeringKind: "menu",
        offeringLabel: "Menü",
        primaryActionFeature: "orders"
    }),
    market: createSectorAdapter({
        sector: "market",
        offeringKind: "catalog",
        offeringLabel: "Ürünler",
        primaryActionFeature: "orders"
    }),
    barber: createSectorAdapter({
        sector: "barber",
        offeringKind: "services",
        offeringLabel: "Hizmetler",
        primaryActionFeature: "appointments"
    }),
    beauty: createSectorAdapter({
        sector: "beauty",
        offeringKind: "services",
        offeringLabel: "Hizmetler",
        primaryActionFeature: "appointments"
    }),
    clinic: createSectorAdapter({
        sector: "clinic",
        offeringKind: "services",
        offeringLabel: "Hizmetler",
        primaryActionFeature: "appointments"
    }),
    hotel: createSectorAdapter({
        sector: "hotel",
        offeringKind: "accommodation",
        offeringLabel: "Odalar & Hizmetler",
        primaryActionFeature: "reservations"
    }),
    retail: createSectorAdapter({
        sector: "retail",
        offeringKind: "catalog",
        offeringLabel: "Ürünler",
        primaryActionFeature: "orders"
    }),
    "auto-expertise": createSectorAdapter({
        sector: "auto-expertise",
        offeringKind: "services",
        offeringLabel: "Paketler & Hizmetler",
        primaryActionFeature: "appointments"
    }),
    "rent-a-car": createSectorAdapter({
        sector: "rent-a-car",
        offeringKind: "fleet",
        offeringLabel: "Araçlar",
        primaryActionFeature: "reservations"
    }),
    "manufacturing-b2b": createSectorAdapter({
        sector: "manufacturing-b2b",
        offeringKind: "portfolio",
        offeringLabel: "Ürün Portföyü",
        primaryActionFeature: "quotes"
    }),
    "wholesale-b2b": createSectorAdapter({
        sector: "wholesale-b2b",
        offeringKind: "portfolio",
        offeringLabel: "Ürün Portföyü",
        primaryActionFeature: "quotes"
    }),
    "professional-services": createSectorAdapter({
        sector: "professional-services",
        offeringKind: "services",
        offeringLabel: "Hizmetler",
        primaryActionFeature: "appointments"
    }),
    general: GENERAL_ADAPTER
});

function getSectorPresentationAdapter(value) {
    const sector = String(value ?? "").trim().toLowerCase();
    return SECTOR_PRESENTATION_CATALOG[sector] || GENERAL_ADAPTER;
}

module.exports = {
    SECTOR_PRESENTATION_CATALOG,
    getSectorPresentationAdapter
};
