# Platform V2 Architecture

## 1. Hedef

Platform, yeni müşteri geldiğinde kod kopyalamadan ve müşteri başına ayrı operasyon zinciri oluşturmadan merkezi olarak büyümelidir.

### Onboarding hedefi

```text
Platform Admin
  -> Yeni İşletme
  -> tenantId + sektör + paket + marka bilgileri
  -> özellikleri etkinleştir
  -> aktif et
```

Müşteri sayısı arttığında bu akış değişmemelidir.

## 2. Katmanlar

```text
[Platform Admin / Tenant Admin / Public Client]
                  |
             [API Gateway]
                  |
        [Auth + Tenant Resolution]
                  |
      [Domain / Application Services]
        /        |         \
   Firestore   Storage   Notifications
      |           |           |
 tenant-aware   adapter      adapter
```

Hiçbir application service tenant kimliği olmadan tenant verisine erişmemelidir.

## 3. Tenant çözümleme

Tenant kimliği ileride custom domain, subdomain veya güvenilir authenticated claim üzerinden çözülebilir. İstemciden gelen serbest `tenantId` tek başına yetkilendirme kaynağı kabul edilmez.

Public endpointlerde tenant çözümleme sonucu server tarafında doğrulanır. Admin endpointlerde authenticated kullanıcının tenant üyeliği ve rolü doğrulanır.

`platform_admin` platform seviyesinde çalışabildiği için tenantId taşımak zorunda değildir. Tenant rolleri ise açık ve doğrulanmış tenantId olmadan oluşturulamaz.

## 4. Veri izolasyonu

Tenant iş verisi yalnızca aşağıdaki root altında tutulur:

```text
tenants/{tenantId}/...
```

Merkezi tenant registry ayrı bir global collection kullanır:

```text
platformTenants/{tenantId}
```

Registry; işletme adı, sektör, paket, durum, feature flags ve platform metadata'sını tutar. Ürün, sipariş ve müşteri verisi registry içine yazılmaz.

Bu ayrım sorgu, backup, audit ve ileride shard/migration işlemlerinin tenant sınırına göre yapılmasını sağlar.

## 5. Yetkilendirme

Minimum roller:

- `platform_admin`: tüm platform operasyonları
- `tenant_owner`: kendi tenantında tam işletme yetkisi
- `tenant_admin`: yetkilendirilmiş yönetim
- `staff`: operasyonel yetkiler
- `viewer`: salt okunur yönetim görünümü

Her işlemde hem permission hem tenant scope doğrulanır. Tenant rolü başka tenantın verisine geçemez. `platform_admin` yalnızca platform kimliği doğrulandıktan sonra tenantlar arası işlem yapabilir.

## 6. Merkezi onboarding

Yeni işletme creation akışı domain seviyesinde `TenantOnboardingService` üzerinden yapılır. Service:

1. tenant kaydını validate eder,
2. aynı tenantId'nin mevcut olmadığını doğrular,
3. merkezi registry'ye atomik create uygular,
4. kritik işlemi audit katmanına gönderir.

İleride panel ve API aynı service'i kullanacaktır; müşteri başına ayrı onboarding kodu yazılmayacaktır.

## 7. Feature flags ve sektörler

Sektör adı tenant metadata'sıdır; özellik davranışı feature flags üzerinden yönetilir. Böylece restoran, berber, güzellik salonu veya başka sektörler aynı core'u kullanabilir.

Yeni sektör eklemek mevcut tenant kayıt modelini değiştirmemelidir. Özellikler merkezi katalogdan açılıp kapanır.

## 8. Provider bağımsızlığı

Dış servisler doğrudan domain koduna gömülmez. Örnek:

```text
ObjectStorageProvider
  -> R2 adapter
  -> S3 adapter
  -> B2 adapter
```

Provider değişimi domain modelini veya tenant veri yapısını değiştirmemelidir.

## 9. Backup

Her backup açık tenant kimliği taşır ve başka tenantın prefix'ine yazamaz.

```text
backups/{tenantId}/firestore/YYYY/MM/DD/<timestamp>.json.gz.enc
```

Production restore doğrudan canlı verinin üstüne uygulanmaz. Restore önce izole test hedefinde doğrulanır, kayıt sayıları ve kritik örnekler kontrol edilir.

## 10. Ölçekleme yolu

Başlangıçta tenantlar aynı platform servislerini ve veri altyapısını paylaşabilir. Büyük tenantlar gerektiğinde shard veya ayrı database/project altyapısına taşınabilir; tenant routing katmanı sayesinde istemci ve iş mantığı değişmeden kalmalıdır.

Bu nedenle tenantId uygulama seviyesinde birinci sınıf kimliktir; fiziksel database konumu değildir.

## 11. Operasyon kuralları

- Production'a doğrudan deneysel değişiklik yok.
- Her değişiklik PR + test üzerinden ilerler.
- Migration'lar idempotent ve versioned olmalıdır.
- Secrets repository içinde tutulmaz.
- Audit kayıtları kritik admin mutation işlemlerinde zorunlu hale getirilecektir.
- Monitoring tenantId ve requestId ile korelasyon yapabilmelidir.

## 12. V1 sınırı

Ece Döner V1 şu an ayrı ve stabil kalır. V2 yeterince hazır olmadan V1 veri yolları `tenants/{tenantId}` modeline taşınmaz. Migration ayrı plan, ayrı test ve rollback prosedürü ile yapılır.
