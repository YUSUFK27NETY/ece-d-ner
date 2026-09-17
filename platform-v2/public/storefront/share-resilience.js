(() => {
    "use strict";

    const button = document.getElementById("share-button");
    const toast = document.getElementById("toast");
    if (!button || !toast) return;

    function showToast(text) {
        toast.textContent = text;
        toast.classList.add("show");
        window.setTimeout(() => toast.classList.remove("show"), 2300);
    }

    async function sharePage() {
        const url = window.location.href;
        const title = document.getElementById("header-brand")?.textContent?.trim() ||
            document.title ||
            "İşletme";

        if (typeof navigator.share === "function") {
            try {
                await navigator.share({ title, url });
                return;
            } catch (error) {
                if (error?.name === "AbortError") return;
            }
        }

        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(url);
                showToast("Bağlantı kopyalandı.");
                return;
            } catch {
                // Continue to the visible manual-share fallback below.
            }
        }

        showToast("Bağlantıyı adres çubuğundan paylaşabilirsiniz.");
    }

    // storefront.js has already registered its basic handler. Replacing the node
    // removes that listener without exposing internals from the storefront runtime.
    const resilientButton = button.cloneNode(true);
    button.replaceWith(resilientButton);
    resilientButton.addEventListener("click", () => {
        void sharePage();
    });
})();
