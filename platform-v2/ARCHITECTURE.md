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

## 4. Veri izolasyonu

V2 iş verisi yalnızca aşağıdaki root altında tutulur:

```text
tenants/{tenantId}/...
```

Böylece sorgu, backup, audit ve ileride shard/migration işlemleri tenant sınırına göre yapılabilir.

Platform global metadata tenant iş verisinden ayrıdır.

## 5. Yetkilendirme

Minimum roller:

- `platform_admin`: tüm platform operasyonları
- `tenant_owner`: kendi tenantında tam işletme yetkisi
- `tenant_admin`: yetkilendirilmiş yönetim
- `staff`: operasyonel yetkiler
- `viewer`: salt okunur yönetim görünümü

RBAC daha sonra permission tabanlı modele genişletilebilir. Rol kontrolü tek başına yeterli değildir; her işlem tenant sınırını da doğrulamalıdır.

## 6. Provider bağımsızlığı

Dış servisler doğrudan domain koduna gömülmez. Örnek:

```text
ObjectStorageProvider
  -> R2 adapter
  -> S3 adapter
  -> B2 adapter
```

Provider değişimi domain modelini veya tenant veri yapısını değiştirmemelidir.

## 7. Backup

Her backup açık tenant kimliği taşır ve başka tenantın prefix'ine yazamaz.

```text
backups/{tenantId}/firestore/YYYY/MM/DD/<timestamp>.json.gz.enc
```

Production restore doğrudan canlı verinin üstüne uygulanmaz. Restore önce izole test hedefinde doğrulanır, kayıt sayıları ve kritik örnekler kontrol edilir.

## 8. Ölçekleme yolu

Başlangıçta tenantlar aynı platform servislerini ve veri altyapısını paylaşabilir. Büyük tenantlar gerektiğinde shard veya ayrı database/project altyapısına taşınabilir; tenant routing katmanı sayesinde istemci ve iş mantığı değişmeden kalmalıdır.

Bu nedenle tenantId uygulama seviyesinde birinci sınıf kimliktir; fiziksel database konumu değildir.

## 9. Operasyon kuralları

- Production'a doğrudan deneysel değişiklik yok.
- Her değişiklik PR + test üzerinden ilerler.
- Migration'lar idempotent ve versioned olmalıdır.
- Secrets repository içinde tutulmaz.
- Audit kayıtları kritik admin mutation işlemlerinde zorunlu hale getirilecektir.
- Monitoring tenantId ve requestId ile korelasyon yapabilmelidir.

## 10. V1 sınırı

Ece Döner V1 şu an ayrı ve stabil kalır. V2 foundation hazır olmadan V1 veri yolları `tenants/{tenantId}` modeline taşınmaz. Migration ayrı plan, ayrı test ve rollback prosedürü ile yapılır.
