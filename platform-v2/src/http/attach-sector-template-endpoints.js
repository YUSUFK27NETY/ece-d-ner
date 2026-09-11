const { getSectorTemplateCatalog } = require("../tenant/sector-template-catalog");

function attachSectorTemplateEndpoints({ app }) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Express app gerekli.");
    }

    app.get("/api/platform/sector-templates", (req, res) => {
        res.json({
            success: true,
            catalog: getSectorTemplateCatalog()
        });
    });

    return app;
}

module.exports = {
    attachSectorTemplateEndpoints
};
