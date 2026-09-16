const { requirePresentationTier } = require("./presentation-tier");

const PRESENTATION_CONTRACTS = Object.freeze({
    starter: Object.freeze({
        navigation: "simple",
        hero: "compact",
        offering: "standard",
        gallery: "basic",
        socialProof: "hidden",
        footer: "compact",
        density: "compact",
        motion: "minimal",
        typography: "system"
    }),
    business: Object.freeze({
        navigation: "professional",
        hero: "featured",
        offering: "advanced",
        gallery: "showcase",
        socialProof: "standard",
        footer: "expanded",
        density: "comfortable",
        motion: "functional",
        typography: "professional"
    }),
    pro: Object.freeze({
        navigation: "editorial",
        hero: "immersive",
        offering: "signature",
        gallery: "portfolio",
        socialProof: "premium",
        footer: "editorial",
        density: "luxury",
        motion: "refined",
        typography: "editorial"
    })
});

function getPresentationContract(tier) {
    const normalizedTier = requirePresentationTier(tier);
    return PRESENTATION_CONTRACTS[normalizedTier];
}

module.exports = {
    PRESENTATION_CONTRACTS,
    getPresentationContract
};
