const { incidentFields, incidentInteger } = require("../incidents/incident-contract");

const DEFAULT_PLATFORM_INCIDENTS_CONFIG = Object.freeze({
    maxOpenIncidents: 1000,
    maxEvidencePerIncident: 100,
    incidentRetentionDays: 90
});

function normalizePlatformIncidentsConfig(input = DEFAULT_PLATFORM_INCIDENTS_CONFIG) {
    incidentFields(input, Object.keys(DEFAULT_PLATFORM_INCIDENTS_CONFIG));
    return Object.freeze({
        maxOpenIncidents: incidentInteger(input.maxOpenIncidents, 1, 10_000),
        maxEvidencePerIncident: incidentInteger(input.maxEvidencePerIncident, 1, 1000),
        incidentRetentionDays: incidentInteger(input.incidentRetentionDays, 1, 3650)
    });
}

module.exports = { DEFAULT_PLATFORM_INCIDENTS_CONFIG, normalizePlatformIncidentsConfig };
