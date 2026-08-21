# QR Menü Pro

Profesyonel QR Menü sistemi.

## Ece Döner

Mobil uyumlu dijital menü ve WhatsApp üzerinden sipariş sistemi.

## Özellikler

- 📱 Mobil uyumlu tasarım
- 🍽️ Dijital QR menü
- 🛒 Sepet sistemi
- ➕➖ Ürün miktarı kontrolü
- 📝 Sipariş notu
- 💬 WhatsApp üzerinden sipariş
- 🔎 Ürün arama
- 🏷️ İndirimli ürünler
- ❤️ Favoriler

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

Servis hesabı dosyasını repoya eklemeyin. Yetki verildikten sonra
yönetici çıkış yapıp tekrar giriş yapmalıdır.
