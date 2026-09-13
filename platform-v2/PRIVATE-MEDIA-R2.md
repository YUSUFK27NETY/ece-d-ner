# Private product media fallback

Platform V2 ürün görselleri için iki güvenli çalışma modu destekler:

1. `PLATFORM_MEDIA_R2_*` + `PLATFORM_MEDIA_PUBLIC_BASE_URL` tanımlıysa ayrı media bucket/CDN kullanılır.
2. Ayrı media ayarı hiç tanımlı değilse ve mevcut `PLATFORM_BACKUP_R2_*` object storage eksiksiz yapılandırılmışsa, ürün medyası aynı private R2 bucket içinde yalnız `media/{tenantId}/products/{productId}` prefix'ine yazılır. Görseller bucket'ı public yapmadan Platform V2'nin `/media/:tenantId/products/:productId` endpoint'i üzerinden okunur.

Fallback public endpoint yalnız canonical tenant/product kimliğinden türetilen `media/` key'ini okuyabilir; `backups/` veya kullanıcı tarafından verilen arbitrary object key kabul etmez. Yüklemeler JPEG, PNG ve WebP ile 5 MB sınırını korur. Provider hata ayrıntıları istemciye yansıtılmaz.

Production'da ayrı media bucket kullanmak istenirse aşağıdaki değerlerin tamamı birlikte sağlanmalıdır; kısmi config fail-closed startup hatası üretir:

```text
PLATFORM_MEDIA_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
PLATFORM_MEDIA_R2_BUCKET=<bucket>
PLATFORM_MEDIA_R2_ACCESS_KEY_ID=<secret>
PLATFORM_MEDIA_R2_SECRET_ACCESS_KEY=<secret>
PLATFORM_MEDIA_PUBLIC_BASE_URL=https://<public-media-host>
PLATFORM_MEDIA_R2_REGION=auto
```

Backup bucket'ın kendisi public yapılmamalıdır. Private fallback kullanıldığında public erişim yalnız uygulamanın kontrollü `/media/...` proxy rotasından geçer.
