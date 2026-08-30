# QR Menü Pro

Ece Döner için mobil QR menü, güvenli sipariş API'si ve yönetim paneli.

## Ece Döner

Mobil uyumlu dijital menü ve WhatsApp üzerinden sipariş sistemi.

## Özellikler

- 📱 Mobil uyumlu tasarım
- 🍽️ Dijital QR menü
- 🛒 Sepet sistemi
- ➕➖ Ürün miktarı kontrolü
- 📝 Sipariş notu
- 💬 Sunucuda kaydedildikten sonra WhatsApp'ta onay özeti
- 🔎 Ürün arama
- ❤️ Favoriler
- 🔒 Sunucu tarafında ürün/fiyat doğrulama
- 🔁 Tekrarlanan gönderimleri engelleyen sipariş anahtarı
- 📦 Geri alınabilir ürün ve sipariş arşivi
- 🗑️ Yönetici onaylı kalıcı sipariş silme
- 🔔 Yeni sipariş ses/tarayıcı bildirimi

## Yerel kontroller

```bash
npm ci
npm run ci
```

Ortam değişkenleri için `.env.example` dosyasını temel alın. Servis hesabı dosyasını repoya eklemeyin.

## Yönetici güvenlik kurulumu

Yönetici hesabına bir kez `admin` claim'i verin:

```bash
FIREBASE_SERVICE_ACCOUNT_PATH=/guvenli/yol/firebase-service-account.json \
ADMIN_EMAIL=yonetici@example.com \
npm run grant-admin
```

Ardından Firestore kurallarını dağıtın:

```bash
firebase deploy --only firestore:rules --project ece-2e44c
```

Yetki verildikten sonra yönetici çıkış yapıp tekrar giriş yapmalıdır. Yayın ve geri dönüş sırası için `OPERATIONS.md` belgesini izleyin.

## Güvenlik ve canlılık kontrolleri

```bash
npm run ci
npm run security
npm run healthcheck
```

- `ci`: statik dosyaları, davranış testlerini ve Git geçmişindeki gizli değerleri kontrol eder.
- `security`: gizli değer taramasına ek olarak üretim bağımlılıklarını denetler.
- `healthcheck`: canlı müşteri sitesi, Render backend ve Firestore restoran durumunu birlikte doğrular.

GitHub Actions; CodeQL analizi, saatlik canlılık kontrolü, günlük repo yedeği ve elle çalıştırılan rollback provası içerir. Ayrıntılı yayın, yedekleme ve geri dönüş adımları `OPERATIONS.md` içindedir.
