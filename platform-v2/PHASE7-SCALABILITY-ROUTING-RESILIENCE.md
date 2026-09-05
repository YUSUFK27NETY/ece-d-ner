# Platform V2 Phase 7 — Scalability, Routing & Resilience

Bu faz Issue #41 kapsamını ve Security, Scalability, FinOps & Operational Risk Master Checklist #36 içindeki ölçeklenebilirlik/dayanıklılık maddelerini uygulama seviyesinde karşılar. Phase 5 backup/migration güvenlik kapıları ile Phase 6 telemetry, entitlement, FinOps ve tenant operations görünürlüğü korunur. Ece Döner V1 runtime ve veri yolları değişmez.

Bu branch gerçek shard, database, queue, CDN veya deployment providerı oluşturmaz; production route, deploy, DNS, lifecycle ya da cutover mutationı yapmaz. Provider-neutral sözleşmeleri, güvenli state machine'leri ve salt okunur operasyon görünürlüğünü hazırlar.

## Kapasite ve SLO modeli

`CapacitySloService`, tenant ve platform scope'unda aynı doğrulanmış metriği değerlendirir:

- request rate
- p95/p99 latency
- error rate ve türetilmiş availability
- Firestore + uygulama operation load
- tenant queue backlog ve worker utilization/health
- storage ve bandwidth
- infra/revenue ratio

Durum sırası `normal → warning → critical → dedicated_review` biçimindedir. Shared altyapıdan shard/dedicated placement incelemesine geçiş, müşteri sayısıyla değil ölçülmüş sinyal ve config eşikleriyle tetiklenir. `dedicated_review` yalnız inceleme sinyalidir; otomatik tenant taşımaz.

Varsayılan servis hedefleri availability `0.995`, p95 `500 ms`, p99 `1000 ms`, error rate `0.01` değerleridir. Bunlar fiyat/faturalama veya otomatik deploy kuralı değildir. Telemetry latency histogramı sabit bucket'larla gerçek p95/p99 üretir; Phase 6'dan kalan histogram içermeyen aggregate kayıtları için `latencyMaxMs` güvenli fallback olarak kullanılır.

## Merkezi config

Tek ek giriş noktası:

```text
PLATFORM_SCALABILITY_CONFIG_JSON
```

Bu değer secret değildir. Capacity/SLO, routing cache TTL, tenant queue, public cache ve provider resilience policylerini taşır. Alan allowlist'i, sayısal aralıklar ve eşik sırası startup sırasında fail-closed doğrulanır. Raw config hata mesajına/loga yazılmaz. Credential, provider tokenı veya object body bu JSON'a konmaz.

## Tenant placement ve routing

Merkezi placement kaydı:

```text
platformTenantPlacements/{tenantId}
```

İzin verilen placement türleri `shared`, `shard`, `dedicated`; durumlar `active`, `migrating`, `draining`, `inactive`; release kanalları `canary`, `staged`, `stable` değerleridir. Registry yalnız exact tenant dokümanını okur. Route cache anahtarı yalnız doğrulanmış tenantId'den türetilir. Eksik ve inactive kayıtlar fail-closed davranır.

Shard kaydı için `shardId` ile `placementId` birebir aynı olmalıdır. Placement mutationı yalnız Platform Admin'e açıktır; monoton artan version ister, route cache'i invalid eder ve tenant audit kaydı üretir. Customer-facing URL, credential ve serbest provider metadata'sı placement modeline alınmaz.

Eski tenantlar için placement kaydı bulunmaması startup'ı veya mevcut API'leri bozmaz. Operations kartı `unknown` gösterir; sistem tahminde bulunmaz ve başka tenant kaydına fallback yapmaz.

## Shared → shard/dedicated migration orchestration

Placement migration state machine'i:

```text
planned → dry_run → preflight_passed → copied → verified → cutover → complete
```

Her kayıt aynı `tenantId` ile source tenant, destination tenant, source placement ve destination placement bağlarını tekrar doğrular. Plan ve tamamlanmış stage tekrarları idempotenttir. `copy`, `verify`, `cutover`, `complete` ve rollback için `apply: true` ile exact `confirmationTenantId` birlikte gereklidir.

Preflight hem doğrulanmış backup hem readiness kapısı ister. Adapter rollback desteklemiyorsa orchestration hata detayını yaymadan `forward_fix_required` ve güvenli bir `forwardFixCode` üretir. Her stage tenant audit olayına dönüşür. Bu state machine tek başına gerçek veri kopyalamaz; provider adapterı ve operasyon onayı ayrıca gereklidir.

## Tenant-aware queue ve worker izolasyonu

Queue kontratı job payloadını gövde olarak taşımaz; yalnız `tenants/{tenantId}/...` altında tenant-bound `payloadRef` kabul eder. Serbest metadata yerine `resourceType`, `resourceId`, `version`, `priority`, `correlationId` allowlist'i vardır.

- idempotency anahtarı tenantId ile birlikte değerlendirilir
- burst ve sustained admission sayaçları tenant başınadır
- backlog ve concurrent worker sınırı tenant başınadır
- claim tenantlar arasında round-robin ilerler
- retry sayısı ve exponential backoff üstten sınırlıdır
- son denemeden sonra job dead-letter olur
- response yalnız güvenli error code taşır; exception, body, token veya credential taşımaz

Bir noisy tenant başka tenantın admission sayacını, concurrency payını veya job görünürlüğünü etkileyemez.

## Tenant-aware cache / CDN core

Cache key `tenantId + classification + resourceType + resourceId + version` bileşimidir. Key parçaları doğrulanır; tenant veya delimiter enjeksiyonu reddedilir.

Yalnız `public_static` içerik shared/CDN cache için uygundur ve doğrulanmış TTL + stale-while-revalidate policy alır. `private` ve `admin` içerik `private, no-store` olarak bypass edilir ve in-memory cache'e yazılmaz. Invalidation exact tenant ile, isteğe bağlı resource type/id filtresiyle çalışır. Admin görünürlüğü yalnız public entry sayıları verir; key veya cached body döndürmez.

## Canary/cohort rollout

Tenant release kaydı cohort, current version, target version, stage, health ve zaman bilgisini taşır. Geçiş yalnız sırayla `canary → staged → stable` olabilir. Stable'a gelindiğinde target version current version olur.

Sağlıksız health değerlendirmesi `rollbackSignal: true` üretir ve ilerlemeyi durdurur. `automaticApply` daima `false` kalır; bu core deploy veya rollback çalıştırmaz. Başlatma, promote, health ve rollback signal olayları tenant audit kaydı üretir.

## Provider resilience

`DependencyResilienceService` her bağımlılık için:

- bounded timeout
- bounded retry
- capped exponential backoff
- consecutive failure sayacı
- circuit breaker ve recovery/half-open denemesi
- `healthy`, `degraded`, `unavailable` özeti
- readiness entegrasyonu

sağlar. Provider exception mesajı, response body, endpoint veya credential response/signal içine girmez; yalnız normalize `DEPENDENCY_TIMEOUT`, `DEPENDENCY_ERROR` veya `DEPENDENCY_CIRCUIT_OPEN` kodu görünür. Runtime Firestore readiness çağrısı bu sınırdan geçer.

## Platform Admin operasyon görünürlüğü

Mevcut endpoint değişmeden genişletilir:

```text
GET /api/platform/tenants/:tenantId/operations
```

Health, usage, cost, plan, Backup/DR ve security kartlarına şu salt okunur özetler eklenir:

- placement/routing
- capacity/SLO
- migration state
- queue/backlog/worker health
- public cache/CDN
- release/cohort/rollback signal
- provider resilience/circuit

Her adapter çağrısı exact tenantId alır. Missing/unavailable kaynak `unknown` veya `idle` olur. Response provider objesini spread etmez; yalnız sabit alanları seçer. Secret, key, object body, cached value, credential ve raw provider error görünmez.

## Provider outage runbook

1. `/ready` ve tenant operations resilience kartında etkilenen bağımlılığı doğrula; ham provider yanıtını müşteri görünümüne kopyalama.
2. Circuit `open/unavailable` ise yeni mutation/cutover başlatma. Queue backlog ve tenant dağılımını kontrol et; tenant concurrency limitlerini global limiti gevşetecek biçimde değiştirme.
3. Aktif rollout varsa promote etme. Sağlık eşiği aşılmışsa rollback sinyalini kaydet; deploy/rollback için ayrı operasyon onayı al.
4. Aktif placement migration varsa son doğrulanmış state'te dur. Backup/readiness gate geçmeden veya exact tenant apply onayı olmadan ilerleme.
5. Provider dashboard/loglarını least-privilege erişimle incele. Credential veya response body'yi issue, audit metadata'sı ya da operations response'a koyma.
6. Provider iyileştiğinde recovery penceresinden sonra bounded probe çalıştır. Readiness ve error budget normale dönmeden circuit/rollout durumunu healthy sayma.
7. Olay sonrası tenant etkisi, güvenli error code, süre, backlog ve SLO etkisini kaydet; gerekiyorsa #36 risk checklist'ini güncelle.

## Harici/onaylı aktivasyon adımları

Bu branch aşağıdakileri çalıştırmaz. Staging'de doğrulandıktan sonra production için ayrı kullanıcı/operasyon onayı gerekir:

1. Gerçek shard/dedicated Firestore project/database ve least-privilege service identity oluşturma.
2. Placement kayıtlarını gerçek provider hedeflerine bağlayacak adapter/config seçimi.
3. Managed queue/worker ve dead-letter provider provision/deploy işlemi.
4. CDN cache rule, purge tokenı veya custom domain/DNS değişikliği.
5. Canary cohort seçimi, deployment, promotion veya rollback.
6. Gerçek veri copy/verify/cutover/rollback adapterının çalıştırılması.
7. Alert, paging ve provider budget alarmı aktivasyonu.

## Rollback ve regression

- Yeni Firestore placement collectionı additive'dir. Tenant iş verisi ve `platformTenants` kaydı değişmez.
- Route kaydı yoksa eski tenant akışı devam eder; yeni operations alanları `unknown/idle` olur.
- Queue, cache ve rollout runtime implementasyonları provider-neutral/in-memory core'dur; gerçek provider mutationı yoktur.
- Yeni telemetry histogram alanı additive'dir ve legacy aggregate fallback'i vardır.
- Runtime rollback için Phase 7 commitleri geri alınabilir; additive placement/telemetry metadata'sı eski runtime tarafından okunmaz ve silinmek zorunda değildir.
- Rollback öncesi/sonrası full CI, dependency audit, `/health`, `/ready`, tenant operations, cross-tenant ve migration dry-run testleri çalıştırılmalıdır.
