# Phase 8 Paket 1 — Platform Admin identity hardening foundation

Issue #43. Bu paket provider-neutral step-up karar modeli, merkezi config doğrulaması
ve güvenli audit metadata kontratını ekler. Mevcut endpointlerde enforcement açmaz.
Karar katmanı hiçbir token doğrulamaz, kullanıcı enroll etmez, session oluşturmaz,
provider çağırmaz veya audit yazmaz. Firebase/Auth, Render, R2 ve Cloudflare ayarları
ile Ece Döner V1 runtime/veri yolları değişmez.

## Mevcut akış ve entegrasyon sınırı

`require-platform-admin.js`, `verifyIdToken(token, true)` sonucunda strict
`platformAdmin === true` ister ve `req.platformActor` içine yalnız `uid`/`role`
koyar. Tenant create/update handlerları audit actor'ını bu middleware'den alır.
Claim provisioning ayrı yetkili script üzerindedir. Bu akışlar değiştirilmedi.
Mevcut admin POST/PATCH işlemleri yeni freshness/factor metadata olmadan çalışır.

Yeni `createPlatformAdminStepUpPolicy` yalnız trusted backend çağrıları içindir.
İleride enforcement ekleneceğinde mevcut authentication, RBAC, tenant boundary ve
operasyona özgü confirmation/backup/restore kapıları ayrıca korunmalıdır.
Step-up `allow`, tenant erişim yetkisi veya çalıştırılabilir bir session bileti değildir.
Her mutation öncesinde güncel doğrulanmış metadata ile yeniden değerlendirilmelidir.

## Operasyon kontratı

`PLATFORM_ADMIN_OPERATION_RISKS` exact server-owned operation kimliklerini taşır.
HTTP methodundan, URL substring'inden veya istemcinin `riskLevel` alanından risk
türetilmez.

| Risk | Varsayılan operasyonlar | Karar gereksinimi |
| --- | --- | --- |
| low | `tenant.read`, `tenant.operations.read` | Doğrulanmış actor ve strict Platform Admin claim |
| medium | `tenant.create`, `tenant.update` | Low koşulları + TTL içinde re-auth |
| high | `tenant.delete`, `platform_admin.claim.grant`, `platform_admin.claim.revoke`, `platform_admin.provision`, `placement.mutate`, `routing.mutate`, `migration.apply`, `migration.cutover`, `backup.restore.apply`, `secret.rotate`, `credential.rotate`, `production.destructive` | Medium koşulları + aynı actor/auth olayı için doğrulanmış, izin verilen factor |

Bilinen ordinary tenant create/update için medium kullanılır. Bir update daha
yıkıcı/production etkili ise entegrasyonun server-owned high-risk operasyonunu
seçmesi gerekir; client tarafından gönderilen sınıflandırmaya güvenilmez.

Trusted kod, constructor'daki `additionalOperations` ile yeni exact operation/risk
eşlemeleri ekleyebilir. Mevcut eşlemeler override edilemez. Geçersiz extension
policy'nin tüm kararlarını `INVALID_OPERATION_POLICY` ile deny yapar.
Registry'de bulunmayan her işlem, metadata eksiksiz olsa bile high-risk
`UNKNOWN_OPERATION` ile deny olur; serbest operation değeri çıktıya yansıtılmaz.

## Doğrulanmış identity/factor girdisi

`evaluate({ operation, verifiedAuth })` kontratı:

```js
const verifiedAuth = {
    actorId: "opaque-admin-id",
    platformAdmin: true,
    verified: true,
    authenticatedAtMs: verifiedAuthenticationTimeMs,
    verifiedFactors: [{
        type: "passkey",
        verified: true,
        actorId: "opaque-admin-id",
        authenticatedAtMs: verifiedAuthenticationTimeMs,
        verifiedAtMs: verifiedFactorTimeMs
    }]
};
```

Bu değerleri sadece token/assertion ve claim doğrulamasını yapan güvenilir adapter
üretebilir. `verified: true` bir doğrulama beyanıdır; client JSON'u, decoded-only
token veya enrollment kaydını güvenilir hale getirmez. Provider adapterı bu pakette
eklenmedi. Firebase `auth_time`, `iat`, provider adı veya MFA/passkey enrollment
alanlarına herhangi bir varsayımsal mapping yapılmaz. Token refresh, session
oluşturma zamanı veya UI flag'i re-auth yerine kullanılamaz.

Zamanlar açıkça Unix epoch **milisaniye**, pozitif safe integer olmalıdır. Auth
zamanı gelecekte olamaz; auth age TTL'ye eşit olduğunda session expired sayılır.
İzin verilen en az bir factor, strict `verified === true`, aynı `actorId`, aynı
`authenticatedAtMs` ve auth zamanından önce olmayan/gelecekte olmayan doğrulama
zamanı taşımalıdır. Factor kanıtı da TTL içinde olmalıdır. Daha yeni factor zamanı
auth TTL'sini uzatmaz. Başka actor veya önceki auth olayının factor kanıtı reddedilir.

Desteklenen factor türleri `totp`, `passkey`, `security_key` değerleridir. Tür adı
tek başına MFA assurance kanıtı değildir; adapter gerçekten doğrulanmış auth olayını
sağlamalıdır. Opaque actor kimlikleri `[A-Za-z0-9_-]`, 1–128 karakter kabul edilir;
email, isim, JWT veya provider payloadı actorId olarak kullanılmaz. Farklı kimlik
formatı kullanan provider için güvenilir adapterın opaque kimlik eşlemesi gerekir.

## Merkezi config ve fail-closed davranış

Mevcut `PLATFORM_GUARDRAILS_CONFIG_JSON` içine opsiyonel `security.stepUp` eklenir:

```json
{
  "security": {
    "stepUp": {
      "elevatedSessionTtlMs": 300000,
      "requiredFactorTypes": ["totp", "passkey", "security_key"]
    }
  }
}
```

Eski config'ler bu default ile çalışır. TTL strict integer olarak 1000–900000 ms
arasında olmalıdır; string, boolean, null veya sınırsız değerler kabul edilmez.
Factor listesi boş/tekrarlı olamaz, yalnız desteklenen türleri içerir. High risk
listedeki türlerden **en az birini** gerektirir. Config'de enforcement/disable
anahtarı yoktur; bilinmeyen alanlar ve unsafe prototype alanları reddedilir.

Merkezi loader geçersiz config'de startup sırasında hata verir; mevcut server
loader'ı provider kurulumundan önce çağırır. Doğrudan policy constructor'a geçersiz
config verilirse güvenli default'a sessizce dönmek yerine tüm kararlar
`INVALID_CONFIG` ile deny olur. Config snapshot'ı frozen'dır; sonradan input
nesnesini değiştirmek TTL'yi uzatamaz. Raw config hata mesajına yazılmaz; config
secret taşımaz ve admin bootstrap/UI içine eklenmez.

Policy `loadPlatformGuardrailsConfig(...).security.stepUp` ile oluşturulur.
İsteğe bağlı `clock` dependency'si testlerde zamanı kontrol eder; canlı kullanımda
server'ın `Date.now` saatidir. Geçersiz/throw eden clock deny üretir.

## Karar ve audit kontratı

Karar yalnız `actorId`, canonical `operation`, `riskLevel`, `decision`,
`reasonCode`, `authAgeMs`, `remainingFreshnessMs`, `freshnessBucket` ve
`verifiedFactorType` taşır. Freshness bucket `unknown`, `invalid`, `recent` veya
`expired` olur. Eksik/geçersiz auth zamanı için age null, kalan süre 0'dır.
`remainingFreshnessMs > 0` tek başına allow anlamına gelmez; gerekli factor eksik
olduğunda karar yine deny'dır.

`buildStepUpAuditMetadata(result)` yalnız bu modülün aynı process'te ürettiği frozen
kararları kabul eder. Raw, kopyalanmış veya JSON'dan deserialize edilmiş nesneler
reddedilir. Metadata açık alan projeksiyonu ile actorId, operation, risk, decision,
reason code, auth age/bucket ve yalnız factor **türünü** verir. Token, credential,
factor credential ID, raw assertion/claims, email/telefon veya exact auth timestamp
kopyalanmaz. Bilinmeyen operasyon audit'te `unknown` olur.

Tenant-bound işlerde metadata mevcut `createAuditEvent` / audit writer'a açık
`tenantId` ve `action: "platform.admin.step_up.decision"` ile verilebilir. Mevcut
writer `tenants/{tenantId}/audit` altındadır. Platform-wide claim/rotation kararları
için bu pakette yalnız metadata üretilir; sahte tenant seçilmez ve yeni global
audit persistence eklenmez. Otomatik audit/log yan etkisi yoktur.

## Doğrulama ve kalan kapsam

`phase8-admin-step-up.test.js` recent allow; missing/non-admin/unverified deny;
TTL sınırı, future/invalid time; actor/auth-event-bound factor; unknown operation;
extension downgrade; config validation; immutable policy; güvenli audit ve tenant
RBAC sınırlarını test eder. Mevcut admin API ve Phase 5/6/7 testleri regression
kapısıdır. Bu paket MFA/passkey enrollment, provider adapterı, canlı enforcement,
WAF, SBOM, incident response, break-glass veya CODEOWNERS içermez.
