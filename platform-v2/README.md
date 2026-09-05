# Platform V2 — Merkezi Multi-Tenant Platform

Bu klasör, Ece Döner V1'den izole merkezi multi-tenant platform temelidir.

## Değişmez kurallar

1. **V1'e dokunma:** `platform-v2` kodu mevcut Ece Döner V1 runtime'ına import edilmez.
2. **Yeni müşteri = tenant:** Yeni repo, yeni kod kopyası veya müşteri bazlı fork yok.
3. **Tenant izolasyonu:** Her veri erişimi açık bir `tenantId` üzerinden yapılır.
4. **Provider bağımsızlığı:** Storage, bildirim ve benzeri dış servisler adapter arayüzleri üzerinden kullanılır.
5. **Fail-closed:** Tenant kimliği yoksa veya geçersizse veri yolu üretilmez.
6. **Merkezi operasyon:** Onboarding, yetki, backup, monitoring ve audit merkezi platformdan yönetilir.
7. **Ölçek hedefi:** 5. ve 500. müşterinin onboarding akışı aynı kalmalıdır.

## Merkezi çalışma modeli

```text
Platform Admin /admin/
        |
        v
Platform V2 Admin API
        |
        +--> platformTenants/{tenantId}
        +--> tenants/{tenantId}/...
        +--> tenant audit kayıtları
        +--> provider adapterları
```

Yeni işletme eklemek bir deployment işi değildir. Hedef akış:

```text
Yeni işletme oluştur
 -> tenantId
 -> işletme/sektör/paket
 -> marka + iletişim + domain
 -> feature flagler
 -> active
```

## Firestore V2 sözleşmesi

Tenant iş verisi:

```text
tenants/{tenantId}
tenants/{tenantId}/products/{productId}
tenants/{tenantId}/orders/{orderId}
tenants/{tenantId}/settings/{settingId}
tenants/{tenantId}/members/{uid}
tenants/{tenantId}/audit/{eventId}
```

Merkezi tenant registry metadata'sı:

```text
platformTenants/{tenantId}
```

Tenant iş verisi hiçbir zaman global `products`, `orders` veya `settings` koleksiyonunda tutulmaz.

## Tenant registry yönetimi

Merkezi registry aşağıdaki alanları taşır:

- kalıcı `tenantId`
- işletme adı ve sektör
- paket
- durum (`provisioning`, `active`, `suspended`, `archived`)
- merkezi feature flagler
- marka/iletişim/domain profili
- created/updated metadata

`tenantId` ve sektör onboarding sonrasında normal panel güncellemesiyle değiştirilemez. Böyle yapısal değişiklikler migration prosedürü gerektirir.

## Merkezi Admin API

```text
GET   /health
GET   /api/platform/tenants
GET   /api/platform/tenants/:tenantId
GET   /api/platform/tenants/:tenantId/operations
GET   /api/platform/finops/top-tenants?limit=10
POST  /api/platform/tenants
PATCH /api/platform/tenants/:tenantId
```

Platform endpointleri yalnız Firebase ID tokenında `platformAdmin: true` claim bulunan kullanıcıları kabul eder.

Phase 6 telemetry, entitlement, tenant-scoped rate limiting, security signal ve FinOps sözleşmeleri için `PHASE6-SECURITY-FINOPS-GUARDRAILS.md` dosyasına bak.

Phase 7 capacity/SLO, tenant placement/routing, güvenli placement migration, tenant queue/cache izolasyonu, canary rollout ve provider resilience sözleşmeleri için `PHASE7-SCALABILITY-ROUTING-RESILIENCE.md` dosyasına bak.

Merkezi placement metadata'sı tenant iş verisinden ayrı tutulur:

```text
platformTenantPlacements/{tenantId}
```

Placement kaydı olmayan eski tenantlar backward-compatible çalışır; operations görünürlüğü fiziksel konum tahmini yapmak yerine `unknown` gösterir.

## Backup anahtar sözleşmesi

```text
backups/{tenantId}/firestore/YYYY/MM/DD/<timestamp>.json.gz.enc
```

Storage provider değişse bile bu mantıksal anahtar formatı korunur.

## Deployment

Runtime:

```text
node platform-v2/server.js
```

Merkezi panel:

```text
/admin/
```

Production/staging environment sözleşmesi için `DEPLOYMENT.md` dosyasına bak.

## Ece Döner V1

Ece Döner V1 mevcut haliyle canlı/stabil kalır. V2 hazır olmadan V1 veri yolları otomatik olarak değiştirilmez. Gelecekteki kontrollü migration prosedürü `MIGRATION-ECE-V1.md` içinde tanımlıdır.
