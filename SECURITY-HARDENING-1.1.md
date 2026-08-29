# Ece Döner V1 — Security Hardening 1.1

## Production status

- GitHub Pages frontend deploy: verified.
- Render backend hardening deploy: verified.
- Production smoke check: verified (public site + backend health + CSP + X-Request-Id).
- Rollback branch: `backup/v1-stable-2026-08-29`.

## Remaining account-level controls

The following controls cannot be enforced by application code alone and must be configured in the provider control panels by an authorized account owner:

1. Deploy `firestore.rules` to the production Firebase project (`ece-2e44c`) and smoke-test admin/product/order behavior.
2. Protect `main` with a GitHub branch protection/ruleset: require pull requests, require the `quality` check, block force-push, and block branch deletion.
3. Verify 2FA/passkey and recovery codes for GitHub, Google/Firebase, and Render administrator accounts.
4. Configure scheduled Firestore backups/retention and complete at least one restore test.

## Release rule

Do not mark Security Hardening 1.1 fully complete until all four account-level controls above are verified. Do not remove the rollback branch until a later stable recovery point replaces it.
