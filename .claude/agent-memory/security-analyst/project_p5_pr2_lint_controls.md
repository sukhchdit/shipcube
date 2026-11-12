---
name: project-p5-pr2-lint-controls
description: PR-0002/TASK-002 review (2026-11-12, head 9bc9c04) PASS_WITH_FOLLOW-UPS; lint-as-security-control gaps (inline disables, bcrypt bypasses, .jsx/build ignores) and what to re-check in TASK-004/007/016/049/112/113 reviews
metadata:
  type: project
---

The PR #2 (TASK-002) review is `docs/05-quality/security/PR-0002-TASK-002-security-review.md`. IDs are PR2-SEC-01..08. Verdict: PASS_WITH_FOLLOW-UPS (1 MEDIUM, 4 LOW, 3 INFO).

**Non-obvious facts.** Each was probed with the real `eslint.config.mjs` via `lintText`.
- **PR2-SEC-01 (MEDIUM).** Inline `eslint-disable` and `/* eslint rule: off */` silently disable the security rules: bcrypt, no-innerhtml, outbound-http, audit-writer and boundaries.
  - `any-justification` accepts any `-- text`, even on a blanket disable.
  - The NFR-MAINT-002 "suppression-count script" has **no owning task**. Routed to TASK-007 as `tools/lint/check-suppressions.mjs`, which must be a non-ESLint step, because an ESLint rule can itself be disabled inline.
- **PR2-SEC-02.** The bcrypt confinement is core `no-restricted-imports`. It misses `import('bcrypt')`, `createRequire()('bcrypt')`, `.cjs` require and `bcrypt-ts` / `@node-rs/bcrypt`.
  - The hasher override turns the whole rule off, so the hasher module can re-export bcrypt.
  - Flat config replaces options, so a future `no-restricted-imports` block clobbers the pattern.
  - A Semgrep backstop is **mandated** in TASK-007, run with `--disable-nosem`.
- **PR2-SEC-03.** Files that silently lose rules:
  - `.jsx` has no matching config, so `eslint .` skips it;
  - `globalIgnores` `**/build|coverage|dist/**` match at any depth ("coverage" is a shipping domain word);
  - Stylelint lints 0 CSS files and `--allow-empty-input` hides it.
- **PR2-SEC-05.** The ADR-0005 "root PrismaClient not exported outside platform/db (lint)" rule and the T-83 withTenantTx lint are unowned. Repositories can `new PrismaClient()`.
- **No CODEOWNERS file exists** (PR2-SEC-08), although D-ARCH-003 rev 4 and platform.md assume one.
- **`svg-tags@1.0.0`.** Its licence is only in the legacy `licenses` array. The lockfile has no `license` field, so a lockfile-only licence-check would fail it.
- **Dev-only GHSAs on the watchlist:** minimatch g3hv (fixed 11.0.1), glob 3g3m (fixed 14.0.2), deepmerge gcqx (no fix). Prod closure = 0. Do not override them.

**Why:** these gaps close only if the later task reviews check them, and the lint rules are cited as mitigations in ADR-0016 §13, ADR-0005, REQ-SEC-016 and D-ARCH-042.

**How to apply.** In P5 reviews, check:
- TASK-007: check-suppressions step, `any-justification` requires TASK-ID, `.semgrep/password-hashing.yml`, Semgrep sink lists matching PR2-SEC-04, CODEOWNERS, a base-ref fixture suite run against the head config, legacy-licences handling.
- TASK-004: TS-only block for `apps/*/app`, anchored ignores, Stylelint actually linting CSS, stylelint `report*Disables`.
- TASK-049: `platform/password-hasher-only` local rule plus `config-coverage.test.ts`.
- TASK-016: `prisma-client-construction` rule and T-83.
- TASK-112 / TASK-113: the extended innerHTML and outbound sinks.
- Every PR before TASK-007 lands: grep the diff for new `eslint-disable` and `eslint ` inline comments.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]]
