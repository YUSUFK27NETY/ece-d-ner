# Phase 8 Paket 7A — Security Posture Read Model

Bu paket Platform Admin için provider-neutral ve yalnız okunabilir güvenlik görünürlüğü sağlar:

```text
GET /api/platform/security-posture
```

Endpoint mevcut Platform Admin kimlik doğrulama zincirinin arkasındadır. Mutation,
provider çağrısı veya operasyon yürütmez.

## Gerçek kaynak denetimi

| Alan | Sınıf | Runtime durumu |
| --- | --- | --- |
| Central security alerts | `DURABLE_RUNTIME` | Mevcut Firestore reader ile yalnız `tenantId: null` platform kayıtları okunur. |
| Step-up | `CONTRACT_ONLY` | Policy/config hazırdır; production enforcement çağrı noktası bağlı değildir. |
| Secret lifecycle | `CONTRACT_ONLY` | Provider-neutral model ve in-memory test adapterı vardır; server reader'ı yoktur. |
| Incident response | `CONTRACT_ONLY` | Model ve in-memory test adapterı vardır; server reader'ı yoktur. |
| Break-glass | `CONTRACT_ONLY` | Core/integration ve in-memory test adapterı vardır; production runtime'a bağlı değildir. |
| SBOM / CodeQL | `EXTERNAL_VERIFICATION_REQUIRED` | Repository workflow baseline'ları vardır; canlı GitHub workflow sonucu runtime'da okunmaz. |

İn-memory secret lifecycle, incident veya break-glass store'ları görünürlük doldurmak
için server startup'ına bağlanmaz.

## Source-state ve görünürlük semantiği

Read model küçük canonical source-state sözlüğünü kullanır: `active`,
`contract_only`, `not_wired`, `external_verification_required`, `unavailable`.
Gerçek kaynağı bağlı olmayan sayaçlar `0` değil `null` döner. `0`, yalnız aktif
bir reader gerçekten boş sonuç verdiğinde anlamlıdır.

Durable alert reader çalıştığında `recentVisibleCount`, `highestSeverity` ve
`lastSeenAt` yalnız limitli platform-scope sonuçlarını özetler. Bu değer toplam
alert sayısı değildir ve tenant alertleri platform görünürlüğüne fan-out edilmez.
Reader hatası ya da malformed kayıt alerts kaynağını `unavailable`, genel durumu
`degraded` yapar. Diğer contract-only kaynaklar nedeniyle çalışan alert reader ile
bile genel durum `partial_visibility` olur; `healthy` üretilmez.

## Identity ve supply-chain sınırları

Step-up contract readiness gerçek enforcement değildir. Response bu nedenle
`contractStatus: ready`, `runtimeEnforcement: not_wired` ve
`elevatedSessionStatus: unavailable` döner. MFA/passkey contract readiness gerçek
kullanıcı enrollment'ı değildir; enrollment görünürlüğü `unavailable` kalır.

SBOM ve CodeQL workflow dosyalarının repository baseline'ı `configured` olabilir,
ancak bu canlı workflow sonucunun başarılı olduğu anlamına gelmez.
`liveWorkflowStatus` her zaman `external_verification_required` kalır; endpoint
GitHub API çağrısı veya `npm audit` çalıştırmaz.

## Güvenlik kontratı

Response yalnız explicit allowlist alanlarını içerir. Raw alert kayıtları, provider
payload'ları, exception mesajları, request body, token, credential, secret, PII,
Firebase claim veya environment değerleri döndürülmez. Service'in tamamı çökerse
API yalnız generic 500 mesajı ve generic log üretir.

Rollback için service wiring'i ve route'u kaldırmak yeterlidir; durable security
alert verisi veya diğer Phase 8 contract'ları değişmez. Sonraki Paket 7B, bu read
model için Platform Admin UI görünürlüğünü ekleyecektir.
