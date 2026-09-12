(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const el = Object.freeze({
        backLink: document.getElementById("back-link"),
        successBack: document.getElementById("success-back"),
        brandName: document.getElementById("brand-name"),
        timezoneLabel: document.getElementById("timezone-label"),
        service: document.getElementById("service-select"),
        staff: document.getElementById("staff-select"),
        date: document.getElementById("date-input"),
        slotMessage: document.getElementById("slot-message"),
        slotGrid: document.getElementById("slot-grid"),
        form: document.getElementById("appointment-form"),
        customerName: document.getElementById("customer-name"),
        customerPhone: document.getElementById("customer-phone"),
        note: document.getElementById("appointment-note"),
        summary: document.getElementById("selection-summary"),
        formMessage: document.getElementById("form-message"),
        submit: document.getElementById("submit-button"),
        successModal: document.getElementById("success-modal"),
        successDetail: document.getElementById("success-detail")
    });

    if (Object.values(el).some(value => value === null)) return;

    const state = {
        tenantId: "",
        config: null,
        serviceId: "",
        staffId: "",
        selectedStartAt: "",
        slots: [],
        busy: false,
        idempotencyKey: ""
    };

    function readTenantId() {
        const parts = window.location.pathname.split("/").filter(Boolean);
        if (parts.length !== 3 || parts[0] !== "m" || parts[2] !== "appointments") return "";
        const candidate = decodeURIComponent(parts[1]);
        return TENANT_ID_PATTERN.test(candidate) && candidate.length >= 3 ? candidate : "";
    }

    function endpoint(suffix) {
        return `/api/public/appointments/${encodeURIComponent(state.tenantId)}${suffix}`;
    }

    function idempotencyKey() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return `appointment-${window.crypto.randomUUID()}`;
        }
        const bytes = new Uint8Array(24);
        window.crypto.getRandomValues(bytes);
        return `appointment-${Array.from(bytes, item => item.toString(16).padStart(2, "0")).join("")}`;
    }

    async function jsonRequest(path, options = {}) {
        const response = await fetch(path, options);
        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }
        if (!response.ok) {
            const error = new Error(body?.message || `İstek başarısız (${response.status}).`);
            error.status = response.status;
            throw error;
        }
        return body;
    }

    function option(value, label) {
        const item = document.createElement("option");
        item.value = value;
        item.textContent = label;
        return item;
    }

    function serviceById(id = state.serviceId) {
        return state.config?.services?.find(item => item.serviceId === id) || null;
    }

    function staffById(id = state.staffId) {
        return state.config?.staff?.find(item => item.staffId === id) || null;
    }

    function money(value) {
        if (value === null || value === undefined) return "";
        const amount = Number(value);
        if (!Number.isFinite(amount)) return "";
        return `${amount.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺`;
    }

    function formatSlot(iso) {
        return new Intl.DateTimeFormat("tr-TR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: state.config?.timezone || "Europe/Istanbul"
        }).format(new Date(iso));
    }

    function formatAppointmentDate(iso) {
        return new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "long",
            timeStyle: "short",
            timeZone: state.config?.timezone || "Europe/Istanbul"
        }).format(new Date(iso));
    }

    function updateSubmitState() {
        el.submit.disabled = state.busy || !state.selectedStartAt ||
            !state.serviceId || !state.staffId;
    }

    function renderSummary() {
        if (!state.selectedStartAt) {
            el.summary.classList.add("hidden");
            el.summary.replaceChildren();
            updateSubmitState();
            return;
        }
        const service = serviceById();
        const staff = staffById();
        el.summary.replaceChildren();
        const title = document.createElement("strong");
        title.textContent = `${service?.name || "Hizmet"} · ${staff?.name || "Personel"}`;
        const detail = document.createElement("div");
        detail.textContent = formatAppointmentDate(state.selectedStartAt);
        const price = money(service?.price);
        if (price) {
            const priceLine = document.createElement("div");
            priceLine.textContent = price;
            el.summary.append(title, detail, priceLine);
        } else {
            el.summary.append(title, detail);
        }
        el.summary.classList.remove("hidden");
        updateSubmitState();
    }

    function renderServices() {
        el.service.replaceChildren(option("", "Hizmet seçin"));
        for (const service of state.config?.services || []) {
            const price = money(service.price);
            const label = `${service.name} · ${service.durationMinutes} dk${price ? ` · ${price}` : ""}`;
            el.service.append(option(service.serviceId, label));
        }
    }

    function renderStaff() {
        state.staffId = "";
        el.staff.replaceChildren(option("", "Personel seçin"));
        const matching = (state.config?.staff || []).filter(item => item.serviceIds.includes(state.serviceId));
        for (const staff of matching) el.staff.append(option(staff.staffId, staff.name));
        el.staff.disabled = !state.serviceId || matching.length === 0;
        el.date.disabled = true;
        clearSlots("Personel seçin.");
    }

    function clearSlots(message) {
        state.slots = [];
        state.selectedStartAt = "";
        el.slotGrid.replaceChildren();
        el.slotMessage.textContent = message;
        renderSummary();
    }

    function renderSlots() {
        el.slotGrid.replaceChildren();
        if (!state.slots.length) {
            el.slotMessage.textContent = "Bu tarihte uygun saat bulunamadı.";
            renderSummary();
            return;
        }
        el.slotMessage.textContent = "Uygun saati seçin.";
        for (const slot of state.slots) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "slot-button";
            button.textContent = formatSlot(slot.startAt);
            if (slot.startAt === state.selectedStartAt) button.classList.add("selected");
            button.addEventListener("click", () => {
                state.selectedStartAt = slot.startAt;
                renderSlots();
                renderSummary();
            });
            el.slotGrid.append(button);
        }
    }

    async function loadSlots() {
        clearSlots("Uygun saatler yükleniyor...");
        if (!state.serviceId || !state.staffId || !el.date.value) {
            clearSlots("Hizmet, personel ve tarih seçin.");
            return;
        }
        const query = new URLSearchParams({
            serviceId: state.serviceId,
            staffId: state.staffId,
            date: el.date.value
        });
        try {
            const body = await jsonRequest(`${endpoint("/slots")}?${query.toString()}`);
            state.slots = Array.isArray(body?.slots) ? body.slots : [];
            renderSlots();
        } catch (error) {
            clearSlots(error.message);
        }
    }

    async function submitAppointment(event) {
        event.preventDefault();
        if (state.busy || !state.selectedStartAt) return;
        state.busy = true;
        el.formMessage.textContent = "Randevunuz kaydediliyor...";
        updateSubmitState();
        try {
            if (!state.idempotencyKey) state.idempotencyKey = idempotencyKey();
            const body = await jsonRequest(endpoint("/bookings"), {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Idempotency-Key": state.idempotencyKey
                },
                body: JSON.stringify({
                    customerName: el.customerName.value,
                    phone: el.customerPhone.value,
                    serviceId: state.serviceId,
                    staffId: state.staffId,
                    startAt: state.selectedStartAt,
                    note: el.note.value
                })
            });
            const appointment = body?.appointment;
            if (!appointment?.appointmentId || !appointment?.startAt) {
                throw new Error("Randevu yanıtı doğrulanamadı.");
            }
            el.formMessage.textContent = "";
            el.successDetail.textContent = `${appointment.service?.name || "Randevu"} · ${appointment.staff?.name || "Personel"} · ${formatAppointmentDate(appointment.startAt)}`;
            el.successModal.classList.remove("hidden");
            state.idempotencyKey = "";
        } catch (error) {
            el.formMessage.textContent = error.message;
            if (error.status === 409) {
                state.idempotencyKey = "";
                await loadSlots();
            }
        } finally {
            state.busy = false;
            updateSubmitState();
        }
    }

    async function bootstrap() {
        state.tenantId = readTenantId();
        if (!state.tenantId) {
            el.formMessage.textContent = "İşletme bağlantısı geçersiz.";
            return;
        }
        const storefrontPath = `/m/${encodeURIComponent(state.tenantId)}`;
        el.backLink.href = storefrontPath;
        el.successBack.href = storefrontPath;
        try {
            const body = await jsonRequest(endpoint("/config"));
            state.config = body?.config || null;
            if (!state.config || state.config.tenantId !== state.tenantId) {
                throw new Error("Randevu bilgileri doğrulanamadı.");
            }
            el.brandName.textContent = `${state.config.brandName || "İşletme"} · Randevu`;
            el.timezoneLabel.textContent = `Saat dilimi: ${state.config.timezone}`;
            renderServices();
        } catch (error) {
            el.formMessage.textContent = error.message;
            el.service.disabled = true;
        }
    }

    el.service.addEventListener("change", () => {
        state.serviceId = el.service.value;
        renderStaff();
    });
    el.staff.addEventListener("change", () => {
        state.staffId = el.staff.value;
        el.date.disabled = !state.staffId;
        clearSlots(state.staffId ? "Tarih seçin." : "Personel seçin.");
    });
    el.date.addEventListener("change", loadSlots);
    el.form.addEventListener("submit", submitAppointment);

    bootstrap();
})();