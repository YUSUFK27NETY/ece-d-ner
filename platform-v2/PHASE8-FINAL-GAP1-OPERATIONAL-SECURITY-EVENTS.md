# Phase 8 Final Gap 1 — Operational Security Events

Bu değişiklik mevcut central security alert çekirdeğinin operasyonel event kapsamını tamamlar. Yeni provider, endpoint, mutation veya dependency eklemez.

## Runtime ve contract durumu

| Event | Durum | Repository'deki gerçek call-site |
| --- | --- | --- |
| `auth_anomaly` | `DURABLE_RUNTIME` | `require-platform-admin.js` her gerçek 401/403 denial'ı mevcut `AbuseMonitor`'a iletir. `server.js` içindeki gerçek Firestore central alert bridge'i, `abuse-monitor.js` tarafından yalnız tam repeated-auth threshold anında çağrılır. |
| `privilege_change` | `CONTRACT_ONLY` | `scripts/set-platform-admin-claim.js` gerçek claim grant scriptidir ancak central alert bridge dependency'si yoktur. Revoke/provision runtime call-site bulunmadı; script veya endpoint'e sahte wiring eklenmedi. |
| `destructive_operation_attempt` | `CONTRACT_ONLY` | Step-up policy içinde server-owned high-risk operasyon sınıfları vardır, fakat bunları çalıştıran gerçek enforcement/mutation call-site bulunmadı. Sahte route veya mutation wiring'i eklenmedi. |
| `tenant_boundary_violation` | `CONTRACT_ONLY` | Mevcut `TenantAccessGuard` ve bridge kontratı korunur. Guard için production `server.js`/HTTP call-site bulunmadığından runtime etkinliği iddia edilmez ve sahte wiring eklenmez. |

## Auth anomaly ve observation sınırı

Her gerçek Platform Admin auth denial'ı mevcut davranışla yalnız bir `repeated_401` veya `repeated_403` Phase 8 observation üretmeye devam eder. Abuse monitor tam Phase 6 threshold'a ulaştığında ayrıca tek kullanımlık, server-issued bir receipt üzerinden bir `auth_anomaly` üretir.

Phase 6 aggregate `count` değeri Phase 8 event'ine taşınmaz. Receipt yalnız server-generated request ID ve threshold clock zamanını taşır; kopyalanmış, JSON ile hydrate edilmiş veya caller tarafından oluşturulmuş receipt reddedilir. Central anomaly persistence hatası Phase 6 sinyal davranışını veya auth denial yanıtını değiştirmez ve yalnız generic hata metni loglanır.

## Server-owned operasyon kontratları

`privilege_change` yalnız şu exact operasyonları kabul eder:

- `platform_admin.claim.grant`
- `platform_admin.claim.revoke`
- `platform_admin.provision`

`destructive_operation_attempt` allowlist'i, mevcut `PLATFORM_ADMIN_OPERATION_RISKS` registry'sindeki `high` riskli operasyonlardan server tarafında türetilir; privilege operasyonları kendi event sınıfında kalır. Caller-provided `severity`, `riskLevel`, event type, source veya arbitrary operation fail-closed reddedilir.

Actor ve tenant yalnız bridge'in trusted context alanından alınır. Token, authorization/cookie, request body, secret, credential, key, raw auth/provider payload, e-posta, telefon veya IP event modeline kabul edilmez.

## Rollback

Runtime rollback yalnız `server.js` içindeki optional `securityOperations` → `AbuseMonitor` bağlantısını kaldırmayı gerektirir. Mevcut per-denial 401/403 central observation, Phase 6 signal, tenant-boundary ve step-up davranışları değişmeden kalır; durable kayıtlar silinmez.
