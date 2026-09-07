# Phase 8 Paket 6B-3B — Read-Only Security Alerts Admin UI

Platform Admin paneli, Paket 6B-3A read-only API'lerini kullanarak seçili tenant ve platform scope güvenlik uyarılarını ayrı listelerde gösterir. Tenant listesi `/api/platform/tenants/:tenantId/security-alerts?limit=20`, platform listesi `/api/platform/security-alerts?limit=20` üzerinden yüklenir; platform kayıtları tenant görünümüne karıştırılmaz.

Panel yalnız tenant edit modunda görünür. Yeni tenant ve empty modlarında gizlenir. Mevcut global Yenile akışı seçili tenantı tekrar gösterdiğinde iki read-only listeyi de bir kez yeniden yükler; ayrı mutation veya refresh kontrolü eklenmemiştir.

Frontend projector yalnız severity, event type, reason code, operation, event count, first/last seen, correlation ID ve opsiyonel actor/source alanlarını okur. Token, Authorization, request body, secret, credential, e-posta, telefon, IP, raw Firebase claim, provider payload, dedupe internalleri veya arbitrary response alanları DOM'a taşınmaz. Malformed alert güvenli generic durum olarak ele alınır ve raw object stringify edilmez.

Tüm alert DOM'u `document.createElement`, `textContent`, `replaceChildren` ve `append` ile kurulur; HTML interpolation veya `innerHTML` kullanılmaz. Severity class'ları explicit `info`, `warning`, `high`, `critical` eşlemesinden gelir; diğer değerler `unknown` badge'ine düşer ve backend stringinden class adı üretilmez.

Tenant istekleri hem seçili tenant kimliği hem monoton request sürümüyle korunur; eski tenant veya eski refresh response'u güncel görünümü overwrite etmez. Platform isteklerinde de eski response'un yeni refresh sonucunu ezmesini önleyen request sürümü bulunur. API hata mesajları doğrudan gösterilmez; yalnız `Güvenlik uyarıları yüklenemedi.` generic metni kullanılır.

UI tamamen read-only'dir: acknowledge, resolve, delete, revoke, disable veya başka alert/incident mutation butonu ve handler'ı yoktur. Backend auth/API semantiği, provider ayarları ve alert persistence değişmez.

Rollback için Security Alerts fieldset'i, ona ait render/load yardımcıları, minimal CSS sınıfları ve bu dokümantasyon referansı kaldırılır. Paket 6B-3A API'leri ve persisted alertler değişmeden kalır.
