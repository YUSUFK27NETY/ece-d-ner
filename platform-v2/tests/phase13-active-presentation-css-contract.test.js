const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { PRESENTATION_CONTRACTS } = require("../src/presentation/presentation-contract");

const ROOT = path.join(__dirname, "../public/storefront");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const styles = [
    fs.readFileSync(path.join(ROOT, "storefront.css"), "utf8"),
    fs.readFileSync(path.join(ROOT, "presentation.css"), "utf8")
].join("\n");
const mediaStyles = fs.readFileSync(path.join(ROOT, "media.css"), "utf8");

const ACTIVE_VISUAL_COMPONENTS = Object.freeze([
    "navigation",
    "hero",
    "offering",
    "footer",
    "density",
    "motion",
    "typography"
]);

function selectorFor(component, token) {
    return `data-presentation-${component}="${token}"`;
}

test("storefront presentation refinement stylesheet base styles after loaded", () => {
    const baseIndex = html.indexOf('/m/storefront.css');
    const presentationIndex = html.indexOf('/m/presentation.css');
    assert.ok(baseIndex >= 0);
    assert.ok(presentationIndex > baseIndex);
});

test("Business ve Pro aktif visual component tokenları CSS karşılığına sahiptir", () => {
    for (const tier of ["business", "pro"]) {
        const contract = PRESENTATION_CONTRACTS[tier];
        for (const component of ACTIVE_VISUAL_COMPONENTS) {
            const token = contract[component];
            assert.match(
                styles,
                new RegExp(selectorFor(component, token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
                `${tier}.${component}=${token} için CSS selector eksik`
            );
        }
    }
});

test("Starter base storefront olarak kalır; Starter token selector override eklenmez", () => {
    const contract = PRESENTATION_CONTRACTS.starter;
    for (const component of ACTIVE_VISUAL_COMPONENTS) {
        assert.equal(styles.includes(selectorFor(component, contract[component])), false);
    }
});

test("Business ve Pro ürün medyası offering kart paddingiyle tam hizalanır", () => {
    assert.match(
        mediaStyles,
        /data-presentation-offering="advanced"[^}]*width:calc\(100% \+ 44px\)[^}]*margin:-22px -22px/
    );
    assert.match(
        mediaStyles,
        /data-presentation-offering="signature"[^}]*width:calc\(100% \+ 52px\)[^}]*margin:-26px -26px/
    );
});

test("gallery ve socialProof tokenları bu fazda reserved yüzeylerdir", () => {
    for (const tier of ["starter", "business", "pro"]) {
        assert.equal(typeof PRESENTATION_CONTRACTS[tier].gallery, "string");
        assert.equal(typeof PRESENTATION_CONTRACTS[tier].socialProof, "string");
    }
});
