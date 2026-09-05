# Phase 8 Paket 6B-2B1 — Tenant-Boundary Alert Bridge

Bu paket tenant-boundary violation olayları için provider-neutral central alert kontratını ekler. Repository incelemesinde `TenantAccessGuard` için aktif runtime call-site bulunmadığından sonuç **CONTRACT ONLY** durumundadır; `server.js` veya HTTP uygulamasına sahte kullanım eklenmemiştir.

## Source-tenant trust kuralı

Central alert scope'u yalnız doğrulanmış kaynak context'ten üretilir:

- `tenantId` yalnız `context.tenantId` değeridir;
- `actorId` yalnız trusted context'in kendi data alanından alınır;
- hedef tenant kimliği event, correlation veya persistence scope'una taşınmaz;
- event severity `high`, type `tenant_boundary_violation` ve source `tenant.authorization` server-owned değerlerdir;
- yalnız `TENANT_SCOPE_MISMATCH` ve `TENANT_BOUNDARY_VIOLATION` reason code'ları kabul edilir.

Token, secret, credential, request body, raw provider payload, e-posta, telefon, IP veya başka PII bridge input'una ya da alert modeline alınmaz. Operation trusted call-site'tan, request ID ise server-generated request context'inden gelmelidir.

## Phase 6 ve Phase 8 ayrımı

`TenantAccessGuard` mevcut Phase 6 `tenant_boundary_violation` security signal'ını sürdürür. Optional Phase 8 bridge kullanıldığında her gerçek boundary denial tam bir central observation üretir. Phase 6 signal count veya metadata değeri Phase 8 observation count'una kopyalanmaz.

Phase 6 ve Phase 8 telemetry yazımları bağımsız best-effort yan etkilerdir. Herhangi bir telemetry hatası authorization denial'ını allow'a çeviremez, `TENANT_SCOPE_MISMATCH` yerine 500 üretemez veya diğer telemetry kanalını engelleyemez. Hata logları yalnız generic metin taşır.

## Kapsam ve sonraki işler

Aktif runtime call-site oluşmadan tenant-boundary central persistence akışı çalışmaz. Step-up bridge 6B-2B2; read-only API ve Platform Admin UI 6B-3 kapsamındadır. Bu pakette provider mutationı, API/UI, step-up, break-glass veya distributed dedupe değişikliği yoktur.

Rollback için `TenantAccessGuard` optional `securityOperations` dependency'si ve bridge'in `recordTenantBoundaryViolation` methodu kaldırılır. Phase 6 signal mekanizması ile 6B-1/6B-2A alert altyapısı değişmeden kalır; persisted kayıt silinmez.
