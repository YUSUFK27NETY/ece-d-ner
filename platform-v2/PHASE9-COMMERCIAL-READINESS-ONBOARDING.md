# Platform V2 Phase 9 — Commercial Readiness & Customer Onboarding

Issue: #45

## Amaç

Phase 9'un amacı yeni bir tenant için yeni repo, kod fork'u veya tenant-başı backend deployment oluşturmadan ikinci ve sonraki gerçek işletmeleri mevcut merkezi Platform V2 akışıyla güvenli biçimde onboard edilebilir hale getirmektir.

Phase 5–8'in tenant isolation, backup/DR, telemetry/FinOps, entitlement, scalability/resilience, security operations ve governance kuralları korunur. Ece Döner V1 runtime/veri yolları bu faza import edilmez ve otomatik migrate edilmez.

## Mevcut durumdan çıkan ana karar

Mevcut durable tenant lifecycle şunları kullanır:

```text
provisioning | active | suspended | archived
```

Phase 9 sırf onboarding terminolojisi için yeni bir durable `ready` tenant status'u eklemez.

Bunun yerine activation readiness ayrı, server-owned ve türetilmiş bir read modeldir:

```text
pending | ready | blocked | unavailable
```

Hedef akış:

```text
create tenant
  -> durable status: provisioning
  -> server evaluates activation readiness
  -> readiness: pending/blocked/unavailable/ready
  -> explicit controlled activation
  -> durable status: active
```

Bu yaklaşım eski tenant kayıtlarını schema migrationa zorlamaz, `TENANT_STATUSES` sözleşmesini bozmaz ve readiness kaynağı ile lifecycle mutationını birbirinden ayırır.

## Değişmez güvenlik sınırları

1. `tenantId` her kaynakta exact scope'tur; başka tenant verisine fallback yapılmaz.
2. Missing/unavailable source sahte `ready`, `healthy`, `0`, `verified` veya `configured` üretmez.
3. Customer Readiness projection secret, token, credential, provider response body veya gereksiz PII taşımaz.
4. Identity-provider invitation, DNS/SSL, WAF, credential rotation/revoke, billing veya provider provisioning bu read model tarafından otomatik uygulanmaz.
5. Aktivasyon yalnız Platform Admin yetkili server path'i üzerinden ve readiness gate sonrasında yapılabilir; UI kendi başına tenantı hazır sayamaz.
6. Existing Phase 8 step-up contract gerçek runtime enforcement callsite yoksa CONTRACT ONLY kalır; Phase 9 sahte wiring üretmez.
7. Tenant başına repo/fork/deployment yolu oluşturulmaz.

## P9-1 — Activation Readiness Core

İlk paket yalnız backend/domain core'dur. UI veya provider mutation eklemez.

### Yeni read-model kontratı

Önerilen servis:

```text
src/onboarding/customer-readiness-service.js
```

Girdi:

- exact tenant record
- health/readiness adapter sonucu
- plan/entitlement readiness adapter sonucu
- tenant-admin bootstrap readiness sonucu
- backup/DR readiness sonucu
- security posture readiness sonucu
- domain/profile readiness sonucu

Her source sabit bir safe projection döndürür:

```text
{
  status: "ready" | "pending" | "blocked" | "unavailable",
  code: "SAFE_SERVER_CODE" | null,
  observedAt: ISO8601 | null
}
```

Raw provider object spread edilmez.

### Aggregate sonucu

Aggregate readiness:

- herhangi bir required source `blocked` ise `blocked`
- required source `unavailable` ise `unavailable`
- required source `pending` ise `pending`
- bütün required source'lar `ready` ise `ready`

Optional source'lar aggregate'i sahte biçimde aşağı/yukarı çekmez; required/optional sınıflandırması server-owned allowlist ile belirlenir.

Önerilen response:

```text
{
  tenantId,
  lifecycleStatus,
  activationReadiness,
  canActivate,
  checks: {
    profile,
    health,
    plan,
    adminBootstrap,
    backup,
    security,
    domain
  },
  evaluatedAt
}
```

`canActivate` yalnız `activationReadiness === "ready"` olduğunda true olabilir. Bir adapter exception'ı `unavailable` safe status'a normalize edilir; exception mesajı response'a girmez.

### Lifecycle kuralları

- `provisioning`: readiness değerlendirilebilir, activation adayıdır.
- `active`: readiness görünürlüğü devam eder fakat activation mutation tekrar uygulanmaz.
- `suspended`: `canActivate=false`; restore/reactivation ayrı kontrollü iş olarak değerlendirilir.
- `archived`: `canActivate=false`; onboarding/activation path'i fail-closed olur.

P9-1 mevcut `tenant-management-service` üzerinden doğrudan yeni lifecycle mutation eklememelidir. Önce read model + gate contract oluşturulur; activation mutation ayrı paket/test ile eklenir.

## Idempotency kararı

Mevcut onboarding service aynı `tenantId` bulunduğunda `TENANT_ALREADY_EXISTS` ile fail-closed olur. Phase 9 bunu sessiz upsert'e çevirmeyecektir.

İdempotency iki seviyede ele alınır:

1. exact same onboarding request tekrarında mevcut tenantı yanlışlıkla overwrite etme yok;
2. ileride request-id/idempotency-key eklenirse yalnız server-owned request fingerprint ile aynı sonucu güvenli tekrar oynatabilir.

İlk pakette duplicate create semantiği değiştirilmez. Böylece eski test/contract korunur.

## Plan / entitlement yeniden kullanım ilkesi

Phase 9 yeni bir paralel entitlement sistemi oluşturmaz.

Mevcut `EntitlementService`:

- plan policy resolve
- feature allow/deny
- soft usage limit
- warning/dedicated review
- monthly revenue reference

kaynağı olmaya devam eder.

Target-plan preview ileriki pakette mevcut config + entitlement resolver üzerinden salt okunur diff üretmelidir. Preview hiçbir plan mutationı, fiyat değişikliği veya müşteri disable işlemi yapmaz.

## Tenant admin/member bootstrap ilkesi

Gerçek Firebase/Auth invitation/enrollment Phase 9 core içinde doğrudan yapılmaz.

Readiness adapterı yalnız safe durum verir:

```text
not_configured | pending | ready | unavailable
```

Tenant/user ilişkisinde exact tenant scope ve least-privilege role allowlist zorunludur. Token/password/invite secret audit veya UI projectiona alınmaz.

## Domain readiness ilkesi

Tenant profile/domain metadata normalize edilir ancak gerçek DNS/SSL mutationı external kalır.

Durum modeli:

```text
not_configured | pending | verified | failed | unavailable
```

`verified` ancak güvenilir provider/domain-verification adapterından gelen doğrulanmış server-owned sonuçla üretilebilir. Domain alanında kullanıcı metni bulunması tek başına `verified` sayılmaz.

## Customer Readiness API hedefi

P9-2'de eklenecek aday endpoint:

```text
GET /api/platform/tenants/:tenantId/readiness
```

Kurallar:

- Platform Admin read-only
- exact tenant lookup
- mutation methodları 404/405 mevcut router davranışına uygun fail-closed
- response sabit projector alanlarından oluşur
- source unavailable durumları açıkça görünür

## Platform Admin UI hedefi

P9-2 UI mevcut tenant formuna additive bir `Customer Readiness` paneli ekler.

UI:

- `createElement`/`textContent` güvenli projection yaklaşımını korur
- destructive/provider action butonu içermez
- `unknown/unavailable/pending` değerleri kullanıcıya dürüst gösterir
- tenant değiştiğinde exact tenant endpointini yeniden yükler
- bir kartın başarısızlığı diğer kartlara sahte `ready` yazmaz

## P9 paket sırası

1. **P9-1 Activation Readiness Core**
2. **P9-2 Customer Readiness API + Platform Admin UI**
3. **P9-3 Tenant Admin/Member Bootstrap Contract**
4. **P9-4 Commercial Plan Preview**
5. **P9-5 Domain Readiness Contract**
6. **P9-6 Second-Tenant Acceptance & Launch Runbook**

Her paket sonunda targeted tests + full CI + dependency audit + secret scan çalıştırılır. PR yalnız Phase 9 completion gate veya açıkça seçilmiş ara checkpoint'te açılır.

## P9-1 test zorunlulukları

- exact tenant scope
- required source blocked/pending/unavailable precedence
- all required ready -> ready + canActivate true
- suspended/archived -> canActivate false
- adapter exception -> unavailable, raw error redacted
- unknown fields/provider objects response'a sızmamalı
- token/password/credential/PII fixture projectiona sızmamalı
- duplicate tenant onboarding mevcut fail-closed semantiğini korumalı
- existing tenant status enum ve V1 regression değişmemeli

## Completion gate

Phase 9 ancak ikinci bir tenant:

- aynı merkezi registry/onboarding yolundan oluşturulabildiğinde,
- Customer Readiness server-owned kaynaklarla dürüstçe değerlendirilebildiğinde,
- admin/plan/backup/security/domain hazırlığı güvenli biçimde görülebildiğinde,
- activation/suspend/archive/rollback operasyonu belgeli olduğunda,
- yeni repo/fork/tenant-başı backend deployment gerektirmediği kanıtlandığında,
- CI/audit/CodeQL/SBOM ve staging acceptance yeşil olduğunda

tamamlanır.

## External / kontrollü operasyonlar

Bu faz aşağıdakileri kendiliğinden çalıştırmaz:

- production WAF/DDoS/bot provider değişiklikleri
- DNS/SSL/custom-domain provider mutationları
- credential/secret rotation veya revoke
- production R2 credential/schedule değişiklikleri (#11 ayrı takip)
- billing/fiyat mutationı
- gerçek shard/database/managed queue/CDN provisioning
- Ece Döner V1 migrationı
