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

    function invitationState(emailLink) {
        const url = new URL(emailLink);
        const fragment = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
        const tenantId = fragment.get("tenantId") || "";
        const inviteToken = fragment.get("inviteToken") || "";
        const flow = fragment.get("flow") || "initial_owner";
        if (!TENANT_ID_PATTERN.test(tenantId) ||
            !INVITE_TOKEN_PATTERN.test(inviteToken) ||
            !["initial_owner", "owner_reassignment"].includes(flow)) {
            throw new Error("Owner davet bağlantısı geçersiz.");
        }
        return Object.freeze({ tenantId, inviteToken, flow });
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Davet gönderilen geçerli e-posta adresini gir.");
        }
        return email;
    }

    function friendlyFirebaseError(error) {
        const code = String(error?.code || "");
        if (code === "auth/invalid-action-code" || code === "auth/expired-action-code") {
            return "Bu owner davet bağlantısı geçersiz, süresi dolmuş veya daha önce kullanılmış. Platform yöneticisinden yeni owner daveti iste.";
        }
        if (code === "auth/invalid-email") {
            return "Owner olarak davet gönderilen müşteri e-posta adresini kontrol et.";
        }
        if (code === "auth/user-disabled") {
            return "Bu owner hesabı Firebase Authentication tarafında devre dışı.";
        }
        if (code === "auth/too-many-requests") {
            return "Çok fazla giriş denemesi yapıldı. Bir süre sonra yeni davet bağlantısıyla tekrar dene.";
        }
        if (code === "auth/network-request-failed") {
            return "Ağ bağlantısı nedeniyle owner daveti doğrulanamadı. İnternet bağlantısını kontrol edip tekrar dene.";
        }
        return "Owner daveti doğrulanamadı. Davet e-postasını ve bağlantının güncel olduğunu kontrol et.";
    }

    function friendlyInviteError(error) {
        const code = String(error?.code || "");
        if (code.startsWith("auth/")) return friendlyFirebaseError(error);

        const safeMessage = String(error?.message || "").trim();
        if (safeMessage && safeMessage.length <= 220 && !/^Firebase:/i.test(safeMessage)) {
            return safeMessage;
        }

        return "Owner daveti doğrulanamadı. Davet e-postasını ve bağlantının güncel olduğunu kontrol et.";
    }

    async function acceptServerInvite(tenantId, inviteToken, idToken, flow) {
        const suffix = flow === "owner_reassignment"
            ? "owner-reassignment/accept"
            : "initial-owner/accept";
        const response = await fetch(
            `/api/tenant-invitations/${encodeURIComponent(tenantId)}/${suffix}`,
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

    function scrubInviteFragment() {
        const url = new URL(window.location.href);
        window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
    }

    function scrubAfterSuccess(tenantId) {
        window.history.replaceState({}, document.title, `/owner/accept-invite.html?tenantId=${encodeURIComponent(tenantId)}`);
    }

    if (!firebaseConfig || typeof firebase === "undefined") {
        setEnabled(false);
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

    const firebaseEmailLink = window.location.href;
    let inviteState;
    try {
        inviteState = invitationState(firebaseEmailLink);
        scrubInviteFragment();
    } catch (error) {
        setEnabled(false);
        setMessage(error.message, "error");
        return;
    }

    if (!firebase.auth().isSignInWithEmailLink(firebaseEmailLink)) {
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
            const credential = await firebase.auth().signInWithEmailLink(email, firebaseEmailLink);
            const user = credential?.user || firebase.auth().currentUser;
            if (!user) throw new Error("Firebase owner oturumu oluşturulamadı.");
            const idToken = await user.getIdToken(true);
            const result = await acceptServerInvite(
                inviteState.tenantId,
                inviteState.inviteToken,
                idToken,
                inviteState.flow
            );
            emailInput.value = "";
            scrubAfterSuccess(inviteState.tenantId);
            ownerConsoleLink.href = `/owner/set-password.html?tenant=${encodeURIComponent(inviteState.tenantId)}`;
            next.hidden = false;
            form.hidden = true;
            setMessage(
                result.ownerReassigned === true
                    ? "Owner değişikliği tamamlandı. Şimdi kalıcı şifreni belirle."
                    : "Owner daveti kabul edildi. Şimdi kalıcı şifreni belirle.",
                "success"
            );
        } catch (error) {
            setMessage(friendlyInviteError(error), "error");
            setEnabled(true);
        }
    });
})();
