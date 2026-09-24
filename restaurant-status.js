"use strict";

// Runs before the Firebase SDKs, so menu loading cannot delay the status check.
(() => {
    const STATUS_URL =
        "https://ece-d-ner-1.onrender.com/api/restaurant/status";
    const REQUEST_TIMEOUT_MS = 18000;
    const REFRESH_MS = 120000;
    const RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
    const listeners = new Set();
    let snapshot = Object.freeze({
        phase: "checking",
        isOpen: false,
        orderIdempotencySupported: false
    });
    let scheduledRequest = null;
    let requestInFlight = null;
    let activeController = null;
    let failures = 0;

    const isOnline = () => navigator.onLine !== false;
    const isVisible = () => document.visibilityState !== "hidden";

    function publish(next) {
        snapshot = Object.freeze(next);
        const badge = document.querySelector(".status .open");
        const labels = {
            checking: ["🟡 Durum Kontrol Ediliyor", "#facc15"],
            retrying: ["🟡 Bağlantı Kuruluyor, Otomatik Deneniyor", "#facc15"],
            offline: ["🟠 İnternet Bağlantısı Bekleniyor", "#fb923c"],
            ready: snapshot.isOpen
                ? ["🟢 Şu Anda Açık", "#22c55e"]
                : ["🔴 Şu Anda Kapalı", "#ef4444"]
        };
        if (badge) {
            [badge.textContent, badge.style.color] = labels[snapshot.phase];
        }
        listeners.forEach(listener => listener(snapshot));
    }

    function markUnavailable(phase) {
        publish({ phase, isOpen: false, orderIdempotencySupported: false });
    }

    function clearScheduledRequest() {
        if (scheduledRequest !== null) {
            clearTimeout(scheduledRequest);
            scheduledRequest = null;
        }
    }

    function scheduleNextRequest() {
        clearScheduledRequest();
        if (!isOnline() || !isVisible()) return;
        const delay = failures === 0
            ? REFRESH_MS
            : RETRY_DELAYS_MS[Math.min(failures - 1, RETRY_DELAYS_MS.length - 1)];
        scheduledRequest = setTimeout(refresh, delay);
    }

    async function requestStatus() {
        const controller = new AbortController();
        activeController = controller;
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        let result;
        try {
            const response = await fetch(STATUS_URL, {
                cache: "no-store",
                signal: controller.signal
            });
            if (!response.ok) throw new Error("Status request failed");
            // Keep the deadline active while reading the body as well.
            result = await response.json();
            if (result?.success !== true || typeof result.isOpen !== "boolean") {
                throw new Error("Invalid restaurant status");
            }
        } catch {
            failures++;
        } finally {
            clearTimeout(timeout);
            activeController = null;
        }

        if (!isOnline()) {
            markUnavailable("offline");
        } else if (result?.success === true && typeof result.isOpen === "boolean") {
            failures = 0;
            publish({
                phase: "ready",
                isOpen: result.isOpen,
                orderIdempotencySupported: result.features?.orderIdempotency === true
            });
        } else {
            markUnavailable("retrying");
        }
    }

    function refresh() {
        if (requestInFlight) return requestInFlight;
        clearScheduledRequest();
        if (!isOnline()) {
            markUnavailable("offline");
            return Promise.resolve();
        }
        if (!isVisible()) return Promise.resolve();
        if (snapshot.phase === "offline") markUnavailable("checking");
        requestInFlight = requestStatus().finally(() => {
            requestInFlight = null;
            scheduleNextRequest();
        });
        return requestInFlight;
    }

    window.eceRestaurantStatus = Object.freeze({
        refresh,
        getSnapshot: () => snapshot,
        subscribe(listener) {
            listeners.add(listener);
            listener(snapshot);
            return () => listeners.delete(listener);
        }
    });

    document.addEventListener("visibilitychange", () => {
        if (isVisible()) refresh();
        else clearScheduledRequest();
    });
    window.addEventListener("online", () => {
        failures = 0;
        refresh();
    });
    window.addEventListener("offline", () => {
        clearScheduledRequest();
        activeController?.abort();
        markUnavailable("offline");
    });
    window.addEventListener("pageshow", event => {
        if (event.persisted) refresh();
    });

    publish(snapshot);
    refresh();
})();
