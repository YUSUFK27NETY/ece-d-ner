# Platform V2 — Second-Tenant Acceptance & Launch Runbook

Issue: #45 / P9-6

## Amaç ve kapsam

Bu runbook, ikinci bir işletmenin yeni repo, kod kopyası, tenant-başı backend
deployment veya Ece Döner V1 bağı olmadan mevcut merkezi Platform V2 akışıyla
onboard edilebildiğini doğrular.

Repo içindeki P9-6 paketi yalnız sentetik verili otomatik acceptance testleri ve
bu operasyon prosedüründen oluşur. Canlı staging'e bağlanmaz; provider, billing,
DNS/SSL/WAF, identity-provider veya production backup mutationı çalıştırmaz.

Durable tenant durumları değişmez:

```text
provisioning | active | suspended | archived
```

`ready` bir durable durum değildir. Activation readiness, P9-1'in türetilmiş ve
salt-okunur `pending|ready|blocked|unavailable` modelidir.

## Kanıt ve veri güvenliği

- Yalnız sentetik tenant, actor, request ve subject referansları kullan.
- Gerçek müşteri adı, iletişim bilgisi veya başka PII kullanma.
- Credential, secret, token, şifre, private key veya provider response body'yi
  chat, log, issue, ekran görüntüsü ya da acceptance kaydına yapıştırma.
- Kanıtta yalnız commit SHA, sentetik tenantId, UTC zaman, HTTP status, güvenli
  server code, boolean sonuç ve sayısal toplamları tut.
- Raw request/response gövdelerini veya provider konsol çıktısını kanıta ekleme.

Önerilen sentetik kimlikler `p9-baseline-synthetic` ve
`p9-second-synthetic` biçimindedir. Çakışma varsa aynı tenantId doğrulama
kurallarına uyan başka sentetik değer seçilir; gerçek işletme adı kullanılmaz.

## Gate sınıfları

| Gate | Nerede | Bu paket çalıştırır mı? | Başarı ölçütü |
| --- | --- | --- | --- |
| Repo acceptance | Yerel/CI | Evet | Focused testler ve full CI yeşil |
| Live staging smoke | Önceden yapılandırılmış staging | Hayır | Aşağıdaki checklist kanıtla tamamlanır |
| Controlled external | Provider/operasyon sistemleri | Hayır | Ayrı onay, change kaydı ve least-privilege operasyon |

Bir alt gate başarısızsa üst gate tamamlanmış sayılmaz. `unavailable` veya
`pending` sonucu başarıya çevrilmez ve sahte `ready` kanıtı yazılmaz.

## Repo-automated acceptance gates

Repository kökünde sırayla çalıştır:

```text
node --test platform-v2/tests/phase9-second-tenant-acceptance.test.js
npm run ci
npm ls --omit=dev --omit=optional
npm audit
npm run security:secrets
```

Focused testler şu sınırları doğrular:

1. Aynı registry/onboarding servisi ilk tenantı değiştirmeden ikinci tenantı
   `provisioning` durumunda oluşturur ve audit korelasyonunu korur.
2. Duplicate create `TENANT_ALREADY_EXISTS` ile fail-closed kalır.
3. Cross-tenant authorization ve Firestore path girişimleri reddedilir.
4. Update yalnız hedef tenantı değiştirir; `tenantId` yapısal alanı değişmez.
5. Readiness eksik kaynakta `unavailable`, genuine ready kaynaklarda P9-1
   aggregate/canActivate semantiğini üretir.
6. Plan preview yalnız `config.plans` kataloğunu kullanır, read-only kalır ve
   bilinmeyen hedef planı reddeder.
7. Member bootstrap yalnız external identity work gerektiren intent üretir;
   invitation/enrollment çağrısı yapmaz.
8. Domain metni tek başına `verified` üretmez.
9. Security Alerts exact tenant scope'ta; Security Posture platform scope'ta ve
   her iki HTTP yüzeyi GET-only kalır.
10. Suspend/resume provası yalnız mevcut durumlarla yapılır; archived tenant
    activation için fail-closed kalır.
11. Catalog/order/admin path ve yetki kontrolleri aynı tenant sınırını kullanır;
    V1 veya tenant-specific runtime yolu eklenmez.

Full CI içindeki secret scanner tracked files ile Git history'yi tarar. Scanner
invariantı değişmez: yalnız tam private-key block finding üretir; tek başına
header finding üretmez. Test fixture'ı için global allowlist istisnası eklenmez.

## Live staging ön koşulları

Bu bölüm yalnız zaten yapılandırılmış ve production'dan fiziksel olarak ayrılmış
Platform V2 staging ortamında, yetkili operatör tarafından uygulanır.

- Staging runtime commit SHA'sı acceptance edilen SHA ile eşleşir.
- Platform Admin erişimi önceden ve ayrı güvenli kanaldan yapılandırılmıştır.
- İki tenant da sentetiktir; baseline tenant production müşterisi değildir.
- Kullanılacak plan kimlikleri canlı `GET /api/platform/plans` sonucundan seçilir.
- Backup/domain/security kaynaklarında evidence yoksa beklenen sonuç
  `pending|unavailable` olarak kaydedilir.
- Gerçek provider konsolu veya credential işlemi bu checklist'in parçası değildir.

## Live staging second-tenant checklist

1. **Baseline al:** `p9-baseline-synthetic` için tenant detail, operations,
   tenant Security Alerts ve ilgili audit özetini oku. Yalnız güvenli alanları
   kaydet; baseline tenant üzerinde mutation yapma.
2. **İkinci tenantı oluştur:** Mevcut merkezi Platform Admin create yoluyla
   `p9-second-synthetic` oluştur. Durable durumun `provisioning` olduğunu ve
   audit kaydında sentetik actor/request/tenant korelasyonunu doğrula.
3. **Duplicate negatifini çalıştır:** Aynı create isteğini tekrar gönder.
   `TENANT_ALREADY_EXISTS`/eşdeğer güvenli conflict sonucunu, kayıt sayısının
   artmadığını ve baseline tenantın değişmediğini doğrula.
4. **Profili güncelle:** İkinci tenantta yalnız sentetik marka, timezone ve diğer
   yapısal olmayan profil alanlarını mevcut PATCH yoluyla güncelle. `tenantId`
   veya sektör değişikliği denemesinin fail-closed olduğunu doğrula.
5. **Plan preview yap:** Plan kimliklerini yalnız canlı config-driven catalogdan
   seç. Geçerli hedef için preview al; `automaticApply=false` ve persisted planın
   değişmediğini doğrula. Catalog dışı sentetik hedefin güvenli 400 ile
   reddedildiğini doğrula.
6. **Admin bootstrap durumunu incele:** P9-3 contract intent'i mevcut kontrollü
   test adapterıyla değerlendir. Sonuç `external_identity_required` ise bunu açık
   blocker olarak kaydet; gerçek invitation/enrollment yapma.
7. **Domain truthfulness kontrolü:** Sentetik ve zararsız bir domain metadata'sı
   kaydedilmiş olsa bile trusted verification evidence yoksa `verified`
   görünmediğini doğrula. DNS/SSL kaydı oluşturma veya değiştirme.
8. **Customer Readiness'i oku:** Exact ikinci tenant endpointinden yedi source
   kartını incele. Required kaynaklardan biri `blocked|unavailable|pending` ise
   `canActivate=false` bekle ve aktivasyon yapma. Current runtime'da plan,
   adminBootstrap veya security adapterı bağlı değilse bunların `unavailable`
   kalması doğrudur; bu sonucu değiştirmek P9-6 scope'u değildir.
9. **Operations/Backup görünürlüğünü kontrol et:** İkinci tenant operations
   özetinin exact tenantId taşıdığını doğrula. Verified backup evidence yoksa
   `unknown|pending|unavailable` sonucu kabul et; production schedule veya
   credential işlemi yapma.
10. **Security görünürlüğünü kontrol et:** İkinci tenant Security Alerts GET
    sorgusunun yalnız ikinci tenant sonuçlarını döndürdüğünü doğrula. Forged
    first-tenant scope reddedilmelidir. Security Posture'un platform-scoped ve
    read-only olduğunu; mutation methodlarının bulunmadığını doğrula.
11. **Catalog/order/admin smoke yap:** Yalnız mevcut staging müşteri akışı zaten
    bağlıysa, ikinci tenant için sentetik catalog item ve sentetik order smoke'u
    çalıştır. Oluşan pathlerin `tenants/p9-second-synthetic/...` altında kaldığını
    ve baseline tenantta görünmediğini doğrula. Ayrı repo veya deployment açma.
12. **Cross-tenant regresyonu yap:** İkinci tenant context'iyle baseline tenantın
    detail, catalog, order, operations ve security kaynaklarına erişim denemeleri
    fail-closed olmalıdır. Başarılı tek bir forged erişim hard stop'tur.
13. **Aktivasyonu kontrollü yap:** Yalnız `canActivate=true` genuine sonucu ve
    gerekli operasyon onayı varsa mevcut Platform Admin lifecycle update'iyle
    `active` yap. Readiness sonucu mutation değildir; otomatik aktivasyon yoktur.
14. **Suspend/resume provası yap:** İkinci tenantı açıkça `suspended` yap;
    `canActivate=false` ve baseline etkisiz olmalıdır. Abort nedeni giderilmiş,
    readiness yeniden doğrulanmış ve onay verilmişse yalnız mevcut `active`
    durumuna explicit dönüşü prova et; yeni bir rollback durumu uydurma.
15. **Archive/handoff yap:** Provayı tamamladıktan ve kanıtı aldıktan sonra ikinci
    tenantı önce `suspended`, sonra `archived` yap. Archived kayıtta
    `canActivate=false` doğrula. Otomatik reactivation, silme veya provider cleanup
    çalıştırma; sonraki işlem ayrı kontrollü lifecycle kararıdır.
16. **Baseline karşılaştır:** İlk adımda alınan baseline ile tenant detail,
    catalog/order toplamları, operations, alerts ve audit scope'unu karşılaştır.
    İlk tenantta P9-6 kaynaklı değişiklik olmamalıdır.

Checklist, yalnız tüm applicable sonuçlar kanıtlıysa geçer. Ortamda bağlı olmayan
bir source veya müşteri-facing akış varsa gate açık kalır; test sonucu uydurulmaz.

## Abort ve rollback kriterleri

Aşağıdakilerden biri hard stop'tur:

- herhangi bir cross-tenant veri veya yetki sızıntısı;
- beklenmeyen otomatik plan, billing, lifecycle veya customer disable mutationı;
- evidence olmadan `ready`, `verified`, `healthy` veya başarılı backup sonucu;
- provider-side DNS/SSL/WAF/IAM/invitation/backup-schedule yazması;
- credential, secret, token, şifre, private key, raw body veya gerçek PII sızıntısı;
- Ece Döner V1 veya baseline tenant üzerinde beklenmeyen değişiklik;
- tenant-specific repo, fork, backend veya deployment gereksinimi;
- actor/request/tenant audit korelasyonunun kaybolması.

Hard stop halinde:

1. Yeni mutationları durdur; kanıtı güvenli code/status/UTC zamanı ile kaydet.
2. Tenant henüz active değilse `provisioning` durumunda bırak ve activate etme.
3. Active ise mevcut yetkili lifecycle yoluyla `suspended` yap; otomatik rollback
   veya provider işlemi çalıştırma.
4. Baseline tenantı değiştirme, kayıt silme veya audit geçmişini temizleme.
5. Sorun giderildikten sonra repo gates ve readiness'i baştan çalıştır.
6. Resume yalnız mevcut `active` durumu ile explicit ve onaylıdır. `rollback`,
   `restored` veya `ready` adlı yeni durable durum oluşturma.
7. `archived` tenantı bu runbook ile yeniden aktive etme; ayrı lifecycle kararı ve
   yeni acceptance kanıtı iste.

## Controlled external operations — bu paket çalıştırmaz

Aşağıdaki işler repository acceptance'ının dışında, ayrı onay ve operasyon
kaydına tabidir:

- gerçek DNS kaydı, custom-domain ownership ve SSL certificate işlemleri;
- WAF/Cloudflare/bot/DDoS policy değişiklikleri;
- credential/secret oluşturma, erişme, rotation veya revoke;
- billing, fiyat, tahsilat veya tenant plan mutationı;
- provider IAM/role/policy değişiklikleri;
- production backup schedule, retention/lifecycle veya restore apply;
- gerçek identity-provider invitation/enrollment;
- shard/database/queue/CDN veya tenant-specific deployment provisioning;
- Ece Döner V1 migrationı ya da production cutover.

Bu operasyonların eksikliği staging sonucunda açık blocker olarak yazılır; repo
testiyle tamamlanmış gibi gösterilmez.

## Güvenli acceptance kaydı

Her gate için yalnız şu alanları kaydet:

```text
commitSha
environment=staging
syntheticTenantId
gateName
result=passed|failed|blocked|unavailable
safeCode
observedAtUtc
requestCorrelationId
operatorOpaqueId
```

Serbest metin gerekiyorsa yalnız güvenli özet kullan. Raw HTTP/provider çıktısı,
request body, kullanıcı verisi veya herhangi bir gizli değer ekleme.

## Handoff

Handoff sırasında repo gate sonuçları, açık staging gate'leri, safe audit
korelasyonları ve controlled-external blocker listesi paylaşılır. Phase 9 ancak
repo acceptance ile birlikte gerçek staging checklist'i yeşil olduğunda; bütün
required readiness kaynakları genuine evidence sunduğunda ve yeni repo/deployment
gerektirmediği canlı olarak doğrulandığında launch-ready sayılır.
