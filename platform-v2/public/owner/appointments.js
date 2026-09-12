(() => {
    "use strict";

    const TENANT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
    const STATUS_LABELS = Object.freeze({
        pending: "Bekliyor",
        confirmed: "Onaylı",
        completed: "Tamamlandı",
        cancelled: "İptal"
    });
    const STATUS_TRANSITIONS = Object.freeze({
        pending: Object.freeze(["confirmed", "cancelled"]),
        confirmed: Object.freeze(["completed", "cancelled"]),
        completed: Object.freeze([]),
        cancelled: Object.freeze([])
    });
    const DAYS = Object.freeze([
        ["1", "Pazartesi"], ["2", "Salı"], ["3", "Çarşamba"],
        ["4", "Perşembe"], ["5", "Cuma"], ["6", "Cumartesi"], ["0", "Pazar"]
    ]);

    const el = Object.freeze({
        tenantLabel: document.getElementById("tenant-label"),
        backLink: document.getElementById("back-link"),
        loginLink: document.getElementById("login-link"),
        refresh: document.getElementById("refresh-button"),
        authRequired: document.getElementById("auth-required"),
        app: document.getElementById("appointments-app"),
        pageMessage: document.getElementById("page-message"),
        statServices: document.getElementById("stat-services"),
        statStaff: document.getElementById("stat-staff"),
        statPending: document.getElementById("stat-pending"),
        statConfirmed: document.getElementById("stat-confirmed"),
        serviceList: document.getElementById("service-list"),
        staffList: document.getElementById("staff-list"),
        bookingList: document.getElementById("booking-list"),
        bookingFilter: document.getElementById("booking-filter"),
        newService: document.getElementById("new-service"),
        serviceModal: document.getElementById("service-modal"),
        serviceForm: document.getElementById("service-form"),
        serviceTitle: document.getElementById("service-modal-title"),
        serviceClose: document.getElementById("service-close"),
        serviceId: document.getElementById("service-id"),
        serviceName: document.getElementById("service-name"),
        serviceDuration: document.getElementById("service-duration"),
        servicePrice: document.getElementById("service-price"),
        serviceActive: document.getElementById("service-active"),
        serviceFormMessage: document.getElementById("service-form-message"),
        newStaff: document.getElementById("new-staff"),
        staffModal: document.getElementById("staff-modal"),
        staffForm: document.getElementById("staff-form"),
        staffTitle: document.getElementById("staff-modal-title"),
        staffClose: document.getElementById("staff-close"),
        staffId: document.getElementById("staff-id"),
        staffName: document.getElementById("staff-name"),
        staffActive: document.getElementById("staff-active"),
        staffServiceOptions: document.getElementById("staff-service-options"),
        staffFormMessage: document.getElementById("staff-form-message"),
        availabilityModal: document.getElementById("availability-modal"),
        availabilityForm: document.getElementById("availability-form"),
        availabilityTitle: document.getElementById("availability-title"),
        availabilityClose: document.getElementById("availability-close"),
        availabilityDays: document.getElementById("availability-days"),
        availabilityMessage: document.getElementById("availability-message"),
        toast: document.getElementById("toast")
    });

    if (Object.values(el).some(value => value === null) || typeof firebase === "undefined" || !firebase.auth) return;

    const bootstrap = window.OWNER_BOOTSTRAP || {};
    const state = {
        tenantId: "",
        tenant: null,
        services: [],
        staff: [],
        bookings: [],
        availabilityStaffId: "",
        busy: false
    };

    function normalizeTenantId(value) {
        const tenantId = String(value ?? "").trim().toLowerCase();
        return tenantId.length >= 3 && TENANT_ID_PATTERN.test(tenantId) ? tenantId : "";
    }

    function initialTenantId() {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = normalizeTenantId(params.get("tenant"));
        if (fromUrl) return fromUrl;
        try {
            return normalizeTenantId(window.sessionStorage.getItem("platformOwnerTenantId"));
        } catch {
            return "";
        }
    }

    function ownerPath(suffix) {
        return `/api/tenant/tenants/${encodeURIComponent(state.tenantId)}/owner${suffix}`;
    }

    async function token() {
        const user = firebase.auth().currentUser;
        if (!user) throw new Error("Oturum bulunamadı.");
        return user.getIdToken();
    }

    async function jsonRequest(path, options = {}) {
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${await token()}`);
        if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
        const response = await fetch(path, { ...options, headers });
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

    function setMessage(text = "", type = "") {
        el.pageMessage.textContent = text;
        el.pageMessage.className = "message";
        if (type) el.pageMessage.classList.add(type);
    }

    function showToast(text) {
        el.toast.textContent = text;
        el.toast.classList.add("show");
        window.setTimeout(() => el.toast.classList.remove("show"), 2200);
    }

    function money(value) {
        if (value === null || value === undefined) return "Fiyat belirtilmedi";
        const amount = Number(value);
        return Number.isFinite(amount)
            ? `${amount.toLocaleString("tr-TR", { maximumFractionDigits: 2 })} ₺`
            : "—";
    }

    function formatDate(value) {
        const timestamp = Date.parse(String(value || ""));
        if (Number.isNaN(timestamp)) return "—";
        return new Intl.DateTimeFormat("tr-TR", {
            dateStyle: "short",
            timeStyle: "short",
            timeZone: state.tenant?.profile?.timezone || "Europe/Istanbul"
        }).format(new Date(timestamp));
    }

    function button(label, className = "secondary") {
        const item = document.createElement("button");
        item.type = "button";
        item.className = className;
        item.textContent = label;
        return item;
    }

    function empty(text) {
        const item = document.createElement("div");
        item.className = "empty-state";
        item.textContent = text;
        return item;
    }

    function setStats() {
        el.statServices.textContent = String(state.services.filter(item => item.active).length);
        el.statStaff.textContent = String(state.staff.filter(item => item.active).length);
        el.statPending.textContent = String(state.bookings.filter(item => item.status === "pending").length);
        el.statConfirmed.textContent = String(state.bookings.filter(item => item.status === "confirmed").length);
    }

    function openService(service = null) {
        el.serviceForm.reset();
        el.serviceId.value = service?.serviceId || "";
        el.serviceName.value = service?.name || "";
        el.serviceDuration.value = String(service?.durationMinutes || 30);
        el.servicePrice.value = service?.price === null || service?.price === undefined ? "" : String(service.price);
        el.serviceActive.checked = service ? service.active === true : true;
        el.serviceTitle.textContent = service ? "Hizmeti düzenle" : "Yeni hizmet";
        el.serviceFormMessage.textContent = "";
        el.serviceModal.classList.remove("hidden");
    }

    function closeService() {
        el.serviceModal.classList.add("hidden");
    }

    function renderServices() {
        el.serviceList.replaceChildren();
        if (!state.services.length) {
            el.serviceList.append(empty("Henüz randevu hizmeti eklenmedi."));
            return;
        }
        for (const service of state.services) {
            const card = document.createElement("article");
            card.className = "appointment-record";
            const head = document.createElement("div");
            head.className = "appointment-record-head";
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = service.name;
            const meta = document.createElement("div");
            meta.className = "appointment-meta";
            meta.textContent = `${service.durationMinutes} dk · ${money(service.price)} · ${service.active ? "Aktif" : "Pasif"}`;
            copy.append(title, meta);
            const price = document.createElement("span");
            price.className = "appointment-price";
            price.textContent = service.price === null ? "—" : money(service.price);
            head.append(copy, price);
            const actions = document.createElement("div");
            actions.className = "appointment-actions";
            const edit = button("Düzenle");
            edit.addEventListener("click", () => openService(service));
            actions.append(edit);
            card.append(head, actions);
            el.serviceList.append(card);
        }
    }

    function renderStaffServiceOptions(selected = []) {
        el.staffServiceOptions.replaceChildren();
        const activeServices = state.services.filter(service => service.active || selected.includes(service.serviceId));
        if (!activeServices.length) {
            el.staffServiceOptions.append(empty("Önce en az bir hizmet ekleyin."));
            return;
        }
        for (const service of activeServices) {
            const label = document.createElement("label");
            label.className = "check-option";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = service.serviceId;
            input.checked = selected.includes(service.serviceId);
            const text = document.createElement("span");
            text.textContent = service.name;
            label.append(input, text);
            el.staffServiceOptions.append(label);
        }
    }

    function openStaff(staff = null) {
        el.staffForm.reset();
        el.staffId.value = staff?.staffId || "";
        el.staffName.value = staff?.name || "";
        el.staffActive.checked = staff ? staff.active === true : true;
        el.staffTitle.textContent = staff ? "Personeli düzenle" : "Yeni personel";
        el.staffFormMessage.textContent = "";
        renderStaffServiceOptions(staff?.serviceIds || []);
        el.staffModal.classList.remove("hidden");
    }

    function closeStaff() {
        el.staffModal.classList.add("hidden");
    }

    function serviceNames(ids) {
        return ids.map(id => state.services.find(service => service.serviceId === id)?.name || "Bilinmeyen hizmet").join(", ");
    }

    function renderStaff() {
        el.staffList.replaceChildren();
        if (!state.staff.length) {
            el.staffList.append(empty("Henüz personel eklenmedi."));
            return;
        }
        for (const staff of state.staff) {
            const card = document.createElement("article");
            card.className = "appointment-record";
            const head = document.createElement("div");
            head.className = "appointment-record-head";
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = staff.name;
            const meta = document.createElement("div");
            meta.className = "appointment-meta";
            meta.textContent = `${staff.active ? "Aktif" : "Pasif"} · ${serviceNames(staff.serviceIds)}`;
            copy.append(title, meta);
            head.append(copy);
            const actions = document.createElement("div");
            actions.className = "appointment-actions";
            const edit = button("Düzenle");
            edit.addEventListener("click", () => openStaff(staff));
            const availability = button("Çalışma saatleri", "primary compact");
            availability.addEventListener("click", () => openAvailability(staff));
            actions.append(edit, availability);
            card.append(head, actions);
            el.staffList.append(card);
        }
    }

    function statusSelect(booking) {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Randevu durumu");
        const current = document.createElement("option");
        current.value = booking.status;
        current.textContent = STATUS_LABELS[booking.status] || booking.status;
        select.append(current);
        for (const status of STATUS_TRANSITIONS[booking.status] || []) {
            const option = document.createElement("option");
            option.value = status;
            option.textContent = STATUS_LABELS[status] || status;
            select.append(option);
        }
        select.disabled = (STATUS_TRANSITIONS[booking.status] || []).length === 0 || state.busy;
        select.addEventListener("change", async () => {
            if (select.value === booking.status) return;
            await updateBookingStatus(booking, select.value);
        });
        return select;
    }

    function renderBookings() {
        el.bookingList.replaceChildren();
        const filter = el.bookingFilter.value;
        const list = state.bookings
            .filter(item => filter === "all" || item.status === filter)
            .sort((a, b) => Date.parse(b.startAt) - Date.parse(a.startAt));
        if (!list.length) {
            el.bookingList.append(empty("Bu filtrede randevu bulunmuyor."));
            return;
        }
        for (const booking of list) {
            const card = document.createElement("article");
            card.className = "appointment-record";
            const head = document.createElement("div");
            head.className = "appointment-record-head";
            const copy = document.createElement("div");
            const title = document.createElement("h3");
            title.textContent = `${booking.customer?.name || "Müşteri"} · ${booking.service?.name || "Hizmet"}`;
            const meta = document.createElement("div");
            meta.className = "appointment-meta";
            meta.textContent = `${formatDate(booking.startAt)} · ${booking.staff?.name || "Personel"} · ${booking.customer?.phone || "Telefon yok"}`;
            copy.append(title, meta);
            const pill = document.createElement("span");
            pill.className = "status-pill";
            pill.textContent = STATUS_LABELS[booking.status] || booking.status;
            head.append(copy, pill);
            const detail = document.createElement("div");
            detail.className = "appointment-meta";
            detail.textContent = booking.note ? `Not: ${booking.note}` : "Not yok";
            const actions = document.createElement("div");
            actions.className = "appointment-actions";
            actions.append(statusSelect(booking));
            card.append(head, detail, actions);
            el.bookingList.append(card);
        }
    }

    function renderAll() {
        setStats();
        renderServices();
        renderStaff();
        renderBookings();
    }

    async function loadAll() {
        if (!state.tenantId) {
            setMessage("Geçerli işletme kodu bulunamadı.", "error");
            return;
        }
        setMessage("Randevu verileri yükleniyor...");
        try {
            const overview = await jsonRequest(ownerPath("/overview"));
            const tenant = overview?.tenant;
            if (!tenant || tenant.tenantId !== state.tenantId) throw new Error("İşletme doğrulanamadı.");
            state.tenant = tenant;
            el.tenantLabel.textContent = tenant.profile?.brandName || tenant.displayName || tenant.tenantId;
            if (tenant.features?.appointments !== true) {
                state.services = [];
                state.staff = [];
                state.bookings = [];
                renderAll();
                el.app.classList.remove("hidden");
                setMessage("Bu işletmede randevu modülü aktif değil.", "error");
                return;
            }
            const [servicesBody, staffBody, bookingBody] = await Promise.all([
                jsonRequest(ownerPath("/appointments/services")),
                jsonRequest(ownerPath("/appointments/staff")),
                jsonRequest(ownerPath("/appointments/bookings?limit=200"))
            ]);
            state.services = Array.isArray(servicesBody?.services) ? servicesBody.services : [];
            state.staff = Array.isArray(staffBody?.staff) ? staffBody.staff : [];
            state.bookings = Array.isArray(bookingBody?.appointments) ? bookingBody.appointments : [];
            el.app.classList.remove("hidden");
            setMessage();
            renderAll();
        } catch (error) {
            setMessage(error.message, "error");
        }
    }

    async function saveService(event) {
        event.preventDefault();
        if (state.busy) return;
        state.busy = true;
        el.serviceFormMessage.textContent = "Kaydediliyor...";
        try {
            const id = el.serviceId.value;
            const rawPrice = el.servicePrice.value.trim();
            const payload = {
                name: el.serviceName.value,
                durationMinutes: Number(el.serviceDuration.value),
                price: rawPrice === "" ? null : Number(rawPrice),
                active: el.serviceActive.checked
            };
            await jsonRequest(ownerPath(id ? `/appointments/services/${encodeURIComponent(id)}` : "/appointments/services"), {
                method: id ? "PATCH" : "POST",
                body: JSON.stringify(payload)
            });
            closeService();
            showToast(id ? "Hizmet güncellendi." : "Hizmet eklendi.");
            await loadAll();
        } catch (error) {
            el.serviceFormMessage.textContent = error.message;
        } finally {
            state.busy = false;
        }
    }

    async function saveStaff(event) {
        event.preventDefault();
        if (state.busy) return;
        const serviceIds = [...el.staffServiceOptions.querySelectorAll('input[type="checkbox"]:checked')]
            .map(input => input.value);
        if (!serviceIds.length) {
            el.staffFormMessage.textContent = "En az bir hizmet seçin.";
            return;
        }
        state.busy = true;
        el.staffFormMessage.textContent = "Kaydediliyor...";
        try {
            const id = el.staffId.value;
            await jsonRequest(ownerPath(id ? `/appointments/staff/${encodeURIComponent(id)}` : "/appointments/staff"), {
                method: id ? "PATCH" : "POST",
                body: JSON.stringify({
                    name: el.staffName.value,
                    serviceIds,
                    active: el.staffActive.checked
                })
            });
            closeStaff();
            showToast(id ? "Personel güncellendi." : "Personel eklendi.");
            await loadAll();
        } catch (error) {
            el.staffFormMessage.textContent = error.message;
        } finally {
            state.busy = false;
        }
    }

    function availabilityRow(dayKey, label, windows) {
        const row = document.createElement("div");
        row.className = "availability-row";
        row.dataset.day = dayKey;
        const day = document.createElement("label");
        day.className = "availability-day";
        const enabled = document.createElement("input");
        enabled.type = "checkbox";
        enabled.checked = windows.length > 0;
        const text = document.createElement("span");
        text.textContent = label;
        day.append(enabled, text);
        const start = document.createElement("input");
        start.type = "time";
        start.step = "900";
        start.value = windows[0]?.start || "09:00";
        const end = document.createElement("input");
        end.type = "time";
        end.step = "900";
        end.value = windows[0]?.end || "18:00";
        start.disabled = !enabled.checked;
        end.disabled = !enabled.checked;
        enabled.addEventListener("change", () => {
            start.disabled = !enabled.checked;
            end.disabled = !enabled.checked;
        });
        row.append(day, start, end);
        return row;
    }

    async function openAvailability(staff) {
        state.availabilityStaffId = staff.staffId;
        el.availabilityTitle.textContent = `${staff.name} · Müsaitlik`;
        el.availabilityMessage.textContent = "Yükleniyor...";
        el.availabilityDays.replaceChildren();
        el.availabilityModal.classList.remove("hidden");
        try {
            const body = await jsonRequest(ownerPath(`/appointments/staff/${encodeURIComponent(staff.staffId)}/availability`));
            const weekly = body?.availability?.weekly || {};
            for (const [dayKey, label] of DAYS) {
                el.availabilityDays.append(availabilityRow(dayKey, label, Array.isArray(weekly[dayKey]) ? weekly[dayKey] : []));
            }
            el.availabilityMessage.textContent = "";
        } catch (error) {
            el.availabilityMessage.textContent = error.message;
        }
    }

    function closeAvailability() {
        state.availabilityStaffId = "";
        el.availabilityModal.classList.add("hidden");
    }

    async function saveAvailability(event) {
        event.preventDefault();
        if (state.busy || !state.availabilityStaffId) return;
        const weekly = { "0": [], "1": [], "2": [], "3": [], "4": [], "5": [], "6": [] };
        for (const row of el.availabilityDays.querySelectorAll(".availability-row")) {
            const day = row.dataset.day;
            const inputs = row.querySelectorAll("input");
            const enabled = inputs[0];
            const start = inputs[1];
            const end = inputs[2];
            if (enabled.checked) weekly[day] = [{ start: start.value, end: end.value }];
        }
        state.busy = true;
        el.availabilityMessage.textContent = "Kaydediliyor...";
        try {
            await jsonRequest(ownerPath(`/appointments/staff/${encodeURIComponent(state.availabilityStaffId)}/availability`), {
                method: "PATCH",
                body: JSON.stringify({ weekly })
            });
            closeAvailability();
            showToast("Çalışma saatleri güncellendi.");
        } catch (error) {
            el.availabilityMessage.textContent = error.message;
        } finally {
            state.busy = false;
        }
    }

    async function updateBookingStatus(booking, status) {
        if (state.busy) return;
        state.busy = true;
        renderBookings();
        try {
            await jsonRequest(ownerPath(`/appointments/bookings/${encodeURIComponent(booking.appointmentId)}/status`), {
                method: "PATCH",
                body: JSON.stringify({ status })
            });
            showToast("Randevu durumu güncellendi.");
            await loadAll();
        } catch (error) {
            setMessage(error.message, "error");
        } finally {
            state.busy = false;
            renderBookings();
        }
    }

    state.tenantId = initialTenantId();
    const tenantQuery = state.tenantId ? `?tenant=${encodeURIComponent(state.tenantId)}` : "";
    el.backLink.href = `/owner/${tenantQuery}`;
    el.loginLink.href = `/owner/${tenantQuery}`;

    const firebaseConfig = bootstrap.firebase;
    if (!firebaseConfig || typeof firebaseConfig !== "object") {
        setMessage("Firebase bağlantısı yapılandırılmamış.", "error");
        return;
    }

    el.newService.addEventListener("click", () => openService());
    el.serviceClose.addEventListener("click", closeService);
    el.serviceForm.addEventListener("submit", saveService);
    el.newStaff.addEventListener("click", () => openStaff());
    el.staffClose.addEventListener("click", closeStaff);
    el.staffForm.addEventListener("submit", saveStaff);
    el.availabilityClose.addEventListener("click", closeAvailability);
    el.availabilityForm.addEventListener("submit", saveAvailability);
    el.bookingFilter.addEventListener("change", renderBookings);
    el.refresh.addEventListener("click", loadAll);

    firebase.initializeApp(firebaseConfig);
    firebase.auth().onAuthStateChanged(async user => {
        if (!user) {
            el.authRequired.classList.remove("hidden");
            el.app.classList.add("hidden");
            return;
        }
        el.authRequired.classList.add("hidden");
        await loadAll();
    });
})();