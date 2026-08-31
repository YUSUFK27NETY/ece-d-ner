# Ece Döner V1 -> Platform V2 Migration Planı

Bu belge yalnız plan ve kabul kriteridir. Migration, Platform V2 staging/production altyapısı hazır olmadan çalıştırılmaz.

## Hedef

Ece Döner'i çalışan V1'i riske atmadan `ece-doner` tenantı olarak merkezi V2 platformuna taşımak.

V1 kaynak yapısı:

```text
products/{id}
orders/{id}
settings/{id}
```

V2 hedef yapısı:

```text
tenants/ece-doner/products/{id}
tenants/ece-doner/orders/{id}
tenants/ece-doner/settings/{id}
platformTenants/ece-doner
```

## Değişmez güvenlik kuralları

1. V1 üzerinde doğrudan destructive migration yapılmaz.
2. Kaynak doküman kimlikleri mümkün olduğunca korunur.
3. V1 verisi migration sonunda otomatik silinmez.
4. Her veri taşıma idempotent/versioned script ile yapılır.
5. İlk production migration öncesi staging üzerinde aynı prosedür prova edilir.
6. Cutover öncesi bağımsız veri yedeği ve kod rollback noktası doğrulanır.
7. Sayım ve kritik örnek doğrulaması başarısızsa cutover yapılmaz.

## Önerilen akış

### 1. Hazırlık

- Platform production tenant registry hazır.
- `ece-doner` tenantı `provisioning` durumunda oluşturulur.
- V2 ürün/sipariş/ayar şemaları staging'de doğrulanır.
- V1 rollback branch/tag doğrulanır.
- Firestore veri yedeği alınır.

### 2. Canlıyken ilk kopya

V1 çalışmaya devam ederken ürünler, settings ve mevcut siparişler V2 tenant yollarına **copy-only** taşınır.

Bu aşamada müşteri trafiği hâlâ V1'e gider.

### 3. Doğrulama

En az aşağıdakiler karşılaştırılır:

- ürün doküman sayısı
- aktif/arşiv ürün dağılımı
- sipariş doküman sayısı
- sipariş toplamları ve kimlikleri için örneklem
- restoran açık/kapalı ayarı
- kritik tenant feature ve marka ayarları

### 4. Kısa cutover penceresi

Sipariş kaybını önlemek için:

1. V1 admin panelinden restoran geçici olarak kapatılır.
2. İlk kopyadan sonra oluşmuş son değişiklikler/delta tekrar kopyalanır.
3. Sayımlar yeniden doğrulanır.
4. V2 tenant `active` yapılır.
5. Frontend/API routing V2'ye çevrilir.
6. V2 müşteri sipariş + admin ürün/sipariş smoke testi yapılır.
7. Başarılıysa restoran V2 üzerinden açılır.

Bu pencere mümkün olduğunca kısa tutulur.

## Rollback

Cutover sonrası kritik hata görülürse:

1. V2 yeni sipariş alımı durdurulur.
2. Routing tekrar V1 endpointlerine çevrilir.
3. V2'de oluşmuş yeni sipariş varsa kaybolmaması için ayrı reconciliation listesine alınır.
4. V1 tekrar açılır.
5. Hata düzeltilmeden ikinci cutover yapılmaz.

V1 verisi migration sırasında silinmediği için rollback fiziksel veri restore gerektirmemelidir.

## Migration tamamlandı sayılma kriterleri

- staging prova başarılı
- production backup doğrulandı
- V1/V2 veri sayımları uyumlu
- customer smoke başarılı
- admin smoke başarılı
- audit/monitoring kayıtları geliyor
- rollback prosedürü uygulanabilir durumda
- belirlenen gözlem süresi boyunca kritik hata yok

Ancak bu kriterlerden sonra V1 legacy statüsüne alınır. V1 verisinin temizlenmesi ayrı bir değişiklik ve ayrıca onay gerektirir.
