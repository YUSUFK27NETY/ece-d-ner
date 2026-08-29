"use strict";

const DEFAULT_FRONTEND_URL =
    "https://yusufk27nety.github.io/ece-d-ner/";
const DEFAULT_BACKEND_HEALTH_URL =
    "https://ece-d-ner-1.onrender.com/healthz";
const DEFAULT_BACKEND_STATUS_URL =
    "https://ece-d-ner-1.onrender.com/api/restaurant/status";

async function fetchWithTimeout(
    fetchImplementation,
    url,
    timeoutMs
) {
    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        timeoutMs
    );

    try {
        return await fetchImplementation(
            url,
            {
                redirect: "follow",
                signal: controller.signal,
                headers: {
                    "User-Agent":
                        "ece-doner-uptime-monitor/1.0"
                }
            }
        );
    } finally {
        clearTimeout(timer);
    }
}

function assertOk(response, label) {
    if (!response?.ok) {
        throw new Error(
            `${label} HTTP ${response?.status ?? "yanıt yok"}`
        );
    }
}

async function checkFrontend(
    fetchImplementation,
    url,
    timeoutMs
) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        url,
        timeoutMs
    );

    assertOk(response, "Müşteri sitesi");

    const html = await response.text();

    if (!/ECE DÖNER/i.test(html)) {
        throw new Error(
            "Müşteri sitesi beklenen Ece Döner içeriğini döndürmedi."
        );
    }
}

async function checkBackendHealth(
    fetchImplementation,
    url,
    timeoutMs
) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        url,
        timeoutMs
    );

    assertOk(response, "Backend sağlık kontrolü");

    const body = await response.json();

    if (
        body?.success !== true ||
        body?.status !== "ok" ||
        body?.service !== "qr-menu-pro"
    ) {
        throw new Error(
            "Backend sağlık yanıtı beklenen biçimde değil."
        );
    }
}

async function checkRestaurantStatus(
    fetchImplementation,
    url,
    timeoutMs
) {
    const response = await fetchWithTimeout(
        fetchImplementation,
        url,
        timeoutMs
    );

    assertOk(response, "Firestore durum kontrolü");

    const body = await response.json();

    if (
        body?.success !== true ||
        typeof body?.isOpen !== "boolean"
    ) {
        throw new Error(
            "Firestore restoran durumu beklenen biçimde değil."
        );
    }
}

async function checkLiveEndpoints({
    fetchImplementation = globalThis.fetch,
    frontendUrl = DEFAULT_FRONTEND_URL,
    backendHealthUrl = DEFAULT_BACKEND_HEALTH_URL,
    backendStatusUrl = DEFAULT_BACKEND_STATUS_URL,
    timeoutMs = 20000
} = {}) {
    if (typeof fetchImplementation !== "function") {
        throw new TypeError("Fetch desteği gerekli.");
    }

    await Promise.all([
        checkFrontend(
            fetchImplementation,
            frontendUrl,
            timeoutMs
        ),
        checkBackendHealth(
            fetchImplementation,
            backendHealthUrl,
            timeoutMs
        ),
        checkRestaurantStatus(
            fetchImplementation,
            backendStatusUrl,
            timeoutMs
        )
    ]);

    return {
        success: true,
        checkedAt: new Date().toISOString(),
        endpoints: 3
    };
}

module.exports = {
    DEFAULT_FRONTEND_URL,
    DEFAULT_BACKEND_HEALTH_URL,
    DEFAULT_BACKEND_STATUS_URL,
    checkLiveEndpoints
};
