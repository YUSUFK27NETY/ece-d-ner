(() => {
    "use strict";

    const tenantIdInput = document.getElementById("tenant-id");
    const emailInput = document.getElementById("owner-email");
    const sendButton = document.getElementById("send-owner-reassignment");
    const status = document.getElementById("owner-reassignment-status");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;

    if (!tenantIdInput || !emailInput || !sendButton || !status) return;

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

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Yeni owner için geçerli e-posta adresi gir.");
        }
        return email;
    }

    async function getPlatformAdminToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken(true);
    }

    async function createReassignmentInvite(tenantId, email) {
        const idToken = await getPlatformAdminToken();
        const response = await fetch(
            "/api/platform/tenants/" + encodeURIComponent(tenantId) +
                "/admin-bootstrap/owner-reassignment-invite",
            {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + idToken,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email })
            }
        );
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) {
            throw new Error(
                body?.message ||
                "Owner değiştirme daveti oluşturulamadı (" +
                    response.status + ")."
            );
        }
        const invite = body?.invite;
        if (!body?.success ||
            invite?.tenantId !== tenantId ||
            invite?.role !== "tenant_owner" ||
            invite?.delivery !== "firebase_email_link" ||
            typeof invite?.inviteToken !== "string" ||
            typeof invite?.expiresAt !== "string") {
            throw new Error("Owner değiştirme davet yanıtı doğrulanamadı.");
        }
        return invite;
    }

    function inviteLandingUrl(tenantId, inviteToken) {
        const url = new URL("/owner/accept-invite.html", window.location.origin);
        const fragment = new URLSearchParams();
        fragment.set("tenantId", tenantId);
        fragment.set("inviteToken", inviteToken);
        fragment.set("flow", "owner_reassignment");
        url.hash = fragment.toString();
        return url.toString();
    }

    function friendlyFirebaseError(error) {
        if (error?.code === "auth/operation-not-allowed") {
            return "Firebase Email Link giriş yöntemi etkin değil.";
        }
        if (error?.code === "auth/unauthorized-continue-uri") {
            return "Production domain Firebase Authentication yetkili domain listesinde değil.";
        }
        if (error?.code === "auth/invalid-email") {
            return "Yeni owner e-posta adresi Firebase tarafından geçersiz bulundu.";
        }
        if (error?.code === "auth/too-many-requests") {
            return "Firebase çok fazla e-posta isteği algıladı. Daha sonra yeniden dene.";
        }
        return error?.message || "Owner değiştirme daveti gönderilemedi.";
    }

    sendButton.addEventListener("click", async () => {
        setStatus();
        let tenantId;
        let email;
        try {
            tenantId = canonicalTenantId();
            email = normalizedEmail();
        } catch (error) {
            setStatus(error.message, "error");
            return;
        }

        sendButton.disabled = true;
        emailInput.disabled = true;
        try {
            const invite = await createReassignmentInvite(tenantId, email);
            await firebase.auth().sendSignInLinkToEmail(email, {
                url: inviteLandingUrl(tenantId, invite.inviteToken),
                handleCodeInApp: true
            });
            const expires = new Date(invite.expiresAt);
            setStatus(
                "Owner değiştirme daveti gönderildi. Yeni owner kabul edene kadar " +
                "mevcut owner değişmez. Davet " +
                expires.toLocaleTimeString("tr-TR", {
                    hour: "2-digit",
                    minute: "2-digit"
                }) +
                " saatine kadar geçerli.",
                "success"
            );
        } catch (error) {
            setStatus(friendlyFirebaseError(error), "error");
        } finally {
            emailInput.disabled = false;
            sendButton.disabled = false;
        }
    });
})();
