# Platform V2 Deployment

Platform V2, Ece Döner V1 backend'inden **ayrı bir servis** olarak deploy edilmek üzere tasarlanır.

## Runtime

```text
node platform-v2/server.js
```

## Environment / secret sözleşmesi

```text
PLATFORM_FIREBASE_SERVICE_ACCOUNT_PATH=/secure/path/platform-service-account.json
PLATFORM_PORT=3100
```

`PLATFORM_PORT` verilmezse hosting sağlayıcısının `PORT` değeri kullanılır.

Service account JSON repository'ye commit edilmez. Production'da secret file / secret manager üzerinden mount edilir.

## Firebase sınırı

Uzun vadeli production mimarisinde merkezi Platform V2 için Ece Döner V1 Firebase projesinden ayrı bir platform Firebase projesi kullanılması hedeflenir. Böylece tek bir müşteri projesi merkezi kontrol düzleminin sahibi olmaz.

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

## Production'a geçmeden önce

- ayrı platform Firebase projesi
- ayrı service account ve least-privilege IAM
- platform admin kullanıcısı + custom claim
- production origin/CORS politikası
- staging deploy
- API smoke test
- monitoring/alerting
- backup/restore provider entegrasyonu

hazır ve test edilmiş olmalıdır.
