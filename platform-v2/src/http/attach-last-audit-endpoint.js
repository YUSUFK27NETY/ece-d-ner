const { requireTenantId } = require("../tenant/tenant-id");
const {
    assertLastAuditReadModel
} = require("../audit/last-audit-read-model");

function attachLastAuditEndpoint({ app, tenantRegistry, lastAuditReadModel }) {
    if (!app || typeof app.get !== "function") {
        throw new TypeError("Last audit endpoint için app gerekli.");
    }
    if (!tenantRegistry || typeof tenantRegistry.getById !== "function") {
        throw new TypeError("Last audit endpoint için tenant registry gerekli.");
    }
    if (!lastAuditReadModel || typeof lastAuditReadModel.get !== "function") {
        throw new TypeError("Last audit read model geçersiz.");
    }

    app.get("/api/platform/tenants/:tenantId/last-audit", async (req, res) => {
        let tenantId;
        try {
            tenantId = requireTenantId(req.params.tenantId);
            if (tenantId !== req.params.tenantId) {
                throw new TypeError();
            }
        } catch {
            return res.status(400).json({
                success: false,
                message: "Son audit tenant kimliği geçersiz."
            });
        }

        try {
            const tenant = await tenantRegistry.getById(tenantId);
            if (!tenant) {
                return res.status(404).json({
                    success: false,
                    message: "İşletme bulunamadı."
                });
            }

            const lastAudit = assertLastAuditReadModel(
                await lastAuditReadModel.get(Object.freeze({ tenantId }))
            );
            return res.json({ success: true, lastAudit });
        } catch {
            console.error("Son audit görünürlüğü okunamadı.");
            return res.status(500).json({
                success: false,
                message: "Son audit bilgisi alınamadı."
            });
        }
    });

    return app;
}

module.exports = {
    attachLastAuditEndpoint
};
