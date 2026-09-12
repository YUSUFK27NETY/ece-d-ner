"use strict";

const OWNER_CHANNEL_BASE = "/api/tenant/tenants/:tenantId/owner/channels";

function hasCallerInput(req) {
    const contentLength = req.get("content-length");
    return req.body !== undefined ||
        contentLength !== undefined && contentLength !== "0" ||
        req.get("transfer-encoding") !== undefined ||
        Reflect.ownKeys(req.query).length > 0;
}

function actorContext(req) {
    return Object.freeze({
        role: req.tenantActor.role,
        actorId: req.tenantActor.actorId,
        tenantId: req.tenantActor.tenantId
    });
}

function sendChannelError(res, error) {
    if (error?.code === "TENANT_NOT_FOUND") {
        return res.status(404).json({ success: false, message: "İşletme bulunamadı." });
    }
    if (new Set(["TENANT_SCOPE_MISMATCH", "PERMISSION_DENIED"]).has(error?.code)) {
        return res.status(403).json({ success: false, message: "Bu işlem için yetki yok." });
    }
    if (new Set(["PUBLIC_CHANNELS_NOT_AVAILABLE", "TENANT_ARCHIVED"]).has(error?.code)) {
        return res.status(409).json({
            success: false,
            message: error.code === "TENANT_ARCHIVED"
                ? "Arşivlenmiş işletme güncellenemez."
                : "QR mevcut işletme durumunda kullanılamıyor."
        });
    }
    if (error instanceof TypeError) {
        return res.status(400).json({ success: false, message: "Paylaşım isteği geçersiz." });
    }
    console.error("Owner public channel işlemi başarısız.", error?.code || "UNEXPECTED");
    return res.status(500).json({ success: false, message: "Paylaşım işlemi tamamlanamadı." });
}

function attachPublicChannelOwnerEndpoints({ app, publicChannelService }) {
    if (!app || typeof app.get !== "function" || typeof app.patch !== "function") {
        throw new TypeError("Public channel owner endpoint app geçersiz.");
    }
    if (!publicChannelService || typeof publicChannelService.get !== "function" ||
        typeof publicChannelService.update !== "function" ||
        typeof publicChannelService.qr !== "function") {
        throw new TypeError("Public channel service geçersiz.");
    }

    app.get(OWNER_CHANNEL_BASE, async (req, res) => {
        try {
            if (hasCallerInput(req)) throw new TypeError("Public channel sorgusu parametre kabul etmez.");
            const channels = await publicChannelService.get({
                context: actorContext(req),
                tenantId: req.params.tenantId
            });
            return res.json({ success: true, channels });
        } catch (error) {
            return sendChannelError(res, error);
        }
    });

    app.patch(OWNER_CHANNEL_BASE, async (req, res) => {
        try {
            if (Reflect.ownKeys(req.query).length > 0) {
                throw new TypeError("Public channel güncellemesi query kabul etmez.");
            }
            const channels = await publicChannelService.update({
                context: actorContext(req),
                tenantId: req.params.tenantId,
                patch: req.body,
                requestId: req.requestId || null
            });
            return res.json({ success: true, channels });
        } catch (error) {
            return sendChannelError(res, error);
        }
    });

    app.get(`${OWNER_CHANNEL_BASE}/qr.svg`, async (req, res) => {
        try {
            if (hasCallerInput(req)) throw new TypeError("QR isteği parametre kabul etmez.");
            const qr = await publicChannelService.qr({
                context: actorContext(req),
                tenantId: req.params.tenantId
            });
            res.type("image/svg+xml");
            res.set("Content-Disposition", `inline; filename="${qr.filename}"`);
            res.set("Cache-Control", "private, no-store");
            return res.send(qr.svg);
        } catch (error) {
            return sendChannelError(res, error);
        }
    });

    return app;
}

module.exports = {
    OWNER_CHANNEL_BASE,
    attachPublicChannelOwnerEndpoints,
    sendChannelError
};
