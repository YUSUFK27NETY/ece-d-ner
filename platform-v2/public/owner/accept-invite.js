(() => {
    "use strict";

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("owner-invite-form");
    const emailInput = document.getElementById("owner-invite-email");
    const acceptButton = document.getElementById("owner-invite-accept");
    const message = document.getElementById("owner-invite-message");
    const next = document.getElementById("owner-invite-next");
    const ownerConsoleLink = document.getElementById("owner-console-link");
    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,120}$/;

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.classList.remove("error", "success");
        if (type) message.classList.add(type);
    }

    function setEnabled(enabled) {
        emailInput.disabled = !enabled;
        acceptButton.disabled = !enabled;
    }

    function invitationState() {
        const url = new URL(window.location.href);
        const tenantId = url.searchParams.get("tenantId") || "";
        const inviteToken = url.searchParams.get("inviteToken") || "";
        if (!TENANT_ID_PATTERN.test(tenantId) || !INVITE_TOKEN_PATTERN.test(inviteToken)) {
            throw new Error("Owner davet bağlantısı geçersiz.");
        }
        return Object.freeze({ tenantId, inviteToken });
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Davet gönderilen geçerli e-posta adresini gir.");
        }
        return email;
    }

    async function acceptServerInvite(tenantId, inviteToken, idToken) {
        const response = await fetch(
            `/api/tenant-invitations/${encodeURIComponent(tenantId)}/initial-owner/accept`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${idToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ inviteToken })
            }
        );
        let body = null;
        try { body = await response.json(); } catch { body = null; }
        if (!response.ok) throw new Error(body?.message || `Davet kabul edilemedi (${response.status}).`);
        const result = body?.bootstrap;
        if (!body?.success || result?.tenantId !== tenantId || result?.role !== "tenant_owner" ||
            result?.state !== "active" || result?.adminBootstrap !== "verified") {
            throw new Error("Owner davet kabul yanıtı doğrulanamadı.");
        }
        return result;
    }

    function scrubSensitiveUrl(tenantId) {
        window.history.replaceState({}, document.title, `/owner/accept-invite.html?tenantId=${encodeURIComponent(tenantId)}`);
    }

    if (!firebaseConfig || typeof firebase === "undefined") {
        setEnabled(false);
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

    let inviteState;
    try {
        inviteState = invitationState();
    } catch (error) {
        setEnabled(false);
        setMessage(error.message, "error");
        return;
    }

    if (!firebase.auth().isSignInWithEmailLink(window.location.href)) {
        setEnabled(false);
        setMessage("Bu bağlantı geçerli bir Firebase e-posta giriş bağlantısı değil.", "error");
        return;
    }

    form.addEventListener("submit", async event => {
        event.preventDefault();
        setMessage();
        let email;
        try {
            email = normalizedEmail();
        } catch (error) {
            setMessage(error.message, "error");
            return;
        }

        setEnabled(false);
        try {
            const credential = await firebase.auth().signInWithEmailLink(email, window.location.href);
            const user = credential?.user || firebase.auth().currentUser;
            if (!user) throw new Error("Firebase owner oturumu oluşturulamadı.");
            const idToken = await user.getIdToken(true);
            await acceptServerInvite(inviteState.tenantId, inviteState.inviteToken, idToken);
            emailInput.value = "";
            scrubSensitiveUrl(inviteState.tenantId);
            ownerConsoleLink.href = `/owner/?tenantId=${encodeURIComponent(inviteState.tenantId)}`;
            next.hidden = false;
            form.hidden = true;
            setMessage("Owner daveti kabul edildi. İşletme sahibi hesabın artık aktif.", "success");
        } catch (error) {
            setMessage(error?.message || "Owner daveti kabul edilemedi.", "error");
            setEnabled(true);
        }
    });
})();
