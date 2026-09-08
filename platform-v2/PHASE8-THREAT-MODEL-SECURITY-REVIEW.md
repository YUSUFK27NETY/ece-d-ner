# Phase 8 — Threat Model, Security Review & Pentest Readiness

Bu belge Platform V2 Phase 8 için repo-temelli threat model, security review, pentest readiness checklist ve büyük değişikliklerde kullanılacak security-impact template'ini tanımlar. Amaç olmayan bir kontrolü aktifmiş gibi göstermeden mevcut güvenlik sınırlarını, kalan riskleri ve doğrulama adımlarını tek yerde toplamaktır.

## 1. Kapsam ve değişmez sınırlar

Kapsam:

- Platform V2 merkezi Admin API ve `/admin/` kontrol düzlemi
- tenant registry ve `tenants/{tenantId}/...` veri sınırı
- authentication, RBAC, tenant isolation ve step-up contract'ı
- security signals, durable central security alerts ve read-only security visibility
- backup/restore, placement/routing/migration, queue/cache ve provider resilience
- secret lifecycle, incident response ve break-glass contract'ları
- GitHub governance, dependency policy, CodeQL ve SBOM baseline'ı

Kapsam dışı / ayrı kontrollü operasyon:

- production/staging provider mutation
- gerçek WAF/DDoS/bot kuralı aktivasyonu
- credential/key/token rotate veya revoke
- DNS/firewall/IAM değişikliği
- gerçek MFA/passkey enrollment veya provider adapter kurulumu
- otomatik production deploy override

Ece Döner V1 ayrı runtime/veri sınırında kalır; bu threat model V1'i otomatik olarak V2'ye taşımaz.

## 2. Gerçek güvenlik durumu

Threat model yalnız mevcut repo/runtime gerçeğini temel alır:

| Alan | Gerçek durum | Güvenlik sonucu |
| --- | --- | --- |
| Tenant isolation / RBAC | Runtime kontrolleri mevcut | Cross-tenant erişim fail-closed kalmalıdır. |
| Admin auth | Firebase ID token + strict `platformAdmin === true` | Control-plane API anonim veya normal tenant actor'a açık değildir. |
| Step-up | Contract hazır, production enforcement call-site bağlı değil | Readiness vardır; gerçek elevated-session enforcement varmış gibi kabul edilmez. |
| Central security alerts | Firestore-backed durable runtime | Platform-scope ve tenant-scope safe alert persistence/read yolu vardır. |
| Tenant-boundary central alert | Güvenli contract mevcut; gerçek runtime call-site yok | Detection capability contract-only kabul edilir. |
| Secret lifecycle | Contract/in-memory test adapterı | Canlı rotation health kaynağı bağlı değildir. |
| Incident response | Contract/in-memory test adapterı | Canlı incident store/reader bağlı değildir. |
| Break-glass | Core/integration contract'ı mevcut | Production runtime session/audit kaynağı bağlı değildir. |
| Edge WAF/DDoS/bot | Provider-neutral policy/runbook | Gerçek provider enforcement ayrıca doğrulanmalıdır. |
| SBOM / CodeQL | Repository baseline mevcut | Canlı workflow sonucu external verification gerektirir. |

Bu nedenle Platform Admin Security Posture görünürlüğünün `partial_visibility` üretmesi normaldir. Kaynağı bağlı olmayan sayaçlar `0` değil `null/unavailable` olarak değerlendirilir.

## 3. Korunacak varlıklar

### 3.1 Kimlik ve yetki varlıkları

- Platform Admin kimliği ve `platformAdmin` claim doğrulaması
- tenant actor/role/permission bağlamı
- re-auth freshness ve doğrulanmış factor metadata contract'ı
- break-glass actor/approver/reason/expiry/audit metadata'sı

### 3.2 Tenant veri varlıkları

- `tenants/{tenantId}/...` iş verisi
- tenant audit kayıtları
- tenant usage/security signal kayıtları
- backup objeleri ve restore evidence
- queue/cache/routing state'leri

### 3.3 Platform control-plane varlıkları

- `platformTenants/{tenantId}` registry
- `platformTenantPlacements/{tenantId}` placement metadata'sı
- platform-scope security alerts
- admin API ve read-only security visibility
- deployment/governance evidence

### 3.4 Supply-chain ve secret varlıkları

- `package-lock.json` dependency graph
- GitHub Actions workflow tanımları
- SBOM/provenance evidence
- provider credentials, signing material ve backup encryption keyleri

Secret/key/token değerleri threat-model evidence veya telemetry değildir; repo, log, chat, UI ve security alert payload'larına taşınmamalıdır.

## 4. Trust boundaries

```text
[Untrusted Internet / Browser]
        |
        | TB-1: Edge / HTTP boundary
        v
[/admin static shell + /api/platform]
        |
        | TB-2: Authentication / Platform Admin boundary
        v
[Control-plane handlers/services]
        |
        | TB-3: Tenant authorization boundary
        v
[tenant-aware data/services]
        |
        +--> TB-4 Firestore/storage provider boundary
        +--> TB-5 routing/placement/migration boundary
        +--> TB-6 queue/cache isolation boundary

[GitHub contributor/PR]
        |
        | TB-7 Supply-chain / CI boundary
        v
[lockfile + workflows + build/SBOM evidence]

[Operator]
        |
        | TB-8 External controlled-action boundary
        v
[WAF/DNS/IAM/credentials/deploy settings]
```

### TB-1 — Internet → Platform HTTP

Untrusted: URL, method, query, headers, request body, path tenantId, timing ve request hacmi.

Kontroller: body-size limiti, strict JSON, CSP/security headers, global/tenant rate limiting, CORS, server-generated request ID, provider-neutral edge policy.

### TB-2 — HTTP → authenticated Platform Admin

Untrusted: bearer tokenın kendisi ve client tarafından taşınan claim/risk/freshness beyanları.

Kontroller: revoked-token doğrulaması, strict Platform Admin claim, server-owned actor context, 401/403 central alert observation.

### TB-3 — actor → tenant scope

Untrusted: hedef tenant path/query/body bilgisi.

Kontroller: canonical tenantId validation, permission + tenant scope, tenant-bound data path, source-tenant trust rule ve cross-tenant regression testleri.

### TB-4 — application → provider/storage

Provider sonucu güvenilir iş verisi gibi körlemesine yayılmaz. Adapterlar provider payload/error/detail'ını safe projection'a dönüştürmelidir. Credential ve provider configuration values application response'una taşınmaz.

### TB-5 — logical tenant → physical placement/migration

Client fiziksel database/placement seçemez. Routing registry trusted source'tur. Migration dry-run, backup/readiness/copy/verify/apply gate'lerinden geçmeden cutover yapmamalıdır.

### TB-6 — shared queue/cache

Tenant kimliği queue idempotency/concurrency ve private cache keylerinde birinci sınıf sınırdır. Başka tenantın key/state'i reuse edilmemelidir. Shared cache yalnız açıkça güvenli public içerik içindir.

### TB-7 — contributor → build/deployment evidence

PR, dependency ve workflow değişiklikleri trusted production code'a doğrudan eşit değildir. CODEOWNERS/review policy, lockfile, npm audit, CodeQL ve SBOM ayrı kontrollerdir.

### TB-8 — repository → provider control plane

Repository policy gerçek provider enforcement değildir. WAF, DNS, IAM, credential rotation, branch/ruleset ve production deploy approval ayrı operator kontrollü adımlardır.

## 5. Entry points

Ana giriş noktaları:

- `/admin`, `/admin/**`, `/admin/config.js`
- `/api/platform/**`
- `/api/platform/tenants/:tenantId/**`
- `/health`, `/ready`
- gelecekteki public/customer API surface
- tenant onboarding/update mutationları
- backup/restore ve migration operator akışları
- queue/cache/routing service çağrıları
- GitHub PR/dependency/workflow değişiklikleri
- external provider configuration işlemleri

`/health` ve `/ready` public operational endpointlerdir; secret, PII veya provider detail döndürmemelidir. Admin shell public olabilir; yönetim verisi ve mutationlar authenticated API arkasında kalır.

## 6. Tehdit senaryoları ve mitigations

Risk sınıfları: **Critical**, **High**, **Medium**, **Low**. Rating residual risk'i ve gerekli doğrulama önceliğini ifade eder; otomatik exploitability skoru değildir.

### T-01 — Cross-tenant read/write veya tenant identity spoofing

**Risk:** Critical

**Senaryo:** Saldırgan path/body/query içindeki tenantId'yi değiştirerek başka tenantın verisine, usage/security kayıtlarına, backup state'ine veya operational metadata'sına erişmeye çalışır.

**Mevcut mitigations:**

- tenant business data yalnız `tenants/{tenantId}/...` altında;
- canonical tenantId validation;
- permission + tenant scope authorization;
- client tenantId tek başına authorization source değildir;
- tenant-scoped limiter/cache/queue/routing keyleri tenant-bound;
- tenant-boundary alert adapterı source tenantı trusted context'ten alır;
- cross-tenant/RBAC regression testleri.

**Detection:** boundary security signal/alert contract'ı, 403, audit/security telemetry.

**Residual risk:** tenant-boundary central alert runtime call-site henüz bağlı değildir; yeni service/adapter eklenirken tenant scope'un yanlış kaynaktan alınması en kritik regresyon riskidir.

**Pentest doğrulaması:** tenant A actor/credential ile tenant B read/write, encoded path, case/format varyasyonu, nested resource ve operational endpoint denemeleri fail-closed olmalı.

### T-02 — Platform Admin account takeover / privilege escalation

**Risk:** Critical

**Senaryo:** Çalınmış token, yanlış claim mapping, normal tenant actor'ın Platform Admin olarak kabulü veya yüksek riskli mutationın yeterli re-auth olmadan yürütülmesi.

**Mevcut mitigations:**

- revoked-token verification;
- strict `platformAdmin === true`;
- server-owned `req.platformActor`;
- 401/403 durable central alert bridge;
- provider-neutral step-up risk/freshness/factor contract;
- unknown operation fail-closed;
- break-glass contract'ında actor/approver/reason/expiry/audit sınırı.

**Residual risk:** step-up production enforcement call-site bağlı değildir; gerçek MFA/passkey enrollment/verification adapterı da bu fazda yoktur. Contract readiness gerçek enforcement değildir.

**Pentest doğrulaması:** missing/expired/revoked token, non-admin claim, forged freshness/factor, actor mismatch, unknown operation ve stale auth negatif testleri.

### T-03 — Credential stuffing, auth probing ve admin endpoint abuse

**Risk:** High

**Mevcut mitigations:** global admin limiter, repeated 401/403 observation, central alerts, body-size limit, generic auth errors, provider-neutral WAF/bot runbook.

**Residual risk:** gerçek provider-side bot/WAF/DDoS enforcement external controlled action'dır; uygulama limiter'ı volumetric DDoS çözümü değildir.

**Pentest doğrulaması:** bounded 401/403 burst, malformed Authorization, method/path probing; normal admin auth flow bozulmadan 401/403/429 semantics korunmalı.

### T-04 — Backup encryption key loss, premature retirement veya restore abuse

**Risk:** Critical

**Senaryo:** Backup key kaybı recovery'yi imkansızlaştırır; eski key erken retire edilir; restore yanlış tenant/hedef üzerine uygulanır.

**Mevcut mitigations:** tenant-bound backup key formatı, restore-before-production verification, secret lifecycle rotation/dual-key overlap/retention metadata contract'ı, retirement evidence gate, rollback yaklaşımı.

**Residual risk:** secret lifecycle canlı provider/read source olarak runtime'a bağlı değildir; gerçek key custody, escrow/recovery ve provider-side rotate/revoke operator sürecidir.

**Pentest/security review:** restore target isolation, tenant prefix, wrong-key/wrong-tenant failure, stale retention evidence ve rollback-required durumlarını doğrula. Gerçek key material test evidence'a konulmaz.

### T-05 — Supply-chain compromise

**Risk:** Critical

**Senaryo:** Zararlı dependency, lockfile manipulation, workflow permission escalation, unpinned action veya CI bypass ile trusted build etkilenir.

**Mevcut mitigations:** committed lockfile + `npm ci`, npm audit zero policy, CodeQL baseline, SHA-pinned GitHub Actions beklentisi, CODEOWNERS/reviewer ownership, SBOM workflow + validator, provenance metadata baseline.

**Residual risk:** repository baseline canlı workflow'un yeşil olduğunu kanıtlamaz; branch/ruleset enforcement ve live CodeQL/SBOM sonucu external verification gerektirir.

**Security review:** dependency graph diff, lifecycle scripts/native code, workflow permissions, action pinleri, lockfile-only değişiklikler ve build evidence ayrı incelenir.

### T-06 — Provider outage / dependency degradation

**Risk:** High

**Senaryo:** Firestore/storage/provider latency veya outage control-plane availability'yi bozar; retry storm/cascading failure oluşur.

**Mevcut mitigations:** readiness, bounded timeout/retry/backoff, circuit breaker/resilience service, dependency-specific health semantics, no raw provider error exposure.

**Residual risk:** provider tamamen unavailable olduğunda availability kaybı kabul edilen failure mode'dur; güvenlik kontrolü bypass edilmemelidir.

**Pentest/chaos doğrulaması:** timeout, transient failure, repeated provider error, circuit-open ve recovery akışlarında auth/tenant isolation fail-closed kalmalı.

### T-07 — Migration/cutover abuse veya wrong-tenant placement

**Risk:** Critical

**Senaryo:** Attacker-controlled destination, stale routing cache veya eksik verification ile yanlış tenant/shard'a cutover.

**Mevcut mitigations:** placement registry trusted source, additive logical/physical separation, versioned/idempotent migration, dry-run, backup/readiness/copy/verify/apply gate, exact tenant apply approval, rollback/forward-fix semantics.

**Residual risk:** operator/provider execution boundary ve migration evidence kalitesi kritiktir; tenantId fiziksel placement'tan türetilmemelidir.

**Pentest/security review:** wrong destination, stale revision, missing backup/readiness/verification, replayed transition ve cross-tenant destination testleri.

### T-08 — Cache poisoning / cross-tenant cache leakage

**Risk:** Critical

**Senaryo:** Tenant-private içerik shared cache key'e düşer veya invalidation yanlış tenantı etkiler.

**Mevcut mitigations:** tenant-bound private cache keys, exact tenant invalidation, shared cache yalnız güvenli public static içerik.

**Residual risk:** yeni cacheable endpoint eklenirken classification hatası.

**Pentest doğrulaması:** aynı resource ID iki tenantta farklı veri üretmeli; key collision ve cross-tenant invalidation veri sızdırmamalı.

### T-09 — Queue abuse / noisy neighbor / idempotency collision

**Risk:** High

**Senaryo:** Bir tenant queue kapasitesini tüketir, başka tenant job kimliğini replay eder veya concurrency/idempotency global anahtara yanlış bağlanır.

**Mevcut mitigations:** tenant-bound admission/concurrency/idempotency, queue/worker operational visibility, bounded capacity semantics.

**Pentest doğrulaması:** tenantlar arası aynı idempotency key, burst enqueue, retry/replay ve DLQ senaryoları scope'u aşmamalı.

### T-10 — Security alert poisoning, PII/secret leakage veya alert scope confusion

**Risk:** High

**Senaryo:** Client severity/eventType/count belirler, raw token/body/provider payload alert'e sızar veya target tenant attacker-controlled alert scope olur.

**Mevcut mitigations:** server-owned alert model/adapters, issued-object checks, explicit safe projection, Firestore persisted-record validation, source-tenant rule, read-only API/UI, XSS-safe DOM rendering.

**Residual risk:** yeni alert source adapterlarında allowlist ve trusted scope korunmalıdır; rolling dedupe state process-local sınırlıdır.

**Pentest doğrulaması:** forged alert, unknown persisted fields, malformed record, secret sentinel, attacker target tenant ve UI injection stringleri.

### T-11 — Incident/break-glass control misuse

**Risk:** High

**Senaryo:** Incident olmadan emergency access, self-approval, expiry bypass veya break-glass kararını gerçek provider/destructive mutation yetkisi gibi yorumlama.

**Mevcut mitigations:** reason/actor/approver/expiry/audit contracts, incident binding, step-up requirement, allowed elevated operation listesi, terminal/transition state validation.

**Residual risk:** incident ve break-glass production runtime/read source'a bağlı değildir. Contract varlığı canlı emergency access mekanizması olduğu anlamına gelmez.

**Security review:** runtime wiring eklenmeden önce separate approver, expiry, incident severity/state, actor binding ve audit persistence tekrar threat-model review'dan geçmelidir.

### T-12 — Secret/config leakage through errors, UI, logs or bootstrap

**Risk:** Critical

**Mevcut mitigations:** secret scanner tracked files + git history, safe error projection, security alert no-secret/no-PII contract, admin security posture/alerts read-only safe projection, public bootstrap yalnız publishable web config beklentisi.

**Pentest doğrulaması:** sentinel secret/token/body/provider-error değerlerinin API response, log, alert, SBOM/provenance ve admin DOM'a taşınmadığını doğrula.

### T-13 — Governance bypass / direct production mutation

**Risk:** High

**Senaryo:** force-push, disabled checks, direct deploy/provider mutation veya emergency bypass normal workflow gibi kullanılır.

**Mevcut mitigations:** CODEOWNERS/reviewer ownership baseline, protected-main beklentisi, deployment approval/runbook, bypass checklist, explicit operator approval.

**Residual risk:** GitHub ruleset/branch protection ve provider deployment approval repository dokümanıyla otomatik enforce edilmez; external verification gerekir.

### T-14 — Public/customer API gelecekte yanlış koruma varsayımı

**Risk:** High

**Senaryo:** Config'te public rate policy olduğu için yeni public API'nin otomatik korunuyor sanılması.

**Mevcut mitigations:** edge baseline public policy'nin runtime'a bağlı olmadığını açıkça kaydeder.

**Kural:** Yeni public/customer endpoint, authentication modelini, tenant resolution'ı, cache classification'ı, rate limiter wiring'ini ve abuse telemetry'sini security-impact review olmadan production-ready kabul edemez.

## 7. Security review — mevcut açık riskler

Aşağıdaki maddeler bug değildir; tamamlanma/operasyon sınırıdır ve yanlış iddia edilmemelidir:

1. **Step-up enforcement:** policy/alert contract hazır, live high-risk mutation enforcement bağlı değil.
2. **Secret lifecycle visibility:** contract mevcut, live provider-backed reader yok.
3. **Incident visibility:** contract mevcut, live durable incident store/reader yok.
4. **Break-glass visibility:** contract mevcut, production runtime store/audit reader yok.
5. **Provider edge enforcement:** WAF/DDoS/bot policy mevcut, gerçek provider kuralı external action.
6. **Supply-chain live state:** workflow baseline mevcut, canlı CodeQL/SBOM result runtime tarafından okunmuyor.
7. **Central alert rolling state:** persistence durable olsa da dedupe/rolling observation state process-local sınıra sahiptir; distributed-global dedupe iddiası yoktur.
8. **Public API limiter:** public policy config'te vardır fakat henüz customer/public API runtime'ına bağlı değildir.

Bu risklerin varlığı güvenlik görünürlüğünde `partial_visibility` semantiğinin korunma nedenidir.

## 8. Pentest readiness checklist

Pentest production üzerinde kontrolsüz yapılmaz. Tercih edilen hedef staging veya izole test environment'tır.

### 8.1 Ön koşullar

- [ ] Test edilecek commit SHA sabitlenmiş.
- [ ] Hedef environment ve owner açıkça kaydedilmiş.
- [ ] Production secret/credential test ekibine aktarılmıyor.
- [ ] En az iki tenant ve ayrılmış test actorları hazır.
- [ ] Platform Admin test actorı yalnız test environment için tanımlı.
- [ ] Test verisi gerçek müşteri PII içermiyor.
- [ ] Backup/restore ve migration testleri izole hedefte.
- [ ] Rate-limit/DDoS test hacmi önceden sınırlandırılmış.
- [ ] Monitoring/requestId/correlation evidence toplanabilir durumda.
- [ ] Rollback/stop condition belirlenmiş.

### 8.2 Authentication / authorization

- [ ] Missing, malformed, expired ve revoked tokenlar fail-closed.
- [ ] `platformAdmin !== true` control-plane erişimi alamıyor.
- [ ] Client claim/risk/freshness/factor beyanı trusted sayılmıyor.
- [ ] Tenant A actorı Tenant B read/write yapamıyor.
- [ ] Path/query/body tenantId çelişkileri yanlış scope üretmiyor.
- [ ] Unknown operation step-up contract'ında fail-closed.

### 8.3 HTTP / abuse / browser

- [ ] Oversized body `413`, malformed JSON `400` ve generic safe errors üretiyor.
- [ ] Global ve tenant limiter birbirini bypass etmiyor.
- [ ] CORS yalnız beklenen origin contract'ını izliyor.
- [ ] CSP/security headers admin yüzeyinde korunuyor.
- [ ] Admin alert/posture UI `innerHTML` veya raw object rendering kullanmıyor.
- [ ] XSS payloadları text olarak kalıyor.

### 8.4 Data isolation / platform services

- [ ] Firestore pathleri tenant-bound.
- [ ] Backup prefix/restore evidence yanlış tenantı kabul etmiyor.
- [ ] Routing cache başka tenant route'unu reuse etmiyor.
- [ ] Migration wrong-tenant/stale-state/replay senaryolarını reddediyor.
- [ ] Queue idempotency/concurrency tenantlar arasında çakışmıyor.
- [ ] Private cache cross-tenant leak üretmiyor.

### 8.5 Security operations

- [ ] Her gerçek admin 401/403 Phase 8 observation count'una yalnız bir kez giriyor.
- [ ] Phase 6 aggregate count Phase 8 count'a kopyalanmıyor.
- [ ] Forged security alert reddediliyor.
- [ ] Persisted tampered record fail-closed.
- [ ] Security Alerts ve Security Posture endpointleri read-only.
- [ ] Alert/posture payloadlarında secret/token/body/PII yok.
- [ ] Contract-only kaynaklar UI'da live/healthy/zero gibi gösterilmiyor.

### 8.6 Supply-chain

- [ ] `npm ci` lockfile ile deterministik çalışıyor.
- [ ] `npm audit` 0 vulnerability.
- [ ] CodeQL ilgili commit için green.
- [ ] SBOM generation + validator green.
- [ ] GitHub Actions least-privilege ve immutable pin beklentisini karşılıyor.
- [ ] Dependency/workflow diff security-impact review'dan geçmiş.

### 8.7 Pentest evidence

Her finding için kaydet:

- test case ID;
- hedef commit/environment;
- affected boundary/asset;
- reproducible request/step (secret hariç);
- expected vs actual result;
- severity;
- requestId/correlationId gibi safe evidence;
- remediation owner;
- retest sonucu.

Token, credential, private key, raw customer PII veya provider secret pentest raporuna/repo issue'suna kopyalanmaz.

## 9. Security-impact template

Her büyük feature veya security-sensitive değişiklik PR açıklamasında aşağıdaki kısa template ile incelenmelidir:

```text
Security Impact Review

Change / feature:
Owner:
Target environment:

Assets affected:
Trust boundaries crossed:
New/changed entry points:
Tenant scope:
Authentication / RBAC impact:
Step-up / elevated operation impact:

Untrusted inputs:
Server-owned/trusted inputs:
Data classification (public / tenant-private / platform-sensitive / secret):

Storage / Firestore paths changed:
Cache / queue / routing impact:
Backup / restore / migration impact:
Provider / IAM / credential impact:

Abuse / availability risks:
Security signals / alerts expected:
Audit evidence expected:
No-secret / no-PII verification:

Dependency / workflow / supply-chain impact:
Required targeted tests:
Cross-tenant negative tests:
Rollback / forward-fix plan:
External controlled actions:
Residual risk:
Reviewer decision: approve / changes-required
```

### Security-impact review zorunlu tetikleyicileri

Aşağıdaki değişikliklerden biri varsa template atlanmamalıdır:

- yeni/changed auth veya RBAC kontrolü;
- tenant path/scope değişikliği;
- yeni Platform Admin mutation;
- high-risk operation veya step-up integration;
- secret/credential/crypto değişikliği;
- backup/restore/migration/routing değişikliği;
- cache/queue key veya isolation değişikliği;
- yeni public/customer endpoint;
- security alert/incident/break-glass değişikliği;
- dependency major/security update;
- GitHub Actions/deployment/provider security değişikliği.

## 10. Phase 8 completion security gate

Threat model/security review tarafı ancak aşağıdaki evidence birlikte mevcutsa tamam kabul edilir:

- [x] trust boundaries, assets ve entry points belgelenmiş;
- [x] tenant boundary, admin takeover, backup-key loss, supply-chain, provider outage, migration, cache/queue/routing abuse senaryoları belgelenmiş;
- [x] mitigations ve residual riskler aktif/contract-only/external ayrımıyla yazılmış;
- [x] pentest readiness checklist mevcut;
- [x] security-impact template mevcut;
- [ ] final full CI green;
- [ ] final `npm audit` = 0;
- [ ] final secret scan green;
- [ ] final SBOM validation green;
- [ ] final CodeQL green;
- [ ] staging smoke evidence green;
- [ ] production-readiness regression green;

Son üç external/operational gate tamamlanmadan bu doküman production readiness onayı yerine geçmez.

## 11. Rollback

Bu paket docs-only'dir. Runtime, provider, environment, dependency veya V1 davranışı değiştirmez. Geri alma yalnız bu doküman/README referans commit'inin revert edilmesidir.
