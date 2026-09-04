# Platform V2 Phase 6 — Security, Usage Telemetry & FinOps Guardrails

Bu faz, Issue #37 kapsamını ve Security, Scalability, FinOps & Operational Risk Master Checklist #36 içindeki uygulama-seviyesi guardrail maddelerini karşılar. Phase 5 tenant izolasyonu, backup doğrulaması, migration güvenliği ve readiness sözleşmesi korunur. Ece Döner V1 runtime ve veri yolları değişmez.

## Güvenlik sınırı

- Telemetry, maliyet ve security signal okumaları önce doğrulanmış tenant context + permission kontrolünden geçer.
- Platform Admin HTTP görünürlüğü yalnız Firebase tokenında `platformAdmin: true` bulunan aktöre açıktır.
- Tenant kullanıcısı yalnız kendi tenant verisini okuyabilir; başka tenantId fail-closed reddedilir.
- Request body, Authorization tokenı, secret, service-account içeriği ve serbest PII telemetry veya signal şemasına alınmaz.
- Security signal metadata'sı sabit bir allowlist ile sınırlıdır. Serbest payload kabul edilmez.
- Yeni admin tenant limiter'ı mevcut global Platform Admin limiter'ının yerini almaz; ondan sonra ikinci bir katman olarak çalışır.

## Tenant usage telemetry

Provider-neutral `UsageTelemetryService`, storage adapterının önünde çalışır. Runtime Firestore adapterını kullanır; test ve local prototip için aynı interface arkasında in-memory adapter vardır.

Firestore aggregate pathleri:

```text
tenants/{tenantId}/telemetry/daily_YYYY-MM-DD
tenants/{tenantId}/telemetry/monthly_YYYY-MM
```

Her aggregate şunları taşır:

- request ve error sayısı
- toplam/maksimum/ortalama latency
- operation ve operationClass sayaçları
- uygulama seviyesinde ölçülebilen Firestore read/write sayaçları
- Render compute, R2 storage/bandwidth ve backup storage için provider-neutral usage birimleri
- son hata zamanı, operation ve HTTP status
- backup boyutu, obje sayısı, son verify ve restore-drill metadata'sı

Firestore adapterı mevcut aggregate içindeki tenantId ve dönem ile hedef pathi tekrar karşılaştırır. Uyuşmazlıkta transaction hiçbir yazma yapmadan kapanır. Günlük ve aylık sözleşme provider API'sine bağlı değildir.

Telemetry retention defaultu 400 gündür. Firestore TTL/lifecycle uygulaması provider-side operasyondur ve production üzerinde ayrıca onaylanmalıdır; bu branch production ayarı değiştirmez.

## Plan, entitlement ve soft quota

Backend `EntitlementService` şu sırayla değerlendirir:

1. aktörün tenant permission'ı,
2. tenant feature flag'i,
3. planın izin verdiği feature listesi,
4. aylık soft usage limiti.

Feature erişimi UI görünürlüğünden bağımsız olarak backend'de reddedilir. Soft quota ise operasyonel bir sinyaldir:

- warning threshold veya üstü: `warning`
- limitin %100'ü veya üstü: `over_limit` + satış/operasyon review sinyali
- tenant otomatik disable edilmez ve feature otomatik kapatılmaz

Eski tenant kaydında plan policy bulunmuyorsa `default` policy kullanılır. Eksik feature map'i mevcut katalog defaultlarıyla tamamlanır. Default policy backward-compatible olarak unlimited soft limit ve katalog defaultlarını korur.

## Noisy-neighbor ve abuse guardrails

Rate-limit anahtarı `policyScope + tenantId` biçimindedir; bir tenantın sayacı diğerini etkilemez. Public ve admin tenant policyleri ayrı config taşır. Her policy burst ve sustained pencere tanımlar.

İşlem sırası:

```text
Platform global limiter
  -> Platform Admin auth
  -> tenant-scoped telemetry
  -> tenant-scoped admin limiter
  -> handler
```

Bu sayede tenant policy global güvenlik limitini gevşetemez. Geçersiz tenant binding 400 ile fail-closed olur. Limit aşımı müşterinin hesabını/statusunu değiştirmez; yalnız ilgili request 429 alır ve güvenli security signal üretilebilir.

`AbuseMonitor` tekrarlanan 401/403 olaylarını zaman penceresinde sayar. Ham token, IP, body veya kullanıcı verisi tutulmaz. `TenantAccessGuard`, doğrulanmış kaynak tenant altında tenant-boundary violation signalı üretir; saldırganın URL'ye yazdığı başka tenant kimliği altında signal üretmez.

## Security signal kontratı

Desteklenen tipler:

- `repeated_unauthorized`
- `forbidden`
- `tenant_boundary_violation`
- `quota_warning`
- `cost_anomaly`
- `upper_plan_review`
- `rate_limit_exceeded`

Her kayıt `requestId`, doğrulanmışsa `tenantId`, `operation`, severity, count ve sınırlı metadata taşır. Tenant signal pathi `tenants/{tenantId}/securitySignals/{signalId}` altındadır. Tenant bağlanamayan Platform Admin auth sinyalleri ayrı `platformSecuritySignals` collectionında kalır ve tenant özetine karışmaz.

Yeni Phase 6 endpointleri salt okunurdur. Mevcut tenant create/update mutationları Phase 5 audit modelini kullanmaya devam eder ve `tenant.created` / `tenant.updated` eventlerinde actor, request ve tenant korelasyonunu korur.

## FinOps modeli

`CostProvider` interface'i rate-card ve shared monthly cost sağlar. İlk adapter yalnız doğrulanmış config okur; gerçek Firebase, Render veya R2 billing credentialı istemez. İleride provider billing adapterı aynı interface'i uygulayabilir.

Attributable maliyet bileşenleri:

- request hacmi
- Firestore read/write
- Render compute süresi
- R2 storage byte-hour ve bandwidth
- backup storage byte-hour

Shared compute/diğer maliyet, aylık request payına göre tenantlara deterministik dağıtılır. Tüm tenantların request sayısı sıfırsa eşit dağıtılır. Tenant yoksa maliyet açıkça `sharedUnattributedCost` olarak kalır.

Tenant görünümü şunları hesaplar:

- tahmini aylık teknik maliyet
- konfigüre edilmiş aylık gelir referansı
- tahmini contribution margin
- infra/revenue ratio
- `normal`, `warning`, `critical` veya `unknown` status

Default planlama referansı 2000 TRY/tenant/aydır; fiyat veya faturalama kuralı değildir. Gerçek müşteri fiyatını değiştirmez. Default oranlar `<= %10 normal`, `%10-%15 warning`, `> %15 critical` şeklindedir ve tamamı config ile değiştirilebilir. Default provider rate-card değerleri sıfırdır; doğrulanmış maliyet verisi girilmeden sahte maliyet üretmez.

Ay bazlı anomaly, mevcut tahmini maliyeti önceki ay baseline'ıyla karşılaştırır. Hem multiplier hem minimum artış kapısı geçilmeden signal oluşmaz. Top-N listesi maliyete göre azalan, eşitlikte tenantId'ye göre deterministik sıralanır.

## Merkezi config

Tek giriş noktası:

```text
PLATFORM_GUARDRAILS_CONFIG_JSON
```

Secret olmayan örnek:

```json
{
  "rateLimits": {
    "public": { "sustainedWindowMs": 60000, "sustainedMax": 120, "burstWindowMs": 10000, "burstMax": 30 },
    "adminTenant": { "sustainedWindowMs": 900000, "sustainedMax": 180, "burstWindowMs": 60000, "burstMax": 60 }
  },
  "security": { "authFailureWindowMs": 300000, "authFailureThreshold": 5, "signalListLimit": 20 },
  "plans": {
    "starter": { "allowedFeatures": ["catalog", "orders"], "softRequestLimit": 100000, "warningThreshold": 0.8, "dedicatedReviewThreshold": 1, "monthlyRevenueReference": 2000 }
  },
  "tenantOverrides": {
    "ornek-tenant": { "softRequestLimit": 150000, "monthlyRevenueReference": 2500 }
  },
  "finops": {
    "currency": "TRY",
    "defaultMonthlyRevenue": 2000,
    "thresholds": { "warningRatio": 0.1, "criticalRatio": 0.15 },
    "anomaly": { "multiplier": 2, "minimumIncrease": 100 },
    "rates": { "requestPer100000": 0, "firestoreReadPer100000": 0, "firestoreWritePer100000": 0, "renderComputeHour": 0, "r2StorageGbMonth": 0, "r2BandwidthGb": 0, "backupStorageGbMonth": 0 },
    "sharedMonthlyCosts": { "renderCompute": 0, "other": 0 }
  }
}
```

Config parse, alan allowlist'i, tip, aralık ve threshold sırası merkezi doğrulanır. Geçersiz config server startup'ını durdurur; raw config veya değer hata mesajına eklenmez. Bu fail-open davranışı engeller.

## Platform Admin görünürlüğü

Yeni salt-okunur endpointler:

```text
GET /api/platform/tenants/:tenantId/operations
GET /api/platform/finops/top-tenants?limit=10
```

Tenant operations response'u health/readiness scope, latency, usage, cost, entitlement, backup/DR ve security özetlerini döndürür. Admin paneli seçilen tenant için bu endpointi çağırır ve mevcut create/update formunu bozmadan altı sade kart gösterir. Response request body, token, secret veya provider credential içermez.

Backup/DR kartı Phase 5'in kalıcı kanıtını doğrudan kullanır. Adapter yalnız
`backups/{tenantId}/firestore/` prefix'indeki doğrulanmış manifestleri ve
`tenants/{tenantId}/settings/phase5-backup-restore-drill` belgesini okur. Son verify
zamanı geçerli manifestlerden seçilir. Restore drill yalnız marker tekrar
`backup-source` durumuna dönmüşse ve Firestore belge `updateTime` değeri korele
edilen manifestin `verifiedAt` değerinden sonraysa `passed` sayılır; eksik veya
uyuşmayan kanıt `unknown` kalır. Operations response object key, key id, checksum,
backup body veya provider credential döndürmez. R2 backup config'i runtime'da hiç
yoksa adapter pasif kalır; kısmi/geçersiz config startup sırasında fail-closed olur.

## Provider sınırı ve dış operasyonlar

Bu faz gerçek billing API entegrasyonu, budget oluşturma veya WAF policy mutationı yapmaz. Production öncesinde kullanıcı/operasyon ekibinin ayrıca yapması gerekenler:

1. Doğrulanmış Firebase/Render/R2 birim maliyetlerini secret olmayan guardrails config'e girmek.
2. Revenue referanslarının ticari sahibi tarafından onaylandığını doğrulamak; bunları otomatik fiyat değişikliği olarak kullanmamak.
3. Firestore telemetry/security signal TTL politikasını staging'de test edip production için ayrıca onaylamak.
4. Provider konsollarında budget alarmı kurmak ve alarm hedeflerini doğrulamak.
5. Cloudflare/WAF rate-limit kurallarını tenant-aware application limiter'ın üstünde bağımsız global katman olarak staging'de test etmek.
6. Gerçek billing adapterı eklenecekse least-privilege read-only credentialı secret store'da tutmak; repo/config JSON içine koymamak.

## Rollback ve regression

- Phase 6 verileri yeni `telemetry` ve `securitySignals` subcollectionlarında additive tutulur; destructive migration yoktur.
- Yeni admin endpointleri salt okunurdur; mevcut tenant API response sözleşmeleri değişmez.
- Runtime rollback için Phase 6 commitleri geri alınabilir. Additive Firestore kayıtları silinmek zorunda değildir ve eski runtime tarafından okunmaz.
- Guardrails config kaldırılırsa güvenli defaultlar kullanılır. Geçersiz config ile deployment hazır sayılmaz.
- Phase 5 backup collection listesi değiştirilmedi; telemetry ve signal koleksiyonları otomatik olarak backup kapsamına eklenmedi.
- Rollback öncesi/sonrası `npm.cmd run ci`, dependency audit, `/health` ve `/ready` testleri çalıştırılmalıdır.
