# Phase 8 Paket 4A — Incident Response Core

Issue #43. Provider-neutral, in-memory incident/evidence/action metadata temelidir.
Server bootstrap veya canlı endpointlere bağlanmaz. Paket 1/2/3 ve Phase 5/6/7
runtime akışları değişmez. Provider client, executor, gerçek revoke/rotate/disable,
tenant isolation işlemi, UI, break-glass veya retention job içermez.

## Güven sınırı ve scope

API'ler yalnız trusted backend kodu içindir. `context: { actorId, role, tenantId }`
doğrulanmış authentication/RBAC adapterından gelmelidir; client JSON'u context,
kanıt veya yetki beyanı olarak kullanılamaz. Yeni auth/enforcement açılmaz.

Her çağrıda target `tenantId` ve context `tenantId` birebir eşleşmelidir;
Platform Admin de bu kuraldan muaf değildir. Yazma yalnız `platform_admin`;
tenant okuma aynı scope'taki `platform_admin`, `tenant_owner`, `tenant_admin`
rollerine açıktır. Platform-wide kayıtlar için iki tarafta da açık `null` ve
Platform Admin gerekir. Eksik scope reddedilir. `"platform"`/`"unknown"` tenant
kimlikleri null scope ile birleştirilmez. Global listeleme/tenantlar arası merge yoktur.

Incident kimliği store tarafından UUID olarak oluşturulur. Actor/owner/evidence
referansları trusted adapterın ürettiği opaque ID'lerdir; email, telefon, URL,
credential, raw error veya insan açıklaması değildir. Kimlik format kontrolü,
bir referansın gerçekliğini veya provider'daki yetkisini kanıtlamaz.

## Model ve geçişler

Incident modeli severity/category/status, detectedAt/updatedAt, scope/actor,
correlationId/sourceAlertIds, owner/summaryCode ve türetilmiş containment/recovery
durumlarını taşır. Category ve summaryCode server-owned allowlist kullanır.

`detected → triaged → contained → recovery_in_progress → recovered → verified → closed`

- `detected → escalated → triaged`: escalation severity'yi critical yapar.
- `detected`, `escalated` veya `triaged` durumundan kanıtla `false_positive` terminaline geçilebilir.
- Contained/recovered/verified, sırasıyla bağlı containment/recovery/verification
  attestation pointer'ı gerektirir. False positive forensic reference gerektirir.
- Verified ve closed geçişlerinde tüm required action kayıtları completed olmalıdır.
- Closed ve false_positive tekrar açılamaz, yeni evidence/action kabul etmez.
- `transitionId` aynı actor/hedef/kanıt ile yeniden kullanıldığında eski immutable
  receipt döner; yeni durum geri alınmaz. Çelişkili retry reddedilir. Güncel durum
  için `getIncident()` kullanılır. Evidence/action retry'ları da aynı ilkeye uyar.

Attestation yalnız güvenilir çağıranın metadata beyanıdır. Çekirdek referans
okumaz, hash doğrulamaz, provider durumunu sorgulamaz veya aksiyon gerçekleştirmez.
Completed/contained/recovered etiketleri bağımsız production doğrulaması değildir.

## API ve alert entegrasyonu

`createInMemoryIncidentStore({ config, clock, maxRecords })` şu metodları sunar:

- `createIncident({ context, tenantId, metadata })`: category, severity, owner,
  correlationId; optional actorId/detectedAt/summaryCode. İlk durum server-owned detected.
- `createIncidentFromAlert({ context, tenantId, alert, owner })`: yalnız Paket 2
  model-issued alert nesnesi kabul eder; hydrated/clone/client severity reddedilir.
- `getIncident`, `listIncidents`, `transitionIncident`, `attachEvidence`,
  `addRequiredAction`, `listAudit`: her biri explicit scope kontrolü yapar.

Critical alert'ler, high tenant-boundary/destructive-attempt alert'leri ve confirmed
admin takeover candidate üretir; takeover critical/admin_takeover olur. Diğer
alert'ler null candidate döndürür. Paket 2 modelinde diğer critical event türleri
henüz bulunmadığından genel critical fallback category'si auth_anomaly'dir.

Dedupe anahtarları `(tenantId, alertId)` ve `(tenantId, correlationId)` şeklindedir.
Aynı alert yeniden audit/incident üretmez; aynı correlation'daki yeni alert kaynak
ID'si eklenir. Severity düşürülmez; takeover category'si önceliklidir. Farklı subject
actor'lar birleşirse tek kişiye yanlış atıf yapılmaz, actorId null olur. Owner ilk
kayıttan korunur. Closed/false-positive incident'in aynı alert retry'ı mevcut kaydı
döndürür; yeni kaynak alert aynı correlation'a gelirse terminal hatası verir,
sessiz reopen veya ikinci incident oluşturmaz.

## Evidence, action ve audit

Evidence sadece ID/type/time, request/correlation UUID, alert/audit ID, tenant/actor,
allowlisted operation/reason ve opaque referenceId/SHA-256 taşır. Tenant/correlation
incident ile eşleşir; alertId incident'in sourceAlertIds listesinde bulunmalıdır.
Bilinmeyen alanlar, nested payload, getter, symbol ve uygunsuz PII biçimleri
değerleri serileştirilmeden reddedilir. Pointer içerikleri hiçbir zaman okunmaz.

Dokuz action türü allowlisted'dir. `addRequiredAction` yalnız
`required → planned → completed` metadata sırasını kaydeder; completed bağlı
evidenceId gerektirir. Serbest executor/callback/provider payload kabul edilmez.

Audit sadece incidentId, oldStatus/newStatus, writer actorId, tenantId,
server-owned reasonCode/actionType ve timestamp içerir. `buildIncidentAuditMetadata`
yalnız model-issued audit kabul eder. In-memory audit mutation ile birlikte
senkron kaydedilir; mevcut tenant audit writer'a sahte platform tenantı yazılmaz.

## Config ve sınırlar

Merkezi guardrails config altında `security.incidents`:

- `maxOpenIncidents: 1000`: explicit scope başına; 1–10000.
- `maxEvidencePerIncident: 100`: evidence ve source-alert pointer'larının ortak bütçesi; 1–1000.
- `incidentRetentionDays: 90`: terminal timestamp'ten hesaplanan retentionEligibleAt
  metadata'sı; 1–3650. Otomatik purge yoktur.

Eski config default alır; sayı coercion'ı, invalid/unknown alanlar fail-closed olur.
Store toplam kayıt sınırı ayrıca `maxRecords` (default 10000); dolunca eviction
yapmadan reddeder. Tüm kayıtlar, dedupe ve retry bilgisi yalnız process belleğindedir.
Durable/distributed adapter veya production incident servisi yerine geçmez.

## Doğrulama

`node --test platform-v2/tests/phase8-incident-model.test.js platform-v2/tests/phase8-incident-store.test.js`

Ardından `npm.cmd run ci`, `npm.cmd run security:dependencies`, `npm.cmd audit --json`
ve staged diff kontrolü uygulanır. Testler yalnız yerel fake/in-memory veri kullanır.
