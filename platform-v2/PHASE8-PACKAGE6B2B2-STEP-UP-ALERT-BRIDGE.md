# Phase 8 Paket 6B-2B2 — Step-Up Denial Alert Bridge

Bu paket, Platform Admin step-up denial kararları için provider-neutral central security alert kontratını ekler. Repository incelemesinde production/server runtime'ında gerçek step-up enforcement call-site bulunmadığından sonuç **CONTRACT ONLY** durumundadır; `server.js`, HTTP endpointleri veya mutation akışlarına sahte wiring eklenmemiştir.

## Issued decision trust boundary

Bridge yalnız `createPlatformAdminStepUpPolicy` tarafından aynı process içinde gerçekten issued edilmiş deny decision nesnesini kabul eder. Plain object, spread/copy veya JSON ile hydrate edilmiş kararlar mevcut WeakSet tabanlı decision kontratı tarafından fail-closed reddedilir.

Central event yalnız şu güvenli anlamları taşır:

- event type `step_up_denied`, source `platform.admin.step_up` ve severity `warning` server-owned'dır;
- actor, reason code ve canonical operation yalnız issued decision'dan gelir;
- tenant scope yalnız trusted server context verilmişse kullanılır;
- request ID server-generated canonical UUID olmalıdır.

Allow decision denial alerti üretmez ve bridge tarafından reddedilir. Unknown/unregistered operation için issued `UNKNOWN_OPERATION` reason code korunur, fakat raw operation alert veya loga taşınmaz; event operation alanı `null` olur.

Raw verified auth, token, assertion, MFA secret, passkey credential ID, Firebase claims, auth timestamp, request body, provider payload, e-posta, telefon, IP veya başka PII bridge input'una ve alert modeline alınmaz. Caller event type, severity, reason, operation, actor veya count değerini belirleyemez.

## Runtime ve hata davranışı

Mevcut break-glass integration step-up policy'yi yalnız provider-neutral, synchronous in-memory akışta kullanır ve production server'a wired değildir. Bu paket break-glass lifecycle, freshness, reason code veya audit davranışını değiştirmez.

Aktif runtime denial call-site olmadığı için alert persistence hatasının authorization semantiğini değiştirebileceği bir production akışı yoktur. İleride explicit wiring yapıldığında alert side-effect deny kararından bağımsız best-effort tutulmalı ve yalnız `Central step-up security alert kaydı başarısız.` generic logu kullanılmalıdır.

Read-only Security Alerts API ve Platform Admin UI 6B-3 kapsamındadır. Bu pakette API/UI, provider mutationı, yeni MFA/passkey mapping'i veya distributed dedupe değişikliği yoktur.

Rollback için bridge'in `recordStepUpDenial` methodu ve bu dokümantasyon referansı kaldırılır. Mevcut step-up policy, break-glass integration ve 6B-1/6B-2A/6B-2B1 alert davranışları değişmeden kalır; persisted alert silinmez.
