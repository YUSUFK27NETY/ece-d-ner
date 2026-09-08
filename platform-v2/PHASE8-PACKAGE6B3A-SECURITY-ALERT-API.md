# Phase 8 Paket 6B-3A — Read-Only Security Alerts API

Bu paket mevcut durable Firestore Central Security Alert persistence katmanını Platform Admin için yalnız okunabilir iki endpoint ile görünür kılar:

- `GET /api/platform/tenants/:tenantId/security-alerts?limit=20`
- `GET /api/platform/security-alerts?limit=20`

Her iki endpoint mevcut Platform Admin CORS, rate-limit ve Firebase token/`platformAdmin` claim doğrulama zincirinin arkasındadır. Tenant endpoint ayrıca mevcut tenant telemetry ve `admin_tenant` rate-limit middleware zincirinden geçer. Reader'a yalnız doğrulanmış `req.platformActor` kimliğiyle server-owned `{ role, actorId }` context'i aktarılır; request body veya client context kullanılmaz.

Tenant endpoint strict, canonical `tenantId` ister. Platform endpoint reader'ı yalnız `tenantId: null` ile çağırır ve sadece `platformSecurityAlerts` scope'unu okur; tenant alertlerini global bir listede aggregate etmez. Limit varsayılan `20`, minimum `1`, maksimum `200` olan strict integer kontratıdır.

Production runtime aynı `createFirestoreSecurityAlertSink` instance'ını SecurityAlertService write sink'i ve API read source'u olarak paylaşır. İkinci Firestore reader/sink veya yeni provider/config/credential eklenmez. In-memory sink production'a bağlanmaz.

Firestore reader persisted kayıtları doğrular ve yalnız mevcut alert allowlist projeksiyonunu döndürür. API katmanı da yalnız bu alanları kopyalar; unknown alanlar, token, Authorization, body, secret, credential, e-posta, telefon, IP, raw claim ve provider payload response'a alınmaz.

Firestore sorgu hatası veya bozuk/tamper edilmiş persisted kayıt client input hatası sayılmaz. Reader kaynaklı tüm hatalar `500` ve `Güvenlik uyarıları alınamadı.` mesajına eşlenir; provider/raw record detayı client'a veya log'a taşınmaz. Log yalnız generic bir hata mesajıdır.

Bu pakette POST/PATCH/DELETE alert handler'ı, resolve/acknowledge/delete veya incident mutationı yoktur. Platform Admin UI sonraki 6B-3B paketindedir. Provider mutationı, step-up enforcement, distributed dedupe ve mevcut alert lifecycle davranışları değişmez.

Rollback için iki GET route'u, `securityAlertReader` optional dependency'si, shared runtime sink wiring'i ve bu dokümantasyon referansı kaldırılır. Persisted alertler silinmez veya değiştirilmez.
