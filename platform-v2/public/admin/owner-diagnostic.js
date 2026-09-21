(() => {
    "use strict";

    const tenantIdInput = document.getElementById("tenant-id");
    const checkButton = document.getElementById("check-owner-diagnostic");
    const status = document.getElementById("owner-diagnostic-status");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    if (!tenantIdInput || !checkButton || !status) return;

    const MESSAGES = Object.freeze({
        READY_FOR_INVITE: "Owner tarafı temiz. Yeni owner daveti gönderilebilir.",
        INVITE_PENDING: "Aktif bir owner daveti bekliyor. Aynı davet kullanılabilir veya yenisi oluşturulabilir.",
        INVITE_EXPIRED: "Eski owner davetinin süresi dolmuş. Yeni davet oluşturulabilir.",
        INVITE_INVALID: "Owner davet kaydı geçersiz görünüyor. Teknik düzeltme gerekiyor.",
        OWNER_BINDING_PARTIAL: "Owner kurulumu yarım kalmış. Teknik düzeltme gerekiyor.",
        OWNER_BINDING_INVALID: "Owner binding kaydı geçersiz görünüyor. Teknik düzeltme gerekiyor.",
        OWNER_BOUND_CONSISTENT: "Owner kayıtları tutarlı. Yeni davet gerekmiyor.",
        OWNER_BOUND_WITH_STALE_INVITE: "Owner bağlı, ancak eski bir davet kaydı kalmış.",
        EVIDENCE_WITHOUT_OWNER_BINDING: "Bootstrap kaydı var ama owner binding yok. Teknik düzeltme gerekiyor.",
        EVIDENCE_INVALID: "Bootstrap readiness kaydı geçersiz görünüyor. Teknik düzeltme gerekiyor."
    });

    function setStatus(text = "", type = "") {
        status.textContent = text;
        status.classList.remove("error", "success");
        if (type) status.classList.add(type);
    }

    function canonicalTenantId() {
        const raw = tenantIdInput.value;
        const tenantId = raw.trim().toLowerCase();
        if (raw !== tenantId || tenantId.length < 3 || tenantId.length > 63 ||
            !TENANT_ID_PATTERN.test(tenantId)) {
            throw new Error("Önce geçerli Tenant ID ile işletmeyi yükle.");
        }
        return tenantId;
    }

    async function getPlatformAdminToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken(true);
    }

    function artifactSummary(artifacts = {}) {
        const owner = artifacts.ownerBinding?.exists === true ? "var" : "yok";
        const invite = artifacts.invite?.exists === true
            ? (artifacts.invite.expired === true ? "süresi dolmuş" : "var")
            : "yok";
        const evidence = artifacts.evidence?.exists === true
            ? (artifacts.evidence.state || "var")
            : "yok";
        const member = artifacts.member?.checked === true
            ? (artifacts.member.exists === true ? (artifacts.member.state || "var") : "yok")
            : "kontrol edilmedi";
        return "Binding: " + owner + " · Davet: " + invite +
            " · Bootstrap: " + evidence + " · Member: " + member;
    }

    function validateDiagnostic(body, tenantId) {
        const diagnostic = body?.diagnostic;
        if (!body?.success || !diagnostic || diagnostic.tenantId !== tenantId ||
            typeof diagnostic.code !== "string" ||
            !diagnostic.artifacts || typeof diagnostic.artifacts !== "object") {
            throw new Error("Owner teşhis yanıtı doğrulanamadı.");
        }
        return diagnostic;
    }

    checkButton.addEventListener("click", async () => {
        setStatus();
        let tenantId;
        try {
            tenantId = canonicalTenantId();
        } catch (error) {
            setStatus(error.message, "error");
            return;
        }

        checkButton.disabled = true;
        try {
            const token = await getPlatformAdminToken();
            const response = await fetch(
                "/api/platform/tenants/" + encodeURIComponent(tenantId) +
                    "/admin-bootstrap/initial-owner-diagnostic",
                {
                    method: "GET",
                    headers: {
                        Authorization: "Bearer " + token
                    }
                }
            );
            let body = null;
            try { body = await response.json(); } catch { body = null; }
            if (!response.ok) {
                throw new Error(body?.message || "Owner teşhisi alınamadı (" + response.status + ").");
            }
            const diagnostic = validateDiagnostic(body, tenantId);
            const explanation = MESSAGES[diagnostic.code] || "Owner durumu incelendi.";
            const type = diagnostic.code === "READY_FOR_INVITE" ||
                diagnostic.code === "OWNER_BOUND_CONSISTENT" ||
                diagnostic.code === "INVITE_PENDING"
                ? "success"
                : "error";
            setStatus(
                explanation + " [" + diagnostic.code + "] " +
                    artifactSummary(diagnostic.artifacts),
                type
            );
        } catch (error) {
            setStatus(error.message || "Owner teşhisi alınamadı.", "error");
        } finally {
            checkButton.disabled = false;
        }
    });
})();
