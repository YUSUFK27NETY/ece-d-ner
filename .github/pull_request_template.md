## Değişiklik

- [ ] Değişikliğin amacı ve kullanıcı etkisi açıklandı.
- [ ] Gereksiz kapsam genişlemesi yapılmadı.
- [ ] Platform V2 / Ece Döner V1 sınırı kontrol edildi; istenmeyen çapraz etki yok.

## Güvenlik ve tenant izolasyonu

- [ ] Parola, token, servis hesabı, recovery code, private key veya kişisel müşteri verisi eklenmedi.
- [ ] Yetkilendirme, tenant isolation ve Firestore kural etkisi incelendi.
- [ ] İstemciden gelen fiyat, kimlik, rol, tenant ve durum bilgilerine güvenilmedi.
- [ ] Kritik admin/değişiklik akışlarında step-up, audit ve fail-closed etkisi değerlendirildi.
- [ ] Secret/body/token/PII telemetry, log, artifact veya Admin UI içine düşmüyor.

## Supply-chain ve CI

- [ ] Yeni GitHub Action adımı en az yetkiyle çalışıyor ve immutable commit SHA'sına sabitlendi.
- [ ] Dependency/lockfile değişiklikleri açıklandı ve üretim bağımlılığı riski değerlendirildi.
- [ ] `npm run ci` başarılı.
- [ ] `npm run security:dependencies` / repo güvenlik denetimi başarılı ve 0 vulnerability.
- [ ] CodeQL etkisi kontrol edildi.
- [ ] SBOM/provenance etkisi varsa güncellendi veya neden gerekmediği açıklandı.

## Deploy, provider ve geri dönüş

- [ ] Production deployment onayı ve sorumlusu açıkça belirlendi; otomatik provider mutation eklenmedi.
- [ ] Render/Firebase/R2/Cloudflare/GitHub gibi provider-side değişiklikler kod değişikliğinden ayrı kontrollü adım olarak işaretlendi.
- [ ] Canary/staging doğrulaması ve geri dönüş/forward-fix adımı belirlendi.
- [ ] CI bypass, force-push veya deploy override gerekmiyor; gerekiyorsa risk ve onay kaydı açıklandı.
- [ ] `main` dalı doğrudan değiştirilmedi.

## Security impact

- [ ] Bu değişiklik için güvenlik etkisi: `none / low / medium / high` olarak belirtildi.
- [ ] Yeni trust boundary, entry point, credential, admin capability veya destructive operation ekleniyorsa threat-model notu eklendi.
