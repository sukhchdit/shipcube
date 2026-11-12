---
name: project-p3-security-conditions
description: P3 security review state after remediation verification (2026-11-12): no Critical/High open; SEC-COND-01..04 design status, new SEC-COND-05..07 (MEDIUM, P4 exit), rulings on the 3 architect alternatives; what to re-check at P5 reviews and G3
metadata:
  type: project
---

P3 review (`docs/05-quality/security/P3-architecture-security-review.md`) was APPROVED_WITH_CONDITIONS at b8f805f, then re-verified in §14 against d5cdfa2 (2026-11-12). The verdict is still APPROVED_WITH_CONDITIONS and **no Critical/High design risk is open**.
- SEC-P3-01, 02 and 04 are RESOLVED.
- SEC-P3-03 is PARTIAL: HIGH reduced to MEDIUM.
- SEC-P3-05..14 are RESOLVED.

New findings from the verification:
- **SEC-P3-27 (MEDIUM, SEC-COND-05).** `ensure_audit_partitions` is SECURITY DEFINER, owned by `platform_audit_owner`, with `search_path = pg_catalog, public`. The migrator owns `public`, so a function-overload hijack (CVE-2018-1058 class, e.g. `public.pg_advisory_xact_lock(integer)`) runs migrator code as the audit owner.
- **SEC-P3-28 (MEDIUM, SEC-COND-06).** CVC recollection never checks `cvc_check = pass`.
- **SEC-P3-29 (MEDIUM, SEC-COND-07).** Free or unverified accounts are outside the carrier anonymous budget and can drain a daily quota.
- LOW: SEC-P3-30..32. INFO: SEC-P3-33 (documentation drift, including the outdated "KMS has no Ed25519" rationale; KMS has supported Ed25519 since 2025-11-07).

Rulings on the architect's alternatives:
- CVC-only saved-card step-up: accepted as equivalent, conditional on SEC-P3-28.
- ECDSA P-256 anchors: accepted; the original requirement allowed either curve.
- `createQuoteShare` mint-and-revoke: accepted, with SEC-P3-32.

**Why:** G2 proceeds with these as tracked conditions. Each is a small design-text change, not re-architecture. Implementation evidence (SEC-TC-37..64) is owed by G3. The locked anchor sink, RDS master break-glass and pgaudit remain a G4-production precondition. On RDS, C13 must allow the auto-granted ADMIN row of the master user.

**How to apply:** In P5 change reviews and at G3, check first:
- every SECURITY DEFINER and audit-owner function has `proconfig search_path=pg_catalog, pg_temp`;
- `cvc_check` is enforced on both the `confirmPayment` and the webhook paths;
- `quote-create` class and the per-org quota share exist;
- `--ignore-scripts` is everywhere, and gate scripts run from the base ref;
- `x-reauth-scope`/`x-reauth-max-age` sit on the 10 routes.

Related: [[project-security-review-conventions]]
