function normalizeOptionalString(value, label, maxLength) {
    if (value === undefined || value === null || value === "") {
        return null;
    }

    const normalized = String(value).trim();

    if (!normalized || normalized.length > maxLength) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return normalized;
}

function normalizeEmail(value) {
    const email = normalizeOptionalString(value, "E-posta", 254);

    if (!email) {
        return null;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new TypeError("E-posta geçersiz.");
    }

    return email.toLowerCase();
}

function normalizePhone(value, label = "Telefon") {
    const phone = normalizeOptionalString(value, label, 32);

    if (!phone) {
        return null;
    }

    if (!/^\+?[0-9 ()-]{7,32}$/.test(phone)) {
        throw new TypeError(`${label} geçersiz.`);
    }

    return phone;
}

function normalizeHttpsUrl(value, label) {
    const raw = normalizeOptionalString(value, label, 2048);

    if (!raw) {
        return null;
    }

    let parsed;

    try {
        parsed = new URL(raw);
    } catch {
        throw new TypeError(`${label} geçersiz URL.`);
    }

    if (parsed.protocol !== "https:") {
        throw new TypeError(`${label} HTTPS olmalı.`);
    }

    return parsed.toString();
}

function normalizeDomain(value) {
    const domain = normalizeOptionalString(value, "Domain", 253);

    if (!domain) {
        return null;
    }

    const normalized = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");

    if (
        normalized.includes("/") ||
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(normalized)
    ) {
        throw new TypeError("Domain geçersiz.");
    }

    return normalized;
}

function normalizeHexColor(value) {
    const color = normalizeOptionalString(value, "Ana renk", 7);

    if (!color) {
        return null;
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        throw new TypeError("Ana renk #RRGGBB formatında olmalı.");
    }

    return color.toUpperCase();
}

function normalizeTimezone(value) {
    const timezone = normalizeOptionalString(value, "Saat dilimi", 64) || "Europe/Istanbul";

    try {
        new Intl.DateTimeFormat("tr-TR", { timeZone: timezone }).format(new Date());
    } catch {
        throw new TypeError("Saat dilimi geçersiz.");
    }

    return timezone;
}

function createTenantProfile(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new TypeError("Tenant profil ayarları nesne olmalı.");
    }

    return Object.freeze({
        brandName: normalizeOptionalString(input.brandName, "Marka adı", 120),
        phone: normalizePhone(input.phone),
        whatsapp: normalizePhone(input.whatsapp, "WhatsApp"),
        email: normalizeEmail(input.email),
        website: normalizeHttpsUrl(input.website, "Web sitesi"),
        customDomain: normalizeDomain(input.customDomain),
        logoUrl: normalizeHttpsUrl(input.logoUrl, "Logo URL"),
        primaryColor: normalizeHexColor(input.primaryColor),
        address: normalizeOptionalString(input.address, "Adres", 500),
        timezone: normalizeTimezone(input.timezone)
    });
}

function mergeTenantProfile(current = {}, patch = {}) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        throw new TypeError("Tenant profil patch nesne olmalı.");
    }

    return createTenantProfile({
        ...current,
        ...patch
    });
}

module.exports = {
    createTenantProfile,
    mergeTenantProfile,
    normalizeDomain,
    normalizeHttpsUrl
};
