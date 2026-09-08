# Phase 8 Paket 7B — Security Posture UI

Platform Admin paneli, Paket 7A'nın mevcut read-only endpointini kullanır:

```text
GET /api/platform/security-posture
```

Security Posture paneli tenant edit görünümünde açılır; ancak gösterdiği veri
platform/control-plane kapsamındadır. Create ve empty modlarında gizlenir. Global
Yenile akışı seçili tenant görünümünü yenilerken posture isteğini de tek kez tekrarlar.

## Dürüst görünürlük

UI backend'in source-state semantiğini değiştirmez. `active`, `contract_only`,
`not_wired`, `external_verification_required` ve `unavailable` değerleri yalnız
explicit sunum allowlist'iyle kullanıcı dostu etiketlere çevrilir. Bilinmeyen bir
değer CSS class adı veya serbest metin olarak kullanılmaz.

Bağlı olmayan kaynakların sayaçları `0` olarak gösterilmez. `null`, ölçümün sıfır
olduğunu değil kaynağın bağlı olmadığını belirtir; UI bunu `—` veya açık bir
"kaynak bağlı değil" mesajıyla gösterir. `unavailable`, `healthy` değildir.

Step-up contract readiness gerçek runtime enforcement değildir. MFA/passkey
readiness de kullanıcı enrollment'ı değildir. Identity kartı contract, enforcement,
elevated-session ve enrollment görünürlüğünü ayrı gösterir.

Security Alerts kartındaki `recentVisibleCount`, yalnız "Son görünür uyarılar"
olarak etiketlenir; toplam alert sayısı olduğu iddia edilmez. Incident ve break-glass
kaynakları bağlı değilken sahte sayaç veya aktif oturum gösterilmez. Supply-chain
kartı repository SBOM/CodeQL baseline'ını canlı workflow sonucundan ayırır ve canlı
sonucu `Harici doğrulama gerekli` olarak bırakır.

## Güvenlik ve operasyon sınırı

Frontend projector yalnız gösterilecek Paket 7A alanlarını descriptor üzerinden
okur. DOM üretimi `document.createElement`, `textContent`, `replaceChildren` ve
`append` kullanır; HTML interpolation ve raw object serialization yoktur. Token,
credential, secret, request body, PII, provider payload veya raw error mesajı DOM'a
taşınmaz.

Panelde rotate, revoke, activate, approve, resolve, provider refresh, workflow
trigger veya başka mutation kontrolü yoktur. GitHub/provider API çağrısı yapılmaz ve
production/staging ayarı değiştirilmez.

Rollback için yalnız Paket 7B HTML/JavaScript/CSS panel değişiklikleri kaldırılır;
Paket 7A backend kontratı ve diğer Phase 8 runtime davranışları etkilenmez. Sonraki
gerçek Phase 8 işi Threat Model / Security Review'dur.
