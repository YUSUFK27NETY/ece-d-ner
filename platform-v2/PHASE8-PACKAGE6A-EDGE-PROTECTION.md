# Phase 8 Paket 6A — Edge Protection & Abuse Operations Baseline

Bu belge Platform V2 için provider-neutral edge protection ve abuse operasyon sınırını tanımlar. Mevcut uygulama kontrollerini envanterler; yeni bir runtime kontrolü etkinleştirmez.

## A. Kapsam ve güvenlik sınırı

- Bu baseline, Internet ile Platform V2 arasındaki DDoS, bot, WAF ve rate-limit katmanlarının birlikte nasıl işletileceğini tanımlar.
- Gerçek WAF, DDoS veya bot provider aktivasyonu ve kural değişikliği bu paketin dışındadır ve ayrıca onaylanmış bir operasyon gerektirir.
- Ece Döner V1 runtime'ı, veri yolları ve deployment yapısı bu kapsamdan etkilenmez.
- Repo event/alert modellerine secret, provider credential, ham kimlik doğrulama verisi veya kişisel veri eklenmez.
- Provider edge katmanı uygulama authentication, RBAC, tenant isolation veya business authorization kontrollerinin yerine geçmez.

## B. Mevcut uygulama kontrolleri

Mevcut `create-platform-app.js` akışında `/api/platform` ağacına şu global admin limiter uygulanır:

- 15 dakikada en fazla 300 istek;
- standard rate-limit headerları açık, legacy headerlar kapalı;
- limit aşımında güvenli bir `429` yanıtı.

`/api/platform/tenants/:tenantId` ağacı global limiter ve Platform Admin doğrulamasından sonra ikinci, tenant-scoped limiter katmanını kullanır. Runtime bu katmana merkezi `adminTenant` policy'sini bağlar:

- sustained: 15 dakikada 180 istek;
- burst: 60 saniyede 60 istek;
- sayaç anahtarı `admin_tenant + tenantId` ile tenant-bound tutulur;
- limit aşımı yalnız ilgili isteği `429` ile reddeder ve güvenli `rate_limit_exceeded` security signal'ı üretilebilir.

Merkezi config ayrıca bir `public` policy taşır:

- sustained: 60 saniyede 120 istek;
- burst: 10 saniyede 30 istek.

Bu `public` policy şu anda hiçbir customer/public API route'una runtime'da bağlı değildir. Bir config kontratının bulunması enforcement anlamına gelmez; gelecekteki public/customer surface ayrıca ve açıkça middleware'e bağlanmadan bu limit aktif kabul edilmemelidir.

JSON request body limiti `32kb`'dır. Büyük body `413`, bozuk JSON `400` ile reddedilir. Tüm Platform V2 response'larında temel güvenlik headerları ve `Cache-Control: no-store` uygulanır. Admin statik handler'ı ETag ve beş dakikalık max-age ile yapılandırılmış olsa da mevcut üst middleware'in `no-store` politikası nedeniyle admin/control-plane içeriği shared edge cache için uygun kabul edilmemelidir.

## C. Endpoint sınıflandırma matrisi

| Endpoint | Exposure class | Authentication expectation | Application limiter | Provider edge expectation | Cache expectation | Abuse / security signal expectation |
|---|---|---|---|---|---|---|
| `/health` | Public operational liveness | Yok | Yok | Health-check trafiğini koru; onaylı probe'ları kesmeden volumetric abuse'u sınırla | `no-store` | Mevcut route doğrudan signal üretmez; anormal hacim provider gözlemi olarak ele alınır |
| `/ready` | Public operational readiness | Yok | Yok | Onaylı readiness probe'larına izin ver; dış abuse'u uygulama semantiğini bozmadan sınırla | `no-store` | `200 ready` veya güvenli `503 not_ready`; route doğrudan signal üretmez |
| `/admin` | Public admin shell girişi | Shell için yok; yönetim verisi için sonradan Platform Admin login gerekir | Yok | Bot/scanner ve admin probing gözlemi; provider kuralı gerçek kullanıcı login akışını bozmamalı | Shared edge cache yok; `no-store`, ETag mevcut | Mevcut statik route doğrudan signal üretmez |
| `/admin/**` | Public admin static surface | Statik içerik için yok; API erişimi ayrı token doğrulamasına tabidir | Yok | Bot/scanner ve asset flood gözlemi | Shared edge cache yok; mevcut response politikası `no-store` | Mevcut statik route doğrudan signal üretmez |
| `/admin/config.js` | Public client bootstrap config | Yok; yalnız yayınlanabilir Firebase web config beklenir | Yok | Enumeration/probing izlenebilir; provider kuralı config'e secret ekleyemez | `no-store` | Route doğrudan signal üretmez; response secret/provider credential taşımamalı |
| `/api/platform/**` | Control plane | Geçerli Firebase ID tokenı ve `platformAdmin: true` | Global: 300 / 15 dakika | Sıkı WAF/bot/probing koruması; auth ve RBAC'ı ikame etmez | `no-store` | Runtime `AbuseMonitor` tekrarlanan `401/403` olaylarını güvenli Phase 6 signal'larına dönüştürür |
| `/api/platform/tenants/:tenantId/**` | Tenant-bound control plane | Platform Admin doğrulaması; handler katmanında tenant/business authorization | Global 300 / 15 dakika **ve ek olarak** tenant sustained 180 / 15 dakika, burst 60 / 60 saniye | Global control-plane koruması; tenant kimliğine göre edge trust çıkarımı yapma | `no-store` | Tenant limit aşımı `rate_limit_exceeded`; boundary ihlali yalnız doğrulanmış kaynak tenant altında kaydedilmeli |
| Gelecekteki public/customer API surface | Henüz bağlı olmayan data plane | Route türüne göre açıkça public veya doğrulanmış customer auth; varsayım yapılmaz | `public` policy config'te mevcut fakat runtime enforcement **yok** | Endpoint envanteri, bot/WAF ve volumetric policy ayrıca onaylanmalı | Auth/customer response'ları varsayılan `no-store`; yalnız açıkça güvenli public içerik ayrıca incelenebilir | Kalıcı central alert bridge kurulana kadar aktifmiş gibi raporlanmaz |

`/health` ve `/ready` unauthenticated operational endpointlerdir. Response'ları secret, token, PII, provider credential, ham provider error veya bağlantı bilgisini hiçbir zaman içermemelidir. Readiness hata yolu yalnız `not_ready` ve güvenli check metadata'sı döndürür.

Tenant-specific admin route'lar önce `/api/platform` global limiter'ından ve Platform Admin doğrulamasından geçer. Tenant limiter ek bir katmandır; global admin limitini gevşetemez veya bypass edemez.

## D. Katmanlı koruma matrisi

```text
Internet
  -> provider DDoS / bot / WAF layer
  -> application global limiter
  -> authentication / RBAC
  -> tenant-scoped limiter
  -> handler / business authorization
```

Mevcut runtime'da tenant telemetry middleware'i authentication ile tenant limiter arasında gözlem üretir; güvenlik sırasını veya authorization kararını değiştirmez.

| Katman | Sorumluluk | Yerine geçemeyeceği kontrol |
|---|---|---|
| Provider DDoS/bot/WAF | Volumetric filtreleme, bilinen kötü otomasyon ve edge-level request policy | Token doğrulama, RBAC, tenant isolation |
| Global application limiter | Control-plane toplam istek basıncını sınırlama | Actor yetkisi ve tenant scope |
| Authentication/RBAC | Kimlik ve `platformAdmin` claim doğrulama | Tenant-bound business authorization |
| Tenant-scoped limiter | Noisy-neighbor izolasyonu ve tenant bazlı burst/sustained sınırı | Global limiter veya erişim yetkisi |
| Handler/business authorization | İşlem, tenant ve veri sınırını doğrulama | Üst katman trafik koruması |

Provider katmanı unavailable veya yanlış yapılandırılmış olsa bile uygulama auth/RBAC ve tenant isolation fail-closed kalmalıdır. Tersine, provider koruması başarılı diye uygulama kontrolü kaldırılmamalıdır.

## E. Provider-neutral WAF / DDoS / bot runbook

Her olay aynı kontrollü yaşam döngüsünü izler:

```text
detect -> classify -> contain -> observe -> verify -> rollback/tune -> post-event review
```

Contain veya tune adımları provider değişikliği gerektiriyorsa ayrıca operator onayı alınır. Repo içindeki bu doküman tek başına böyle bir değişikliği yetkilendirmez.

| Senaryo | Detect / classify | Contain | Observe / verify | Rollback / tune / review |
|---|---|---|---|---|
| Volumetric abuse | Request hacmi, edge saturation ve sağlıklı probe etkisini ayır | Onaylı provider DDoS kontrolü veya dar kapsamlı geçici kural planla | `/health`, `/ready`, latency ve hata oranını izle | False-positive etkisinde kuralı geri al/daralt; kapasite ve zaman çizelgesini review et |
| Bot/scanner traffic | Tekrarlanan path/method probing ve başarısız response örüntülerini sınıflandır | Yalnız doğrulanmış bot imzasına yönelik provider challenge/block planla | Admin shell ve gerçek kullanıcı akışını doğrula | Kural kapsamını veya eşiğini ayarla; bypass varsayımı bırakma |
| Credential stuffing / repeated auth failures | Runtime `401/403` signal'ları ve provider hacim metriğini korele et | Actor/tenant bağı kurmadan kör kalıcı block uygulama; onaylı geçici edge daraltması planla | Auth başarı oranı, false-positive ve alert dedupe durumunu izle | Eşiği geri al/tune et; auth olayını incident review'a taşı |
| Malformed request flood | `400`, unsupported content type ve parse hatası oranını izle | Method/content-type/body policy'sini onaylı edge kuralıyla daralt | Geçerli API isteklerini ve hata response güvenliğini doğrula | Uyumlu client etkisi varsa rollback; imza ve örnekleme politikasını review et |
| Oversized payload attempts | Uygulamanın `32kb` limiti ve `413` hacmini izle | Uygulama limitinden daha gevşek olmayacak provider body-size policy planla | Normal admin mutation boyutlarının etkilenmediğini doğrula | Provider eşiğini geri al/tune et; uygulama limitini bu paket kapsamında değiştirme |
| Admin endpoint probing | `/admin/**` ve `/api/platform/**` tarama örüntülerini ayır | Dar path/method kuralı, bot challenge veya kısa süreli rate rule planla | Admin login, bootstrap config ve control-plane API'yi doğrula | Meşru admin erişimi etkilenirse rollback; probing korelasyonunu review et |
| Tenant-boundary abuse | Yalnız doğrulanmış kaynak tenant context'indeki boundary signal'ını kullan | Gerçek tenantı veya başka tenantı URL girdisine dayanarak izole etme; incident planı üret | Cross-tenant read/write'ın fail-closed kaldığını doğrula | Yanlış scope sınıflamasını düzelt; audit/incident kanıtını review et |
| Rate-limit spikes | Global `429` ile tenant `rate_limit_exceeded` signal'ını ayır | Global ve tenant katmanlarını birbirinin yerine koymadan geçici provider kontrolü planla | `Retry-After`, tenant izolasyonu ve normal trafik iyileşmesini doğrula | Eşik/kuralı ayrı ayrı tune et; tenant limiter değerlerini bu docs commitinde değiştirme |

Repo security event/alert modeline IP adresi, ham token, `Authorization` headerı, request body, cookie veya PII eklenmez. Provider gözlemi repo modeline aktarılacaksa yalnız server-owned kategori, güvenli sayaç, zaman, request/correlation kimliği ve doğrulanmış tenant/actor scope gibi allowlist metadata kullanılmalıdır.

## F. Security signal ve central alert eşlemesi

Mevcut gerçek durum iki ayrı katmandır:

1. **Phase 6 runtime signal yolu:** Server, `AbuseMonitor` ile tekrarlanan `401/403` olaylarını sayar ve Firestore-backed security signal service'e `repeated_unauthorized` veya `forbidden` yazar. Tenant rate limiter `rate_limit_exceeded` üretebilir. Tenant-boundary signal sözleşmesi de mevcuttur.
2. **Phase 8 central alert çekirdeği:** `securityEventFromAuthFailure()` tekrarlanan `401/403` gözlemleri için, `securityEventFromTenantBoundary()` tenant-boundary ihlali için ve `securityEventFromStepUpDenial()` step-up denial için güvenli adapter sağlar. `SecurityAlertService` server-owned severity, rolling threshold, dedupe ve correlation davranışını uygular.

Phase 8 central alert service ve `InMemorySecurityAlertSink` mevcut server runtime'ına production persistence olarak bağlı değildir. In-memory sink yalnız test/provider-neutral adapterdır; restart-safe veya production-grade kalıcılık olarak sunulamaz. Phase 6 signal yolunun bulunması da Phase 8 central alert persistence/visibility zincirinin tamamlandığı anlamına gelmez.

| Kaynak | Mevcut güvenli mapping | Runtime/persistence durumu |
|---|---|---|
| Tekrarlanan admin `401/403` | Phase 6 signal ve Phase 8 auth-failure adapter | Phase 6 yolu runtime'da bağlı; Phase 8 central alert bridge bağlı değil |
| Tenant-boundary ihlali | Phase 6 boundary signal sözleşmesi ve Phase 8 boundary adapter | Güvenli model mevcut; central alert persistence bağlı değil |
| Step-up denial | Phase 8 step-up denial adapter | Reusable model mevcut; runtime alert bridge bağlı değil |
| Tenant rate-limit aşımı | `rate_limit_exceeded`, warning, policy scope ve reason code | Tenant limiter runtime'ında Phase 6 signal olarak bağlı |
| Provider edge olayı | Henüz server-owned operational adapter/persistence yok | Aktifmiş gibi raporlanmamalı |

Kalıcı provider-neutral alert persistence, Phase 6 signal ile Phase 8 alert çekirdeği arasındaki kontrollü operational bridge ve Platform Admin salt-okunur görünürlüğü Paket 6B için açık gap'tir. Bu devam işi tenant/platform scope ayrımını, RBAC'ı, dedupe kimliğini, retention sınırını ve migration/rollback planını korumalıdır.

## G. External controlled actions

Aşağıdaki işlemlerin hiçbiri bu committe uygulanmaz:

- Cloudflare WAF, bot veya DDoS kuralları;
- provider rate-limit kuralları;
- DNS veya firewall değişiklikleri;
- Render service/deployment ayarları;
- Firebase IAM veya Auth ayarları;
- GitHub ruleset ya da branch protection ayarları;
- R2 veya başka provider credential değişiklikleri;
- staging veya production environment ayarları.

Bu değişiklikler gerektiğinde hedef environment, owner, onay, gözlem penceresi, doğrulama ve rollback adımı ayrı kaydedilerek yürütülmelidir.

## H. Doğrulama ve rollback

Paket 6A repo-side değişikliği yalnız documentation baseline'dır. Runtime route, limiter, alert wiring, provider adapter, environment veya production davranışı değiştirilmez.

Repo doğrulaması:

1. diff yalnız bu dokümanı ve Platform V2 README referansını içermeli;
2. `npm.cmd run ci` tamamen geçmeli;
3. `npm audit` sıfır vulnerability göstermeli;
4. `npm.cmd run security:secrets` takip edilen dosyalar ve Git geçmişi için temiz olmalı;
5. CycloneDX SBOM üretilip `scripts/validate-sbom.js` ile doğrulanmalı;
6. dependency değişmediği için component baseline'ı 101 kalmalı;
7. üretilen `sbom.cdx.json` çalışma ağacında bırakılmamalı.

Rollback, yalnız bu docs commitinin revert edilmesidir. Runtime veya provider rollback'i gerekmemeli; production ve staging üzerinde davranış etkisi olmamalıdır.
