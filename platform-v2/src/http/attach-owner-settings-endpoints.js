"use strict";

const OWNER_SETTINGS_BASE = "/api/tenant/tenants/:tenantId/owner/settings";

function actorContext(req) {
    return Object.freeze({
        role: req.tenantActor?.role,
        actorId: req.tenantActor?.actorId,
        tenantId: req.tenantActor?.tenantId
    });
}

function noQuery(req) {
    if (Reflect.ownKeys(req.query).length > 0) {
        throw new TypeError("Owner ayarları endpoint query kabul etmez.");
    }
}

function sendOwnerSettingsError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "İşletme bulunamadı." });
    }
    if (new Set(["TENANT_SCOPE_MISMATCH", "PERMISSION_DENIED"]).has(error?.code)) {
        return res.status(403).json({ success: false, message: "Bu ayarlar için yetkiniz yok." });
    }
    if (error?.code === "TENANT_ARCHIVED") {
        return res.status(409).json({
            success: false,
            message: "Arşivlenmiş işletme güncellenemez."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({
            success: false,
            message: "İşletme ayarları isteği geçersiz."
        });
    }
    console.error("Owner ayarları işlemi başarısız.", error?.code || "UNEXPECTED");
    return res.status(500).json({
        success: false,
        message: "İşletme ayarları işlemi tamamlanamadı."
    });
}

function attachOwnerSettingsEndpoints({ app, ownerSettingsService } = {}) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Owner ayarları endpoint app geçersiz.");
    }
    if (!ownerSettingsService ||
        typeof ownerSettingsService.get !== "function" ||
        typeof ownerSettingsService.update !== "function") {
        throw new TypeError("Owner ayarları service geçersiz.");
    }

    app.get(OWNER_SETTINGS_BASE, async (req, res) => {
        try {
            noQuery(req);
            const settings = await ownerSettingsService.get({
                context: actorContext(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, settings });
        } catch (error) {
            return sendOwnerSettingsError(res, error);
        }
    });

    app.patch(OWNER_SETTINGS_BASE, async (req, res) => {
        try {
            noQuery(req);
            if (!req.is("application/json")) {
                return res.status(415).json({
                    success: false,
                    message: "Content-Type application/json olmalı."
                });
            }
            const settings = await ownerSettingsService.update({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                patch: req.body,
                requestId: req.requestId || null
            });
            return res.json({ success: true, settings });
        } catch (error) {
            return sendOwnerSettingsError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_SETTINGS_BASE,
    attachOwnerSettingsEndpoints,
    sendOwnerSettingsError
};
