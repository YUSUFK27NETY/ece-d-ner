# Ece Döner işletim notları

## Yayın sırası

1. Backend değişikliklerini Render'a yayınlayın ve `/` sağlık cevabının `status: "ok"` döndürdüğünü doğrulayın.
2. Müşteri ve admin sayfalarını GitHub Pages'a yayınlayın.
3. Yeni admin panelinin sipariş durumunu backend üzerinden güncellediği doğrulandıktan sonra Firestore kurallarını yayınlayın:

   ```bash
   firebase deploy --only firestore:rules --project ece-2e44c
   ```

Bu sıra, eski admin sayfasıyla yeni Firestore kuralları arasında kısa süreli uyumsuzluk oluşmasını önler.

## Zorunlu gizli ayarlar

- Firebase servis hesabı yalnız Render secret file veya güvenli bir dosya yolunda tutulmalıdır.
- `FIREBASE_SERVICE_ACCOUNT_PATH` bu dosyayı göstermelidir. Render'daki varsayılan yol `/etc/secrets/firebase-service-account.json` olarak desteklenir.
- `FRONTEND_URL` yalnız izin verilen müşteri/admin web origin'lerini virgülle ayrılmış olarak içermelidir.
- Servis hesabı JSON'u, parola, Firebase CLI giriş kodu veya token repoya eklenmemelidir.

## Yayın sonrası kısa kontrol

- Restoran açık/kapalı düğmesi müşteri sayfasına yansıyor.
- Geçersiz ürün kimliği 400 döndürüyor; 500 oluşturmuyor.
- Aynı `Idempotency-Key` ile tekrarlanan sipariş tek Firestore kaydı oluşturuyor.
- Eski fiyatla gönderilen sepet 409 döndürüyor ve müşteriden yeniden onay istiyor.
- Yeni sipariş admin panelinde beliriyor; bildirim izni verilmişse ses/tarayıcı bildirimi çalışıyor.
- Tamamlanan ciro yalnız `completed` durumundaki aktif siparişlerden hesaplanıyor.
- Sipariş ve ürün arşivleme veriyi kalıcı olarak silmiyor.

Canlı ortamda deneme siparişi oluşturulursa hemen `cancelled` yapılıp arşivlenmeli ve gerçek sipariş olmadığı not edilmelidir.

## Düzenli bakım

- Her hafta GitHub Actions testlerini ve Render loglarını kontrol edin.
- Her ay bağımlılık denetimini çalıştırın: `npm audit --omit=dev`.
- Firestore için günlük yedekleme, saklama süresi ve geri yükleme denemesi Google Cloud tarafında ayrıca yapılandırılmalıdır.
- Restoranın yasal unvanı, açık adresi, çalışma saatleri, teslimat alanı/ücreti ve KVKK saklama süreleri doğrulanınca müşteri sayfasına eklenmelidir.
- Üretimde en az bir harici uptime alarmı ve backend hata alarmı kurulmalıdır.
