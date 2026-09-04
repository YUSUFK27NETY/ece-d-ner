# Platform V2 Phase 5 — Foundation Hardening & Disaster Recovery

Bu fazın amacı yalnız backup almak değil; Platform V2'nin veri kaybı, tenant sınırı ihlali, başarısız migration, görünmeyen dependency arızası ve geri döndürülemez restore risklerine karşı kontrollü davranmasını sağlamaktır.

## Tamamlanma tanımı

Phase 5 ancak aşağıdaki kapılar birlikte geçerse tamamlanır:

1. Yeni hardening/unit testleri ve mevcut test suite yeşil.
2. Tampered backup, yanlış encryption key ve cross-tenant restore fail-closed.
3. Staging üzerinde gerçek object storage'a tenant backup yazılır, tekrar okunur ve doğrulanır.
4. Staging restore önce dry-run, sonra kontrollü test tenantına apply edilir ve sonuç doğrulanır.
5. `/health` liveness ile dependency-aware readiness birbirinden ayrılır; Firestore erişilemezse readiness 503 verir.
6. Migration planı sıralı, versioned ve verify adımı olmadan başarılı sayılmaz.
7. Production backup schedule yalnız staging restore drill geçtikten sonra açılır.
8. Production'da destructive `replace` restore varsayılan olarak kapalı kalır.

## Backup formatı

Backup container `PV2BKP1` imzası ve versioned header kullanır. Payload JSON UTF-8 olarak üretilir, gzip ile sıkıştırılır ve AES-256-GCM ile authenticated encryption uygulanır. Header GCM AAD olarak bağlanır. Böylece tenantId, schemaVersion, keyId, checksum veya codec metadata üzerinde oynama yapılırsa decrypt/verify başarısız olur.

Her başarılı backup için ayrıca manifest tutulur. Manifest en az tenantId, object key, format/schema version, keyId, container SHA-256, plaintext SHA-256, boyut ve verification zamanını içerir. Backup object storage'a yazıldıktan sonra tekrar okunup decrypt/checksum doğrulaması yapılmadan manifest `verified` üretilmez.

## Encryption key yönetimi

Runtime keyring iki environment secret ile modellenir:

- `PLATFORM_BACKUP_ACTIVE_KEY_ID`
- `PLATFORM_BACKUP_KEYS_JSON`

`PLATFORM_BACKUP_KEYS_JSON` yalnız secret store içinde bulunmalıdır; GitHub, issue, log, ekran görüntüsü veya chat içine yazılmaz. Her key tam 32 byte rastgele anahtarın base64 temsilidir. Rotation sırasında yeni key aktif edilir, eski keyler retention süresi boyunca yalnız restore için tutulur. Eski backup'lar expire olmadan eski key silinmez.

## Tenant izolasyonu

Backup payload, header, manifest ve restore hedefi aynı normalize edilmiş tenantId ile bağlanır. `tenants/{tenantId}` dışına çıkan Firestore path fail-closed olur. Snapshot içindeki Firestore DocumentReference başka bir `tenants/{otherTenant}` rootuna gidiyorsa restore reddedilir.

Tenant registry kimliği restore sırasında payload'dan körlemesine alınmaz; hedef tenantId tekrar zorlanır. Production restore başka tenant kimliğiyle onaylanamaz.

## Restore güvenlik modeli

Restore çağrılarının varsayılanı `dry-run`dır. Dry-run doğrulama yapar fakat veri yazmaz. Apply için hedef tenantId ikinci kez confirmation olarak verilmelidir. `replace` modu kernelde ayrıca feature gate arkasındadır ve ilk sürüm Firestore snapshot provider yalnız `merge` uygular.

Staging apply drill bunun üzerinde ek fail-closed kapılar uygular:

- tenant kimliği `backup-drill-` prefix'i ile başlamalıdır,
- `PLATFORM_BACKUP_DRILL_APPLY` tam olarak `true` olmalıdır,
- `PLATFORM_BACKUP_DRILL_ENVIRONMENT` tam olarak `staging` olmalıdır,
- `PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID` hedef tenant ile birebir aynı olmalıdır,
- `PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION` değeri `staging:{tenantId}:restore-apply` biçiminde hedef tenant'a bağlı olmalıdır,
- restore mode kod içinde sabit olarak `merge` gönderilir; `replace` kullanılmaz.

Apply flag tanımsız, boş veya `false` ise script yalnız encrypted backup, verify ve restore dry-run yapar; Firestore marker oluşturmaz veya restore yazması yapmaz. Tanınmayan apply flag değerleri sessizce dry-run'a düşmez, hata ile kapanır. Bu kapılar yalnız dedicated staging test tenantını hedefler; production müşteri tenantına apply drill uygulanmaz ve production'da destructive restore yoktur.

Production müşteri verisine restore uygulanmadan önce aynı backup veya eşdeğer test snapshotı staging/test tenantında restore edilip doğrulanmalıdır. Acil durum dışında production restore doğrudan denenmez.

## Firestore snapshot kapsamı

İlk provider tenant registry kaydını ve izin verilen tenant koleksiyonlarını kapsar: products, orders, settings, members ve audit. Firestore özel tipleri JSON-safe tagged representation ile taşınır. Tanınmayan class/nesne türleri sessiz dönüştürülmez; backup fail-closed olur.

Bu uygulama tenant-level application backup'tır. Cross-collection okuma tek bir global Firestore point-in-time snapshot garantisi vermez. Daha ileri ölçek/uyumluluk gereksiniminde provider-native database export ikinci DR katmanı olarak eklenebilir; uygulama backup'ının yerine değil yanına gelir.

## Retention

Kod tabanı retention hesaplamasını provider-neutral tutar. İlk production politikası storage maliyeti ve müşteri ihtiyacına göre ayrıca onaylanacaktır. Minimum başlangıç hedefi günlük backup + yeterli restore penceresidir; lifecycle policy aktif edilmeden önce staging üzerinde object list/delete davranışı test edilir.

## Migration standardı

Her migration:

- benzersiz artan `version` ve `id` taşır,
- `up()` ve `verify()` uygular,
- rollback fonksiyonu veya açık forward-fix prosedürü tanımlar,
- zincirde version atlayamaz,
- verify `true` dönmeden uygulanmış sayılmaz.

Otomatik downgrade yoktur. Production migration öncesi backup + staging prova + rollback/forward-fix kararı zorunludur.

## Liveness / readiness

`/health` yalnız prosesin HTTP cevap verebildiğini gösterir. Readiness ayrıca Firestore gibi zorunlu dependency'leri kontrol eder. Dependency timeout/hatasında servis proses olarak canlı olsa bile `not_ready` sayılır. Public readiness response secret/error message döndürmez; yalnız güvenli status/code metadata yayınlar.

## Structured operations logging

Operasyon logları JSON satırı olarak timestamp, level, event, requestId, tenantId, operation, status/code ve durationMs gibi sınırlı alanlar taşır. Request body, token, password, service-account JSON, encryption key veya kullanıcı tarafından girilen serbest metin loglanmaz.

## Soft-delete / destructive operation standardı

İşletme, kullanıcı, ürün ve kritik yönetim kayıtlarında kullanıcı arayüzünden doğrudan fiziksel silme yerine önce archive/soft-delete tercih edilir. Fiziksel purge ayrı retention işi olmalıdır. Audit kayıtları normal UI işlemiyle silinmemelidir.

## Staging restore drill sırası

1. Object storage provider ve least-privilege credential yalnız staging'e eklenir.
2. Backup encryption key staging secret store'a eklenir.
3. Dedicated `backup-drill-*` tenant içindeki `settings/phase5-backup-restore-drill` marker belgesi backup kaynak değeriyle `merge` yazılır ve tekrar okunur.
4. Encrypted tenant backup alınır.
5. Object tekrar okunur; AES-256-GCM + SHA-256 + manifest doğrulanır.
6. Restore dry-run çalıştırılır; restore yazması olmadığı doğrulanır.
7. Marker kontrollü olarak `mutated-after-backup` değerine değiştirilir ve Firestore'dan tekrar okunur.
8. Tüm staging/apply/tenant onayları açıkken `apply: true`, exact `confirmationTenantId` ve `mode: merge` ile restore uygulanır.
9. Marker Firestore'dan yeniden okunur; backup içindeki `backup-source` değerine döndüğü doğrulanır. Marker ve verified R2 backup audit kanıtı olarak korunur.
10. Wrong tenant, tampered container, tampered manifest/checksum, wrong encryption key, cross-tenant reference, confirmation mismatch, apply gate, prefix guard ve replace-disabled negatif testleri çalıştırılır.
11. `/health` 200; sağlıklı dependency ile `/ready` 200, Firestore arızasında detay sızdırmadan `/ready` 503 davranışı doğrulanır.
12. Sonuç Issue #32'ye kaydedilir. Ancak bu kanıtlardan sonra production backup schedule değerlendirilir.

Dry-run (varsayılan, Firestore marker/restore yazması yok):

```bash
node platform-v2/scripts/run-staging-backup-drill.js
```

Dedicated staging tenant için tek seferlik kontrollü apply drill komutu:

```bash
PLATFORM_BACKUP_DRILL_APPLY=true PLATFORM_BACKUP_DRILL_ENVIRONMENT=staging PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID=backup-drill-staging PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION=staging:backup-drill-staging:restore-apply node platform-v2/scripts/run-staging-backup-drill.js
```

Render Build Command üzerinden bağımlılık kurulumu ile birlikte tek sefer çalıştırılacaksa:

```bash
npm ci && PLATFORM_BACKUP_DRILL_APPLY=true PLATFORM_BACKUP_DRILL_ENVIRONMENT=staging PLATFORM_BACKUP_DRILL_CONFIRM_TENANT_ID=backup-drill-staging PLATFORM_BACKUP_DRILL_STAGING_CONFIRMATION=staging:backup-drill-staging:restore-apply node platform-v2/scripts/run-staging-backup-drill.js
```

Başarılı apply kanıtında secret içermeyen `BACKUP_APPLY_DRILL_OK=true`, `RESTORE_APPLY_OK=true` ve `MARKER_RESTORED_OK=true` satırlarının üçü de görülmelidir. Komut sonrasında Render Build Command tekrar normal `npm ci` değerine döndürülür. Script hata durumunda yalnız kontrollü hata kodunu loglar; request body, credential veya encryption key loglamaz.

## Dış altyapı seçim kriteri

Storage sağlayıcısı seçilirken S3-compatible API, bucket-scoped least-privilege credential, lifecycle/retention, object integrity metadata, encryption-at-rest, region/availability, egress/operation maliyeti ve provider lock-in değerlendirilir. Uygulama katmanı `ObjectStorageProvider` kontratına bağlı kalır; business logic doğrudan bir sağlayıcı SDK'sına bağlanmaz.

## Production değişiklik kuralı

Ece Döner V1 bu faz nedeniyle otomatik migrate edilmez. `main` yalnız zorunlu CI kontrolleri geçtikten sonra değişir. Yeni backup/restore özellikleri environment secret/provider eksikken production runtime'ı kırmamalı; dış provider aktive edilene kadar kod pasif kalır.
