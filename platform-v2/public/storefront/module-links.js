(() => {
    "use strict";

    const moduleGrid = document.getElementById("module-grid");
    if (!moduleGrid) return;

    function normalizeFragmentLinks(root = moduleGrid) {
        const links = root.matches?.('a[href^="#"]')
            ? [root]
            : [...root.querySelectorAll('a[href^="#"]')];

        for (const link of links) {
            link.removeAttribute("target");
            link.removeAttribute("rel");
        }
    }

    normalizeFragmentLinks();

    const observer = new MutationObserver(records => {
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    normalizeFragmentLinks(node);
                }
            }
        }
    });

    observer.observe(moduleGrid, { childList: true, subtree: true });

    moduleGrid.addEventListener("click", event => {
        const link = event.target.closest?.('a[href^="#"]');
        if (!link || !moduleGrid.contains(link)) return;

        link.removeAttribute("target");
        link.removeAttribute("rel");
    });
})();
