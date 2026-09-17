(() => {
    "use strict";

    const modal = document.getElementById("cart-modal");
    const openButton = document.getElementById("cart-open");
    const closeButton = document.getElementById("cart-close");
    if (!modal || !openButton || !closeButton) return;

    const FOCUSABLE_SELECTOR = [
        "a[href]",
        "button:not([disabled])",
        "input:not([disabled])",
        "textarea:not([disabled])",
        "select:not([disabled])",
        '[tabindex]:not([tabindex="-1"])'
    ].join(",");

    let restoreFocus = openButton;

    function isOpen() {
        return !modal.classList.contains("hidden");
    }

    function focusableElements() {
        return [...modal.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element =>
            !element.hidden && element.getAttribute("aria-hidden") !== "true"
        );
    }

    function restoreTriggerFocus() {
        if (restoreFocus?.isConnected && typeof restoreFocus.focus === "function") {
            restoreFocus.focus();
        }
    }

    openButton.addEventListener("click", () => {
        if (!isOpen()) return;
        restoreFocus = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : openButton;
        window.queueMicrotask(() => {
            if (isOpen()) closeButton.focus();
        });
    });

    closeButton.addEventListener("click", restoreTriggerFocus);
    modal.addEventListener("click", event => {
        if (event.target === modal && !isOpen()) restoreTriggerFocus();
    });

    document.addEventListener("keydown", event => {
        if (!isOpen()) return;

        if (event.key === "Escape") {
            event.preventDefault();
            closeButton.click();
            return;
        }

        if (event.key !== "Tab") return;
        const focusables = focusableElements();
        if (!focusables.length) {
            event.preventDefault();
            closeButton.focus();
            return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey && (active === first || !modal.contains(active))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
            event.preventDefault();
            first.focus();
        }
    });
})();
