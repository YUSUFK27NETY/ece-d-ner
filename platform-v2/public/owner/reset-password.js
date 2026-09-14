(() => {
    "use strict";

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const firebaseConfig = bootstrap.firebase;
    const form = document.getElementById("reset-password-form");
    const emailInput = document.getElementById("reset-password-email");
    const submitButton = document.getElementById("reset-password-submit");
    const message = document.getElementById("reset-password-message");

    function setMessage(text = "", type = "") {
        message.textContent = text;
        message.className = "message";
        if (type) message.classList.add(type);
    }

    function normalizedEmail() {
        const email = emailInput.value.trim().toLowerCase();
        if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            throw new Error("Geçerli e-posta adresini gir.");
        }
        return email;
    }

    function ownerLoginUrl() {
        return new URL("/owner/", window.location.origin).toString();
    }

    if (!form || !emailInput || !submitButton || !message) return;

    if (!firebaseConfig || typeof firebase === "undefined" || !firebase.auth) {
        submitButton.disabled = true;
        setMessage("Firebase yapılandırması kullanılamıyor.", "error");
        return;
    }
    if (firebase.apps.length === 0) firebase.initializeApp(firebaseConfig);

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

        submitButton.disabled = true;
        try {
            await firebase.auth().sendPasswordResetEmail(email, {
                url: ownerLoginUrl()
            });
            emailInput.value = "";
            setMessage("Hesap uygunsa şifre sıfırlama bağlantısı e-postana gönderildi.", "success");
        } catch (error) {
            if (error?.code === "auth/user-not-found") {
                setMessage("Hesap uygunsa şifre sıfırlama bağlantısı e-postana gönderildi.", "success");
            } else {
                setMessage("Şifre sıfırlama işlemi tamamlanamadı. Biraz sonra tekrar dene.", "error");
            }
        } finally {
            submitButton.disabled = false;
        }
    });
})();
