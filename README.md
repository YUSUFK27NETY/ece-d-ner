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
- 📦 Silme yerine geri alınabilir ürün ve sipariş arşivi
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
