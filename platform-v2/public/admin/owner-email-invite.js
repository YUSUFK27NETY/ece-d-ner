(() => {
    "use strict";

    const tenantIdInput = document.getElementById("tenant-id");
    const emailInput = document.getElementById("owner-email");
    const sendButton = document.getElementById("send-owner-invite");
    const status = document.getElementById("owner-invite-status");
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
            throw new Error("Önce canonical Tenant ID ile işletmeyi oluştur veya yükle.");
        }
        return tenantId;
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Geçerli bir owner e-posta adresi gir.");
        }
        return email;
    }

    async function getPlatformAdminToken() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Platform Admin oturumu bulunamadı.");
        return user.getIdToken(true);
    }

    async function createInvite(tenantId, email) {
        const idToken = await getPlatformAdminToken();
        const response = await fetch(
            `/api/platform/tenants/${encodeURIComponent(tenantId)}/admin-bootstrap/initial-owner-invite`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ email })
            }
        );
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || `Davet oluşturulamadı (${response.status}).`);
        const invite = body?.invite;
        if (!body?.success || invite?.tenantId !== tenantId || invite?.role !== "tenant_owner" ||
            invite?.delivery !== "firebase_email_link" ||
            typeof invite?.inviteToken !== "string" || typeof invite?.expiresAt !== "string") {
            throw new Error("Davet yanıtı doğrulanamadı.");
        }
        return invite;
    }

    function inviteLandingUrl(tenantId, inviteToken) {
        const url = new URL("/owner/accept-invite.html", window.location.origin);
        const fragment = new URLSearchParams();
        fragment.set("tenantId", tenantId);
        fragment.set("inviteToken", inviteToken);
        url.hash = fragment.toString();
        return url.toString();
    }

    function friendlyFirebaseError(error) {
        if (error?.code === "auth/operation-not-allowed") {
            return "Firebase Email Link giriş yöntemi etkin değil. Authentication > Sign-in method bölümünde Email/Password ve Email link yöntemlerini etkinleştir.";
        }
        if (error?.code === "auth/unauthorized-continue-uri") {
            return "Production domain Firebase Authentication yetkili domain listesinde değil.";
        }
        if (error?.code === "auth/invalid-email") return "Owner e-posta adresi Firebase tarafından geçersiz bulundu.";
        if (error?.code === "auth/too-many-requests") return "Firebase çok fazla e-posta isteği algıladı. Daha sonra yeniden dene.";
        return error?.message || "Owner daveti gönderilemedi.";
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
            const invite = await createInvite(tenantId, email);
            await firebase.auth().sendSignInLinkToEmail(email, {
                url: inviteLandingUrl(tenantId, invite.inviteToken),
                handleCodeInApp: true
            });
            emailInput.value = "";
            const expires = new Date(invite.expiresAt);
            setStatus(
                `Owner daveti Firebase üzerinden gönderildi. Davet ${expires.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })} saatine kadar geçerli. Owner kabul edince Hazırlık adımını yenile.`,
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
