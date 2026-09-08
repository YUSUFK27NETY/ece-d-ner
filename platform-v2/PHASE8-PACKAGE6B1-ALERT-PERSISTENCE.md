# Phase 8 Paket 6B-1 — Central Security Alert Persistence

Bu paket, Phase 8 central security alert çekirdeği için provider-neutral ve durable Firestore sink temelini ekler. Runtime wiring, auth bridge, API ve UI bu kapsamda etkinleştirilmez.

## Firestore collection sözleşmesi

Tenant-bound alert:

```text
tenants/{tenantId}/securityAlerts/{alertId}
```

Platform-wide alert:

```text
platformSecurityAlerts/{alertId}
```

Tenant ve platform scope'ları ayrı collection yollarında tutulur. Tenant listesi mevcut `tenant.security.read` permission kontrolünü kullanır. Platform-wide liste yalnız `platform_admin` rolüne açıktır; query scope her çağrıda `tenantId` veya açık `null` olarak verilmelidir.

## Durable ve idempotent aggregate update

Sink yalnız security alert core'un aynı process içinde gerçekten issued ettiği alert nesnesini `emit()` için kabul eder. Plain object, deserialize edilmiş kopya veya forged payload `assertSecurityAlert()` tarafından fail-closed reddedilir.

Yazma `alertId` document kimliğiyle Firestore transaction içinde yapılır:

- aynı alert retry edildiğinde mevcut aggregate korunur;
- daha düşük `eventCount`, daha yeni aggregate'i overwrite etmez;
- daha yüksek `eventCount`, stable aggregate kimliği ve monotonic zaman/severity ilerlemesi doğrulandıktan sonra yazılır;
- arbitrary input alanı spread edilmez.

Bu davranış teslim retry'ını idempotent yapar; gerçek alert üretiminin severity/dedupe kararını sink'e taşımaz.

## Safe persistence projection

Firestore'a yalnız aşağıdaki alanlar yazılır:

```text
schemaVersion, alertId, dedupeKey, eventType, severity,
tenantId, actorId, requestId, correlationId, source,
occurredAt, reasonCode, operation, eventCount, duplicateCount,
rollingCount, firstSeenAt, lastSeenAt
```

Token, request body, secret, credential, e-posta, telefon, IP adresi veya provider payload persistence modeline alınmaz.

## Persisted-data validation

Firestore'dan okunan veri process-local issued-object WeakSet'ine tekrar sokulmaz. Process restart sonrasında nesne kimliği korunamayacağı için list okuması ayrı strict persisted-record validator kullanır.

Validator şu kontrolleri fail-closed uygular:

- `alertId`, Firestore `doc.id` ve `dedupeKey` birebir eşleşir;
- tenantId query/collection scope ile eşleşir;
- event type, severity, source, reason code ve operation mevcut model allowlist'lerine uyar;
- request/correlation kimlikleri canonical kontrata uyar;
- count alanları safe integer ve birbiriyle tutarlıdır;
- timestamp alanları canonical ISO biçiminde ve doğru sıradadır;
- bozuk required alan generic `TypeError` üretir ve raw persisted değeri hata mesajına eklemez;
- bilinmeyen persisted alanlar response projection'a taşınmadan görmezden gelinir.

Listeleme `lastSeenAt desc` Firestore query'si kullanır, strict `1..200` limit uygular ve yalnız doğrulanmış safe projection döndürür. `doc.data()` nesnesi doğrudan API modeli olarak kullanılmaz.

## Bilinen sınır ve sonraki paket

`SecurityAlertService` dedupe/rolling-window state'i halen process-local bellektedir. Durable sink alert aggregate'lerini restart-safe saklar; servis restartları arasında aynı dedupe grubunu sürdürmez. Bunun çözümü bu paketin dışında ayrı state/bridge tasarımı gerektirir.

Bu pakette:

- `server.js` runtime wiring'i yoktur;
- Phase 6 abuse/auth akışından Phase 8 alert service'e operational bridge yoktur;
- yeni API endpoint veya Platform Admin UI görünürlüğü yoktur;
- provider, staging veya production mutationı yoktur.

Paket 6B-2, explicit onay ve fail-closed startup/operational hata politikasıyla runtime bridge/wiring, tenant-bound read visibility ve gerekli migration/rollback sözleşmesini ele almalıdır.
