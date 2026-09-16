# Phase 13 — Presentation and Monthly Managed Service Contract

## Purpose

Business Platform V2 commercial packages are not sold as a one-time web page only. The recurring fee represents a managed digital system service. This document separates four concepts that must not be conflated:

1. `plan` — commercial package identity
2. `features` — functional modules actually enabled
3. `presentation` — storefront visual/presentation level
4. managed monthly service contract — operational responsibility included with the recurring service

Pricing is intentionally managed outside the source contract. Tenant-specific prices must not be hardcoded into the platform package model.

## Common managed service foundation

Every paid package must include the following base responsibilities:

- managed runtime / publication supervision
- security and maintenance updates
- backup management and restore readiness
- fixes for platform-originated defects
- preservation of supported mobile/browser compatibility

These obligations explain why the recurring payment is not merely a fee for keeping a static website online.

## Starter

Commercial promise: **Professional digital presence kept secure, current and operational.**

Customer-facing scope:

- system and publication infrastructure supervision
- security and maintenance updates
- backup management and restore readiness
- resolution of platform-originated defects
- supported device/browser compatibility maintenance
- basic product, service, price and content change support

Support posture:

- standard priority
- basic content change support
- standard support for enabled modules
- standard presentation maintenance
- reactive service review

Starter must remain a high-quality product. Lower price or simpler presentation must never mean intentionally poor design, weak security or unreliable operation.

## Business

Commercial promise: **Managed professional system that supports customer acquisition and day-to-day business workflows.**

Includes the Starter managed foundation plus:

- priority technical support
- support for enabled operational modules such as orders, appointments or reservations
- expanded product/service/campaign/content change support
- maintenance of customer conversion flows
- monthly system and service-health review

Business does not automatically mean any particular feature is enabled. Sector and feature configuration remain independent.

## Business Pro

Commercial promise: **Proactively managed premium digital brand experience with the highest support priority and controlled continuous improvement.**

Includes the Business managed foundation plus:

- highest support priority without implying an automatic response-time SLA
- premium brand/presentation maintenance
- advanced content and campaign change support
- proactive technical health and compatibility review
- limited minor presentation/experience improvements within the existing design system

Business Pro is not defined by feature count. A Pro tenant may use fewer functional modules than a Business tenant and still receive a more premium presentation and management level.

## Standard exclusions

The recurring managed service does **not** automatically include:

- development of entirely new features or modules
- full redesign or rebrand projects
- custom third-party integrations
- third-party subscription, domain, advertising or platform fees unless explicitly included in the commercial agreement
- professional photography, video or large-scale content production
- unlimited revisions, data entry or change requests
- 24/7 SLA or guaranteed response time unless separately contracted

These boundaries prevent the monthly service from becoming an unlimited custom-development agreement.

## Architecture rules

- `plan` must not select storefront presentation directly at runtime.
- managed monthly service contracts must not grant feature entitlements.
- managed monthly service contracts must not set `presentationTier`.
- presentation rules must not alter pricing.
- pricing must remain a separate commercial concern.
- sector determines business semantics, not package support level.
- enabled features determine what works.
- presentation determines how the storefront looks.
- branding determines whose identity is expressed.
- the managed service contract determines what recurring operational responsibility the provider assumes.

## Current Phase 13 implementation boundary

PR #81 introduces the presentation foundation and monthly service contract definitions without:

- changing tenant data
- changing ELA Döner
- wiring new presentation behavior into the live storefront
- changing public API payloads
- changing current production pricing
- merging or deploying automatically

Runtime integration remains a separate reviewed step after all CI and regression checks are green.
