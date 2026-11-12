---
name: project-p5-pr2-lint-controls
description: PR-0002/TASK-002 review, R1 (9bc9c04) and R2 (6ba7649), both PASS_WITH_FOLLOW-UPS. Lint-as-security-control gaps (inline disables, bcrypt residual forms, test-folder/ignore holes, planned Prisma files, ui outbound exclusion) and what to re-check in TASK-004/007/016/025/043/049/112/113 reviews
metadata:
  type: project
---

The PR #2 (TASK-002) review is `docs/05-quality/security/PR-0002-TASK-002-security-review.md`. IDs are PR2-SEC-01..12.
- **R1** (head 9bc9c04): 1 MEDIUM, 4 LOW, 3 INFO.
- **R2** (head 6ba7649): closed PR2-SEC-02 and -03 for their in-PR scope, plus PR2-SEC-01 item 3 (Stylelint `report*Disables`). Added PR2-SEC-09 (LOW) and PR2-SEC-10..12 (INFO).

**Non-obvious facts.** Each was probed with the real config via `lintText`.

- **PR2-SEC-01 (MEDIUM, open, TASK-007).**
  - Inline `eslint-disable` and `/* eslint rule: off */` silently disable the security rules.
  - `any-justification` accepts any `-- text`.
  - A blanket `/* stylelint-disable -- x */` also passes.
  - The fix must be a non-ESLint `tools/lint/check-suppressions.mjs`.

- **PR2-SEC-02 (bcrypt).** It is now a boundaries policy over `bcrypt*` and `@*/bcrypt*`, plus `additional-dependency-nodes` for `createRequire(..)(..)` and `x.require(..)`.
  - **Still clean (residual):**
    - `const req = createRequire(); req('bcrypt')` with any name other than `require`;
    - renamed `createRequire as cr`;
    - `module.createRequire`;
    - non-literal `import(x)`;
    - `Module._load`, `require.call`;
    - in the hasher, local-binding re-export (`import * as b; export { b }` / `export default b`).
  - The Semgrep rule in TASK-007 is mandatory for these forms.
  - **Boundaries: the last matching policy decides.** The bcrypt block sits mid-list, so a later broad `allow` would override it. TASK-049 must move it to the end.
  - **Effective-config test gap.** The test checks only severity, not that the policy is present in the options.

- **PR2-SEC-09 (LOW, TASK-004).** `TEST_FILES` contains `**/{test,tests,__tests__}/**`, so production code in `src/**/tests/` gets category `test`:
  - no layering, and Prisma is allowed;
  - no outbound, innerHTML, audit-writer or console rules;
  - yet it compiles into `dist`, because workspace tsconfigs `include: ["src"]`.

  Fix: anchor the folder globs to `{apps,packages}/*/{test,tests}/**`. Round 1 missed this.

- **PR2-SEC-05 addendum.** `PLANNED_PRISMA_FILES` (audit `prisma-store.ts`, outbox `writer.ts`) are category `db-platform`, so `new PrismaClient()` and `pg` lint clean there. The TASK-016 construction rule must key on the explicit `apps/*/src/platform/db/**` path, not on the category.

- **PR2-SEC-10 (INFO, TASK-113).** `packages/ui/**` is excluded from outbound-http. That is fine under ADR-0016 §13, but no boundaries policy stops api, worker or server packages from importing `@platform/ui`. Only `no-extraneous-dependencies` (the manifest) guards it.

- **PR2-SEC-11 (INFO, TASK-007).** `.gitignore` matches `dist`, `build`, `coverage`, `out`, `logs`, `uploads`, `tmp` and `temp` at any depth. It fails closed (untracked code cannot ship), so it is INFO, not LOW.

- **PR2-SEC-12 (INFO, TASK-025).** The audit-writer allow-list (whole `platform/**`, whole worker) is broader than ADR-0007. This is the disposition of code-review item n5.

- **Other facts.**
  - No CODEOWNERS exists (PR2-SEC-08).
  - `svg-tags` has a legacy `licenses` array (PR2-SEC-07).
  - Dev-only GHSA watchlist: minimatch g3hv, glob 3g3m, deepmerge gcqx. Do not override them.

**Why:** these gaps close only if the later task reviews check them, and the lint rules are cited as mitigations in ADR-0016 §13, ADR-0005, ADR-0007, REQ-SEC-016 and D-ARCH-042.

**How to apply.** In P5 reviews, check:
- **TASK-007:** **met at PR #10 `28442b6`**. Residual: the counter is blind to `gitleaks:allow` outside code file types (PR10-SEC-01); see [[project-p5-pr10-ci-lane]]. Original list:
  - the check-suppressions step and `TASK-\d{3}` in suppression justifications;
  - Semgrep `password-hashing.yml` covering the residual forms, with `--disable-nosem` and run from the base ref;
  - CODEOWNERS;
  - a base-ref fixture suite;
  - legacy licences;
  - `.gitignore` anchoring with a `check-ignore` test.
- **TASK-004:** the TS-only block, `--allow-empty-input`, and `TEST_FILES` anchoring.
- **TASK-049:** the bcrypt block placed last, plus a behavioural coverage test.
- **TASK-016:** construction rule keyed on the explicit path; T-83.
- **TASK-025 / TASK-043:** both files take `TenantDb` and never construct a client; TASK-025 also narrows the allow-list.
- **TASK-113:** the `ui` boundaries policy and the PR2-SEC-04 sinks.
- **TASK-112:** the innerHTML sinks.
- **Every PR before TASK-007 lands:** grep the diff for new disable comments.

Related: [[project-p5-wave0-supply-chain]], [[project-security-review-conventions]]
