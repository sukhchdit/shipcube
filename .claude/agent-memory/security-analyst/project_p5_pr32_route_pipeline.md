---
name: project-p5-pr32-route-pipeline
description: PR #32 (TASK-020 defineRoute, request pipeline, SYSTEM port, lint) R1 @fa67aca PASS_WITH_CONDITIONS; R2 @11530cc (delta + PR #20/#33 unions) PASS_WITH_FOLLOW-UPS, C1-C3 closed, new LOW 12/13 + INFO 14-16; an in-PR R2-m1 fix (define-route.ts, owned) needs a round-3 delta
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0032-TASK-020-security-review.md`.
- **R1** is committed on main (`9a69797`).
- **R2** (`## Round 2 (head 11530cc, delta + merge)`, 2026-11-13) was appended uncommitted in the main checkout, giving 423 lines (LF). It has its own `| Head | 11530cc… |` row and a final Verdict row.

**R1** (`fa67aca`): PASS_WITH_CONDITIONS; 01 MEDIUM, 02-07 LOW, 08-11 INFO. C1 = 01 (T-83 blind to handlers), C2 = 02 (credential gate before `public`), C3 = 03 (stubs refuse at mount). D-TASK020-03 confirmed with C2.

**R2** (`11530cc`): **PASS_WITH_FOLLOW-UPS**.
- **Closed:** 01, 02, 03, 05, 06, 07 (a)(b), 09. 04 is closed for the R1 forms. 11 is partly closed: still open are `tests/generated/**`, `app.ts`, `main.ts` and `tools/openapi/**` (015-C).
- **New findings:**
  - **12 LOW**, T-83 and import lexical residuals, owned by 020-C:
    - `defineRoute(spec)` with a const spec;
    - a wrapped or helper-param handler;
    - an aliased factory;
    - `ctx.deps.queue` / `services.queue`;
    - a constructor-injected `TenantDb`;
    - `scheduler.wait` / `Atomics.wait`;
    - a literal dynamic `import('undici')`;
    - an aliased `createRequire`;
    - direct `eval`.
  - **13 LOW**, Joi `prefs/options({allowUnknown:true})`, `Joi.link`→`.shared()` and `Joi.extend` types are accepted and let `role` reach the handler. Same as code review R2-m1. Due before the first body route.
  - **14 INFO**, the signature-only permission gate needs a user actor, so a provider principal always gets 401. Fix the gate, never `authenticated: true`. Owners TASK-171/261.
  - **15 INFO**, `ANONYMOUS.permissions` is a mutable shared Set, and the descriptor's nested `audit`/`reauth`/`deprecated` are not frozen (code review R2-n1).
  - **16 INFO**, refresh-cookie presence is a credential on every route, which conflicts with ADR-0006 R-06. Same as code review R2-m4. Owners: architect, TASK-052/055/027.
- **D-TASK020-21 confirmed:** the stub refuses any presented credential. This is fail-closed and is D-ARCH-107 (5) verbatim. A valid session on `createQuote` is accepted only by the real TASK-052 authenticator, with `quote:create` required.
- Code review R2 (`e8829ef`, APPROVED_WITH_NITS) agrees: m1=13, m3=12, m4=16, n1⊂15.

**Facts (probe-confirmed 2026-11-13):**
- The record checker counts 144 owned paths in the PR's net change; 71 of them changed after `fa67aca`. `apps/api/src/platform/**` has been owned since PR #33.
- 16-scenario sim against `e8829ef`, all as expected. These void the record: `define-route.ts`, `coverage-teardown.ts`, an `eslint.config.mjs` edit, and a main merge that touches an owned path. These keep it valid: a docs-only evidence commit, a docs-only main merge, and an edit to unowned `tests/generated/route-metadata.ts`.
- Lane A run 43457137317 on `11530cc` skipped lint/typecheck/unit/build: the lane-B evidence step failed with Docker hung. I reproduced 11 security suites (247/247) and negative-fixtures (241/241) on a git-archive extract; 5 mutants were all killed.
- Merge-tree:
  - `4789de8` (PR #20 union) has 5 conflicts plus 5 declared hand edits.
  - The other merges are clean auto-merges.
  - The lock, workflows, `tools/ci` and `tools/quality` equal main.

**How to apply:**
- **Round 3 (if R2-m1/PR32-SEC-13 is fixed in-PR):** a delta round on the `define-route.ts` commit only. Check:
  - `preferences.allowUnknown` refused at any node;
  - `link` refused or walked via `describe().shared`;
  - unknown node types refused;
  - one test per form.
  The R2-m2 (`tests/generated`) fix alone does not void the record, but it stales lane B.
- **020-C:** PR32-SEC-12 list plus R4 plus the runtime twin; it needs its own record.
- **TASK-052/055/060/171/261/027:** 14/15/16 matrix rows.

Related: [[project-p5-pr8-authz-review]], [[project-p5-pr20-logging]], [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
