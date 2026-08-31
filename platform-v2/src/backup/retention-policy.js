const DEFAULT_RETENTION_DAYS = 7;

function normalizeRetentionDays(value = DEFAULT_RETENTION_DAYS) {
    const days = Number(value);

    if (!Number.isInteger(days) || days < 1 || days > 3650) {
        throw new TypeError("Retention günü 1-3650 arasında tam sayı olmalı.");
    }

    return days;
}

function getRetentionCutoff({ now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS } = {}) {
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
        throw new TypeError("Geçerli bir tarih gerekli.");
    }

    const days = normalizeRetentionDays(retentionDays);

    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function isExpiredBackup({ createdAt, now = new Date(), retentionDays = DEFAULT_RETENTION_DAYS }) {
    const created = createdAt instanceof Date ? createdAt : new Date(createdAt);

    if (Number.isNaN(created.getTime())) {
        throw new TypeError("Backup createdAt değeri geçersiz.");
    }

    return created < getRetentionCutoff({ now, retentionDays });
}

module.exports = {
    DEFAULT_RETENTION_DAYS,
    normalizeRetentionDays,
    getRetentionCutoff,
    isExpiredBackup
};
