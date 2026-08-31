# Platform V2 Foundation

Bu klasör, Ece Döner V1'den izole merkezi multi-tenant platform temelidir.

## Değişmez kurallar

1. **V1'e dokunma:** `platform-v2` kodu mevcut Ece Döner V1 runtime'ına import edilmez.
2. **Yeni müşteri = tenant:** Yeni repo, yeni kod kopyası veya müşteri bazlı fork yok.
3. **Tenant izolasyonu:** Her veri erişimi açık bir `tenantId` üzerinden yapılır.
4. **Provider bağımsızlığı:** Storage, bildirim ve benzeri dış servisler adapter arayüzleri üzerinden kullanılır.
5. **Fail-closed:** Tenant kimliği yoksa veya geçersizse veri yolu üretilmez.
6. **Merkezi operasyon:** Onboarding, yetki, backup, monitoring ve audit merkezi platformdan yönetilir.
7. **Ölçek hedefi:** 5. ve 500. müşterinin onboarding akışı aynı kalmalıdır.

## Firestore V2 sözleşmesi

```text
tenants/{tenantId}
tenants/{tenantId}/products/{productId}
tenants/{tenantId}/orders/{orderId}
tenants/{tenantId}/settings/{settingId}
tenants/{tenantId}/members/{uid}
tenants/{tenantId}/audit/{eventId}
```

Global metadata yalnızca platform seviyesinde tutulur:

```text
platform/tenants/{tenantId}
platform/config/{configId}
```

Tenant iş verisi hiçbir zaman global `products`, `orders` veya `settings` koleksiyonunda tutulmaz.

## Backup anahtar sözleşmesi

```text
backups/{tenantId}/firestore/YYYY/MM/DD/<timestamp>.json.gz.enc
```

Storage provider değişse bile bu mantıksal anahtar formatı korunur.

## İlk kapsam

Bu foundation yalnızca sözleşmeleri ve güvenli temel yardımcılarını oluşturur. Ece Döner V1 migration'ı, canlı deployment, Cloudflare R2 credential'ları ve production veri taşıma bu branch'te yapılmaz.
