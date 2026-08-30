# Ece Döner işletim notları

## Sabit geri dönüş noktası

- Güvenlik katmanlarından önceki çalışan sürüm `backup/pre-security-v1-2026-08-29` dalında sabitlenmiştir.
- Sabit commit: `def851b098628db9a3888ea294f8b897a188f445`.
- Bu dal geliştirme için kullanılmamalı ve silinmemelidir.

## GitHub hesap ve dal güvenliği

Hesap sahibine ait kimlik ayarları kodla değiştirilemez. GitHub hesabında iki aşamalı doğrulama veya passkey açık olmalı, kurtarma kodları çevrimdışı saklanmalı ve kullanılmayan oturumlar/uygulamalar kaldırılmalıdır. Parola, doğrulama kodu ve token sohbetlere veya issue'lara yazılmamalıdır.

`main` için önerilen koruma:

- Birleştirmeden önce pull request zorunlu.
- `quality` ve `CodeQL` kontrolleri başarılı olmak zorunda.
- Dalın güncel olması zorunlu.
- Force-push ve dal silme kapalı.
- Tek hesaplı bu repoda, PR sahibinin kendi PR'ını onaylayamaması nedeniyle zorunlu onay sayısı `0` tutulabilir; test zorunluluğu kaldırılmamalıdır.

GitHub App'in yönetim izni yoksa bu ayar GitHub arayüzündeki `Settings → Rules → Rulesets` bölümünden hesap sahibi tarafından yapılmalıdır.

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
- Her PR'da `npm run security:secrets`, tam güvenlik kontrolünde `npm run security` çalıştırılmalıdır.
- Firebase tarayıcı yapılandırmasındaki açık istemci anahtarı sır değildir; yine de Google Cloud tarafında yalnız gerekli API ve alan adlarıyla kısıtlanmalıdır.

## Otomatik güvenlik kontrolleri

- `static.yml`: statik kontrol, davranış testleri, geçmiş dahil secret taraması ve `npm audit` çalıştırır.
- `codeql.yml`: JavaScript için genişletilmiş CodeQL sorgularını PR, `main` ve haftalık zamanlamada çalıştırır.
- Tüm kullanılan GitHub Actions sürümleri tam commit SHA'sına sabitlenmiştir; Dependabot aylık güncelleme PR'ı açar.
- PR şablonu yetkilendirme, sır, test ve rollback kontrolünü zorunlu hatırlatır.

## İzleme

- `uptime.yml` her saat müşteri sayfasını, `/healthz` cevabını ve Firestore'a bağlı `/api/restaurant/status` cevabını birlikte kontrol eder.
- Başarısız çalışma GitHub Actions'ta kırmızı görünür ve GitHub bildirim ayarları açıksa hesap sahibine bildirilir.
- Backend her isteği gövde, IP ve token kaydetmeden; istek kimliği, yol, durum ve süre ile JSON log olarak Render'a yazar.
- İstemci destek talebinde `X-Request-Id` başlığını paylaşabilir; bu değer Render logundaki kayıtla eşleştirilir.

## Yedekleme

- `backup.yml` her gün tam Git geçmişini `git bundle` olarak doğrular ve 30 gün saklanan Actions artifact'i üretir.
- Bu repo yedeği Firestore müşteri/sipariş verisini içermez.
- Firestore için Google Cloud tarafında yönetilen günlük yedekleme, ayrı saklama alanı ve saklama süresi yapılandırılmalıdır. Müşteri verisi GitHub artifact'ine koyulmamalıdır.
- Ayda en az bir kez repo bundle'ı GitHub dışındaki şifreli depoya indirilmelidir; aynı hesaptaki yedek tek başına hesap ele geçirilmesine karşı yeterli değildir.

## Rollback provası

1. GitHub Actions'ta `Rollback readiness drill` açılır.
2. Varsayılan `backup/pre-security-v1-2026-08-29` hedefi değiştirilmeden çalıştırılır.
3. Workflow hedef commit'i, bağımlılıkları, testleri ve audit'i doğrular; üretime dokunmadan dağıtılabilir statik artifact üretir.
4. Gerçek geri dönüş gerekirse yeni bir `revert/...` dalı açılır, `main` üzerine geri dönüş PR'ı hazırlanır ve aynı kalite kontrollerinden geçirilir. `main` force-push ile geriye alınmaz.

## Yayın sonrası kısa kontrol

- Restoran açık/kapalı düğmesi müşteri sayfasına yansıyor.
- Geçersiz ürün kimliği 400 döndürüyor; 500 oluşturmuyor.
- Aynı `Idempotency-Key` ile tekrarlanan sipariş tek Firestore kaydı oluşturuyor.
- Eski fiyatla gönderilen sepet 409 döndürüyor ve müşteriden yeniden onay istiyor.
- Yeni sipariş admin panelinde beliriyor; bildirim izni verilmişse ses/tarayıcı bildirimi çalışıyor.
- Tamamlanan ciro yalnız `completed` durumundaki aktif siparişlerden hesaplanıyor.
- Sipariş ve ürün arşivleme veriyi kalıcı olarak silmiyor.
- `Siparişi Sil` yalnız yönetici oturumunda ve `SİL` yazılı onayından sonra kaydı kalıcı olarak kaldırıyor; bu işlem geri alınamıyor.

Canlı ortamda deneme siparişi oluşturulursa hemen `cancelled` yapılıp arşivlenmeli ve gerçek sipariş olmadığı not edilmelidir.

## Düzenli bakım

- Her hafta GitHub Actions testlerini, CodeQL sonuçlarını ve Render loglarını kontrol edin.
- Her ay bağımlılık denetimini çalıştırın: `npm audit --omit=dev`.
- Firestore için günlük yedekleme, saklama süresi ve geri yükleme denemesi Google Cloud tarafında ayrıca yapılandırılmalıdır.
- Restoranın yasal unvanı, açık adresi, çalışma saatleri, teslimat alanı/ücreti ve KVKK saklama süreleri doğrulanınca müşteri sayfasına eklenmelidir.
- Üretimde en az bir harici uptime alarmı ve backend hata alarmı kurulmalıdır.
