# Production audit — 2026-09-03

## Kapsam

Ece Döner V1 müşteri sayfası, yönetim paneli, Node/Express backend, Firebase Auth/Firestore erişim modeli, sipariş bütünlüğü, CI/güvenlik kontrolleri, backup/rollback mekanizmaları ve Platform V2 izolasyonu incelendi.

## Uygulanan düzeltmeler

- `package-lock.json` içindeki transitif `qs` paketi `6.15.3` sürümünden `6.16.0` sürümüne yükseltildi. Bu değişiklik GHSA-x5fp-wj9c-mxmx ve GHSA-4mjr-xmp4-gh2g uyarılarını giderir; uygulama kaynak kodu veya tasarımı değiştirmez.
- `OPERATIONS.md` içindeki uptime kontrol sıklığı dokümantasyonu gerçek workflow ile eşleştirilerek saatlik yerine 15 dakikalık olarak düzeltildi.

## Doğrulanan kontroller

- Statik HTML/CSS/JavaScript ve Firebase yapı kontrolü.
- Node test paketi.
- Git geçmişi dahil secret taraması.
- Production dependency audit.
- Firestore fail-closed erişim kuralları.
- Backend admin claim ve token revocation doğrulaması.
- CORS allowlist, JSON/body limitleri, rate limit, güvenlik headerları ve güvenli request logging.
- Server-side ürün fiyatlandırması, restoran açık/kapalı enforcement ve idempotent sipariş oluşturma.
- Admin-only sipariş durum değişikliği, arşivleme ve kalıcı silme akışları.
- Platform V2'nin V1 production start/deploy yolundan ayrı tutulması.
- `main` için aktif ruleset ve rollback snapshot.

## Değişiklik ilkesi

Çalışan müşteri deneyimi, admin panel tasarımı ve iş akışları korunmuştur. Audit sırasında yalnızca kanıtlanmış dependency güvenlik açığı ile hatalı operasyon dokümantasyonu değiştirilmiştir.
