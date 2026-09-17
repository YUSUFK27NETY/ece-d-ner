const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "../../public/storefront");
const BUSINESS_FAMILIES = Object.freeze([
    "modern",
    "warm",
    "bold",
    "corporate",
    "editorial",
    "minimal"
]);
const TENANTS = new Set([
    "demo-starter",
    "demo-business",
    "demo-pro",
    "demo-no-whatsapp",
    ...BUSINESS_FAMILIES.map(family => `demo-business-${family}`)
]);

const COMPONENTS = Object.freeze({
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

const MIME = Object.freeze({
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8"
});

function presentationForTenant(tenantId) {
    if (tenantId === "demo-no-whatsapp") {
        return Object.freeze({ tier: "business", designFamily: "modern" });
    }
    if (tenantId.startsWith("demo-business-")) {
        return Object.freeze({
            tier: "business",
            designFamily: tenantId.slice("demo-business-".length)
        });
    }
    const tier = tenantId.replace(/^demo-/, "");
    return Object.freeze({
        tier,
        designFamily: tier === "pro" ? "editorial" : "modern"
    });
}

function storefrontFor(tenantId) {
    const { tier, designFamily } = presentationForTenant(tenantId);
    const label = `${tier}-${designFamily}`;
    const whatsappEnabled = tenantId !== "demo-no-whatsapp";
    return {
        tenant: {
            tenantId,
            displayName: `Atlas Studio ${label}`,
            sector: "professional-services",
            features: {
                catalog: true,
                orders: false,
                appointments: true,
                reservations: false,
                whatsapp: whatsappEnabled,
                inventory: false,
                quotes: true,
                crm: false,
                fleet: false,
                gallery: false,
                delivery: false,
                campaigns: false,
                loyalty: false,
                staff: false,
                reviews: false,
                analytics: false
            },
            profile: {
                brandName: `ATLAS STUDIO ${label.toUpperCase()}`,
                phone: "+90 342 000 00 00",
                whatsapp: "+90 530 000 00 00",
                address: "Gaziantep",
                primaryColor: "#7C3AED"
            }
        },
        products: [
            {
                productId: "strategy-1",
                name: "Başlangıç Danışmanlığı",
                category: "Strateji",
                price: 2500,
                description: "İhtiyacınızı netleştirip uygulanabilir bir yol haritası oluşturun.",
                imageUrl: ""
            },
            {
                productId: "operations-1",
                name: "Operasyon Paketi",
                category: "Büyüme",
                price: 5900,
                description: "Günlük süreci daha düzenli ve ölçülebilir hale getiren profesyonel paket.",
                imageUrl: ""
            },
            {
                productId: "premium-1",
                name: "Özel Çözüm",
                category: "Premium",
                price: 9900,
                description: "Markanın ihtiyacına göre şekillenen kapsamlı danışmanlık deneyimi.",
                imageUrl: ""
            }
        ],
        presentation: {
            schemaVersion: 1,
            tier,
            source: "configured",
            designFamily,
            designFamilySource: "configured",
            sector: {
                sector: "professional-services",
                offeringKind: "services",
                offeringLabel: "Hizmetler",
                primaryActionFeature: "appointments"
            },
            components: COMPONENTS[tier],
            sections: [
                { id: "navigation", variant: COMPONENTS[tier].navigation },
                { id: "hero", variant: COMPONENTS[tier].hero },
                { id: "offering", variant: COMPONENTS[tier].offering },
                { id: "modules", variant: COMPONENTS[tier].offering },
                { id: "business-info", variant: "standard" },
                { id: "footer", variant: COMPONENTS[tier].footer }
            ]
        }
    };
}

function sendFile(res, filePath) {
    const extension = path.extname(filePath);
    const contentType = MIME[extension] || "application/octet-stream";
    let body;
    try {
        body = fs.readFileSync(filePath);
    } catch {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
    }
    res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    });
    res.end(body);
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);

    if (url.pathname.startsWith("/api/public/storefront/")) {
        const tenantId = decodeURIComponent(url.pathname.slice("/api/public/storefront/".length));
        if (!TENANTS.has(tenantId) || [...url.searchParams].length) {
            res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ success: false, message: "Not found" }));
            return;
        }
        res.writeHead(200, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store"
        });
        res.end(JSON.stringify({ success: true, storefront: storefrontFor(tenantId) }));
        return;
    }

    if (url.pathname.startsWith("/m/")) {
        const tail = decodeURIComponent(url.pathname.slice(3));
        if (TENANTS.has(tail)) {
            sendFile(res, path.join(PUBLIC_DIR, "index.html"));
            return;
        }
        if (/^[a-z0-9.-]+$/.test(tail) && tail.includes(".")) {
            sendFile(res, path.join(PUBLIC_DIR, tail));
            return;
        }
    }

    if (url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: true }));
        return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
});

server.listen(PORT, HOST, () => {
    process.stdout.write(`presentation visual smoke server listening on http://${HOST}:${PORT}\n`);
});

function close() {
    server.close(() => process.exit(0));
}

process.on("SIGTERM", close);
process.on("SIGINT", close);
