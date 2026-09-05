# Phase 8 — Governance & Supply-Chain Baseline

This document defines the repository-side governance and supply-chain controls for Platform V2. Provider-side enforcement remains a separate, explicitly approved operational step.

## Scope

Applies to:

- Platform V2 runtime and admin code
- GitHub Actions workflows
- dependency and lockfile changes
- deployment/runbook changes
- security-sensitive configuration contracts

Ece Döner V1 remains independent and must not be automatically migrated or coupled to Platform V2.

## Repository ownership

`.github/CODEOWNERS` provides a default repository owner and explicit ownership for CI/governance and Platform V2. CODEOWNERS is review metadata; actual mandatory review enforcement depends on GitHub branch/ruleset settings and must be enabled separately in repository settings.

Critical review areas include:

- `.github/**`
- `package.json` / `package-lock.json`
- `platform-v2/**`
- authentication, tenant isolation, security, secrets, backup/restore, migration, routing, queue/cache and admin capabilities inside Platform V2

## Protected-main expectations

Production-bound changes should follow:

1. work on a non-main branch;
2. open a pull request into `main`;
3. wait for required CI/security checks;
4. review security impact and rollback plan;
5. require owner/reviewer approval where repository settings support it;
6. merge only after staging evidence is acceptable;
7. verify production readiness after the main deployment.

No normal workflow should depend on force-push, bypassing required checks, disabling branch protection or direct production mutation.

## Production deployment approval

A production deployment is a controlled operation, not merely a successful build. Before production release, record:

- target commit SHA;
- staging smoke result;
- `/health` and `/ready` expectations;
- database/provider dependency readiness;
- rollback or forward-fix target;
- security-sensitive external changes, if any;
- explicit operator approval.

Provider-side changes such as Render settings, Firebase IAM/Auth, R2 credentials, Cloudflare WAF/cache/DNS or GitHub repository rules are not automatically mutated by Phase 8 code.

## CI bypass / override checklist

If an emergency ever requires a bypass or override, treat it as an incident-level action. Record:

- incident/reference ID;
- requesting actor;
- approving actor;
- exact reason code;
- affected commit/deployment;
- checks bypassed;
- expiry or rollback point;
- post-event verification.

Break-glass access does not implicitly authorize force-push, deletion, credential exposure or destructive provider mutation.

## Dependency policy

- Use the committed lockfile for reproducible installs (`npm ci`).
- Production dependency vulnerabilities must remain at zero according to the repository security command.
- Dependency changes require explicit review of runtime impact, transitive changes and rollback strategy.
- Dependabot remains advisory/PR-based; updates are not auto-merged by this policy.
- GitHub Actions should use least permissions and immutable commit SHA pinning.

## SBOM contract

The repository should produce a machine-readable SBOM from the lockfile/package graph in CI without embedding secrets or environment values.

Minimum contract:

- CycloneDX JSON or SPDX JSON;
- generated from the checked-out commit;
- generation must fail if the package graph cannot be resolved;
- output is an ephemeral CI artifact or release evidence, not a source of credentials;
- validate that the output parses as JSON and identifies the root package/component;
- no `.env`, service-account JSON, tokens, private keys or runtime secret values are read to generate it.

An SBOM proves dependency inventory, not dependency safety. `npm audit`, CodeQL and human review remain separate controls.

## Build provenance / attestation baseline

Phase 8 establishes an extensible provenance contract but does not require signing infrastructure or provider credentials.

Evidence should be able to identify:

- repository and commit SHA;
- workflow identity/name;
- build timestamp;
- Node/npm versions;
- lockfile hash;
- SBOM artifact identity/hash when produced.

Future signing/attestation may be added as a controlled capability. Private signing material must never be stored in the repository or emitted to logs/artifacts.

## Dependency update risk classes

- **Low:** patch-only dev/tooling change with no runtime/security boundary impact.
- **Medium:** production dependency update, minor framework/runtime change, CI action update or lockfile graph change.
- **High:** auth/crypto/database/security dependency major change, package with install scripts/native code, runtime major upgrade, or change affecting tenant isolation/admin/security controls.

High-risk changes require explicit security-impact notes, targeted regression tests and a rollback/forward-fix plan.

## Supply-chain verification gate

Before Phase 8 completion:

- existing CodeQL remains green;
- dependency audit remains 0 vulnerability;
- GitHub Actions remain least-privilege and SHA-pinned;
- SBOM generation/validation workflow is present and green;
- CODEOWNERS and PR security/deploy checklist are present;
- branch/ruleset/provider enforcement that cannot be encoded in the repository is documented as an external controlled step.

## External controlled steps

These require separate operator approval and are not performed automatically by repository code:

- enabling/changing GitHub required reviewers or rulesets;
- configuring production deployment approvals/environments;
- activating or changing Cloudflare WAF/bot/DDoS rules;
- rotating/revoking Firebase, R2, Render or Cloudflare credentials;
- changing production IAM, DNS, domains or provider routing.
