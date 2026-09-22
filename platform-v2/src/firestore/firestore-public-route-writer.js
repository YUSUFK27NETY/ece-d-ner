"use strict";

const { requireTenantId } = require("../tenant/tenant-id");
const { normalizeDomain } = require("../tenant/tenant-profile");
const { createAuditEvent } = require("../audit/audit-event");
const { tenantCollection, TENANT_COLLECTIONS } = require("./tenant-paths");
const {
    DEFAULT_PUBLIC_ROUTE_COLLECTION,
    normalizePublicRouteRecord
} = require("./firestore-public-route-reader");

function fail(label) {
    throw new TypeError(`Public route writer ${label} geçersiz.`);
}

function conflict() {
    const error = new Error("Domain başka bir tenant için aktif route olarak kayıtlı.");
    error.code = "PUBLIC_ROUTE_DOMAIN_CONFLICT";
    return error;
}

function requireCanonicalTenantId(value) {
    if (typeof value !== "string") fail("tenantId");
    const tenantId = requireTenantId(value);
    if (tenantId !== value) fail("tenantId");
    return tenantId;
}

function requireCanonicalDomain(value) {
    if (typeof value !== "string") fail("domain");
    let domain;
    try {
        domain = normalizeDomain(value);
    } catch {
        fail("domain");
    }
    if (!domain || domain !== value) fail("domain");
    return domain;
}

function requireTimestamp(value) {
    if (typeof value !== "string") fail("observedAt");
    const ms = Date.parse(value);
    if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) {
        fail("observedAt");
    }
    return value;
}

function requireAuditEvent(event, tenantId) {
    if (!event || typeof event !== "object" || Array.isArray(event) ||
        event.tenantId !== tenantId ||
        event.action !== "tenant.public_route.verified" ||
        typeof event.eventId !== "string") {
        fail("audit event");
    }
    return event;
}

function createFirestorePublicRouteWriter({
    db,
    collectionName = DEFAULT_PUBLIC_ROUTE_COLLECTION
} = {}) {
    if (!db || typeof db.collection !== "function" ||
        typeof db.doc !== "function" ||
        typeof db.runTransaction !== "function") {
        fail("db");
    }
    const safeCollectionName = String(collectionName ?? "").trim();
    if (!/^[A-Za-z0-9_-]{3,120}$/.test(safeCollectionName)) {
        fail("collection");
    }
    const collection = db.collection(safeCollectionName);

    return Object.freeze({
        async commitVerifiedRoute({
            tenantId: rawTenantId,
            domain: rawDomain,
            observedAt: rawObservedAt,
            auditEvent: rawAuditEvent
        } = {}) {
            const tenantId = requireCanonicalTenantId(rawTenantId);
            const domain = requireCanonicalDomain(rawDomain);
            const observedAt = requireTimestamp(rawObservedAt);
            const auditEvent = requireAuditEvent(rawAuditEvent, tenantId);
            const routeRef = collection.doc(domain);
            const auditRef = db.doc(
                `${tenantCollection(tenantId, TENANT_COLLECTIONS.audit)}/${auditEvent.eventId}`
            );

            const route = Object.freeze({
                schemaVersion: 1,
                domain,
                tenantId,
                state: "active",
                observedAt
            });

            return db.runTransaction(async transaction => {
                if (!transaction ||
                    typeof transaction.get !== "function" ||
                    typeof transaction.create !== "function" ||
                    typeof transaction.set !== "function") {
                    fail("transaction");
                }

                const snapshot = await transaction.get(routeRef);
                if (!snapshot || typeof snapshot.exists !== "boolean") {
                    fail("snapshot");
                }

                if (snapshot.exists) {
                    if (typeof snapshot.data !== "function" ||
                        snapshot.id !== domain) {
                        fail("snapshot");
                    }
                    const existing = normalizePublicRouteRecord({
                        domain,
                        data: snapshot.data()
                    });
                    if (existing.tenantId !== tenantId &&
                        existing.state === "active") {
                        throw conflict();
                    }
                    transaction.set(routeRef, { ...route });
                } else {
                    transaction.create(routeRef, { ...route });
                }

                transaction.create(auditRef, { ...auditEvent });
                return route;
            });
        }
    });
}

module.exports = {
    createFirestorePublicRouteWriter
};
