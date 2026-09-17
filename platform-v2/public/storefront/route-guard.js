(() => {
    "use strict";

    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts.length !== 2 || parts[0] !== "m") return;

    try {
        decodeURIComponent(parts[1]);
    } catch {
        const safeLocation = `/m/x${window.location.search || ""}${window.location.hash || ""}`;
        window.history.replaceState(null, "", safeLocation);
    }
})();
