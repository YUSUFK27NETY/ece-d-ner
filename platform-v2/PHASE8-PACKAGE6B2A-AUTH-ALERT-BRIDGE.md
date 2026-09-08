# Phase 8 Paket 6B-2A — Platform Admin Auth Alert Bridge

Bu paket, 6B-1 durable Firestore security alert sink'ini Platform V2 runtime dependency graph'ına bağlar:

```text
Firestore security alert sink
 -> SecurityAlertService
 -> SecurityOperationsBridge
 -> requirePlatformAdmin
```

Runtime mevcut Firestore `db` instance'ını ve merkezi `security.alerts` config'ini kullanır. Production runtime'a in-memory sink bağlanmaz ve yeni environment veya provider credential gerektirmez.

## Auth denial sözleşmesi

Platform Admin auth middleware'inin her gerçek 401 veya 403 denial'ı Phase 8 service'e tam bir observation gönderir. Phase 6 AbuseMonitor kendi threshold ve aggregate security signal davranışını bağımsız sürdürür; Phase 6 aggregate `count` değeri Phase 8'e kopyalanmaz.

- 401 observation actor'ı her zaman `null` olur.
- Başarıyla doğrulanmış ancak `platformAdmin !== true` olan 403 observation actor'ı trusted Firebase `uid` değeridir.
- Bu control-plane olayları platform-wide'dır; `tenantId` her zaman `null` olur.
- Operation server-owned `platform.admin.auth` değeridir.
- Event type, severity, reason, source, operation ve count alanları caller tarafından belirlenemez.
- Request correlation için yalnız middleware'in daha önce oluşturduğu `req.requestId` kullanılır.

Köprü token, Authorization header, request body, raw provider payload, decoded claims, secret, credential, e-posta, telefon veya başka PII kabul etmez ve persistence modeline taşımaz.

## Hata davranışı ve sınırlar

Phase 6 signal kaydı ile Phase 8 alert kaydı bağımsız best-effort yan etkilerdir. Birinin başarısız olması diğerini engellemez. Alert persistence hatası deny kararını allow'a, 401/403 yanıtını da 500'e çevirmez; log yalnız generic hata metni içerir.

`SecurityAlertService` dedupe ve rolling-window state'i process-local kalır. Durable sink aggregate alertleri Firestore'da saklar, fakat restartlar arası distributed dedupe bu paketin kapsamı değildir.

Bu pakette tenant-boundary veya step-up bridge, read-only alert API, Platform Admin UI ve provider mutationı yoktur.

Rollback için runtime `securityOperations` dependency wiring'i kaldırılır; 6B-1 Firestore sink ve provider-neutral alert çekirdeği değişmeden kalır. Bu işlem Firestore'daki mevcut alert kayıtlarını silmez.
