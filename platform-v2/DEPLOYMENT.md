# Platform V2 Deployment

Platform V2, Ece Döner V1 backend'inden **ayrı runtime** olarak deploy edilir; ancak bütün müşteriler aynı merkezi V2 servisinden yönetilir. Müşteri başına yeni backend veya repo açılmaz.

## Runtime

```text
node platform-v2/server.js
```

Merkezi yönetim paneli aynı servis tarafından sunulur:

```text
/admin/
```

API ve panel aynı origin üzerinde tutulabildiği için varsayılan production akışında ayrı frontend deployment zorunlu değildir.

## Environment / secret sözleşmesi

```text
PLATFORM_FIREBASE_SERVICE_ACCOUNT_PATH=/secure/path/platform-service-account.json
PLATFORM_FIREBASE_WEB_CONFIG_JSON={"apiKey":"...","authDomain":"...","projectId":"...","appId":"..."}
PLATFORM_ALLOWED_ORIGINS=https://admin.example.com
PLATFORM_PORT=3100
PLATFORM_GUARDRAILS_CONFIG_JSON={"plans":{"starter":{"allowedFeatures":"*","softRequestLimit":100000,"warningThreshold":0.8,"dedicatedReviewThreshold":1,"monthlyRevenueReference":2000}}}
```

`PLATFORM_PORT` verilmezse hosting sağlayıcısının `PORT` değeri kullanılır.

### Secret olan / olmayan değerler

- `PLATFORM_FIREBASE_SERVICE_ACCOUNT_PATH` ile gösterilen service account JSON **secret** kabul edilir ve repository'ye commit edilmez.
- Firebase web config tarayıcı tarafından kullanılacağı için gizli credential değildir; yine de ortam bazlı yönetilir ve yalnız gerekli alanlar `/admin/config.js` üzerinden yayınlanır.
- `PLATFORM_ALLOWED_ORIGINS` yalnız ek browser originleri içindir. Aynı origin üzerindeki `/admin/` paneli otomatik kabul edilir.
- `PLATFORM_GUARDRAILS_CONFIG_JSON` secret değildir; rate-limit, entitlement ve maliyet tahmin policylerini taşır. Geçersiz değer startup'ı fail-closed durdurur ve raw config loglanmaz.
- Provider billing credentialları bu JSON içine konmaz. Phase 6 varsayılan rate-card değerleri sıfırdır ve gerçek billing adapterı zorunlu değildir.

## Firebase sınırı

Merkezi Platform V2 için Ece Döner V1 Firebase projesinden ayrı bir platform Firebase projesi kullanılmalıdır. Böylece tek bir müşteri projesi merkezi kontrol düzleminin sahibi olmaz.

Merkezi tenant metadata'sı:

```text
platformTenants/{tenantId}
```

Tenant iş verisi:

```text
tenants/{tenantId}/...
```

## Platform admin claim

Platform Admin API yalnızca Firebase ID token içinde aşağıdaki custom claim mevcutsa erişime izin verir:

```json
{
  "platformAdmin": true
}
```

Bu claim tenant admin claim'lerinden ayrıdır. Tenant sahibi veya personel tokenı merkezi platform endpointlerine erişemez.

## Merkezi panelin yetenekleri

Panel production config sağlandıktan sonra:

- tenant listeleme ve arama
- yeni işletme oluşturma
- tenant durumunu yönetme (`provisioning`, `active`, `suspended`, `archived`)
- paket değiştirme
- feature flag açma/kapatma
- marka adı, telefon, WhatsApp, e-posta, web sitesi, custom domain, logo, renk, adres ve saat dilimi yönetimi

işlemlerini tek yerden yapar.

## CORS ve browser erişimi

Platform API fail-closed origin kontrolü uygular. Tarayıcı isteğinde `Origin` varsa yalnız:

1. API'nin kendi origin'i veya
2. `PLATFORM_ALLOWED_ORIGINS` içinde tanımlı HTTPS origin

kabul edilir. Server-to-server isteklerinde `Origin` header'ı zorunlu değildir; kimlik doğrulama yine Platform Admin tokenı ile yapılır.

## Staging / production ayrımı

Önerilen yapı:

```text
Platform V2 Staging
  -> ayrı Firebase project
  -> ayrı service account
  -> ayrı hostname

Platform V2 Production
  -> ayrı Firebase project
  -> ayrı service account
  -> ayrı hostname
```

Aynı tenant kimliği staging ve production'da bulunabilir ancak veritabanları fiziksel olarak ayrıdır.

## Production'a geçmeden önce

- [ ] ayrı platform Firebase production projesi
- [ ] ayrı platform Firebase staging projesi
- [ ] least-privilege service account secret'ları
- [ ] platform admin kullanıcı + `platformAdmin: true` claim
- [ ] Firebase web config environment değerleri
- [ ] production origin/CORS allowlist
- [ ] staging deploy + `/health` smoke
- [ ] merkezi panel login/list/create/update smoke
- [ ] audit kayıtlarının tenant bazlı doğrulanması
- [ ] monitoring/alerting
- [ ] tenant-aware backup/restore provider entegrasyonu
- [ ] guardrails config validation + tenant telemetry izolasyon testi
- [ ] tenant operations ve top-N FinOps admin endpoint smoke testi
- [ ] budget alarmı ve WAF politikasının staging üzerinde bağımsız doğrulanması

Bu kontroller tamamlanmadan Ece Döner V1 otomatik olarak V2'ye taşınmaz.
