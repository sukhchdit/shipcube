---
name: project-p5-pr32-route-pipeline
description: PR #32 (TASK-020 defineRoute, request pipeline, SYSTEM port, lint) R1 @fa67aca PASS_WITH_CONDITIONS; R2 @11530cc PASS_WITH_FOLLOW-UPS; R3 @308eb83 (delta + code review in one pass) PASS_WITH_FOLLOW-UPS, SEC-13/15 closed, new INFO 17; records appended uncommitted
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0032-TASK-020-security-review.md`; code review twin `docs/05-quality/reviews/PR-0032-TASK-020-code-review.md`.
- **R1** is committed on main (`9a69797`); **R2** (`6420f90`, 423 lines).
- **R3** (`## Round 3 (head 308eb83, delta)`, 2026-11-14): security +221 lines (644 total), code review +85 (375 total), both LF, appended uncommitted in the main checkout for the orchestrator to commit. Own `| Head | 308eb83… |` row and a final `| **Verdict** |` row.

**R1** (`fa67aca`): PASS_WITH_CONDITIONS; 01 MEDIUM, 02-07 LOW, 08-11 INFO. C1 = 01 (T-83 blind to handlers), C2 = 02 (credential gate before `public`), C3 = 03 (stubs refuse at mount).

**R2** (`11530cc`): PASS_WITH_FOLLOW-UPS. C1-C3 and 01, 02, 03, 05, 06, 07 (a)(b), 09 closed; 04 closed for the R1 forms. New LOW 12 (T-83 lexical residuals, 020-C), LOW 13 (Joi prefs/link/extend), INFO 14, 15, 16.

**R3** (`308eb83`): **PASS_WITH_FOLLOW-UPS**; code review APPROVED_WITH_NITS (R3-n1..n3).
- **Closed:** PR32-SEC-13 (65-case bypass matrix: 22 leak on `11530cc`, 0 on head; nine requested families clean), PR32-SEC-15 (readonlySet, 38 probes, backing Set unreachable; descriptor deep-frozen), code review R2-m1/m2/n1/n3. D-TASK020-28..31 accepted; D-TASK020-30 checked against 15 other `prefs` forms.
- **New INFO PR32-SEC-17:** the Joi extension walk fails closed on `_definition` only. Renaming `$_terms` is test-gated, not run-time gated; the `definition === undefined` clause, the depth guard and the `seen` set are surviving mutants. Fix with the next edit of `define-route.ts`.
- **Still open:** LOW 12 (020-C, D-ARCH-111); INFO 14 (D-ARCH-110) and 16 (D-ARCH-109), both coded in the part 020-B follow-up, due before TASK-027 merges and before TASK-052 starts; R2-n2 stale `boundary.test.ts` comment (owned file, so route to 020-B); 07(c), 08, 10, 11 rest.
- **Owed by me:** the threat-model wording of D-ORCH-051 (4) (R-06, T-17, T-06, §4.3, T-83, a new SEC-TC for foreign credentials), "next text round".
- Lane A 43498977127 ran every gate on 308eb83. Real `check-evidence --profile pr` PASS on run `20261113T1958Z_5a145a8`. Host-fragment scan 0. Record sim: 29 scenarios as expected.

**Facts (probe-confirmed):**
- Owned paths: 145 in the net change. `package.json` is a PR-changed owned path (`test:contract`), so a main merge that edits it (PR #35's `quality:*` scripts did) voids the record; docs-only main merges and main-only owned paths do not. `tests/generated/**` and `packages/shared/src/http/**` are unowned (record stays valid), but they stale the lane-B evidence. Editing `storage/boundary.test.ts` voids the record (146th owned path).
- Joi 18.3.2: `Joi.types()` has 15 entries (12 distinct names; `alt`, `bool`, `func` are aliases). An extended root keeps the built-in definitions of types it does not redefine, and a redefined type gets a new `_definition`. `when` branches do not carry the sneaky type's validate (the concat keeps the base definition). `context`, `externals` and `warnings` cannot be set by schema-level `prefs`. `$_terms` holds only plain objects, arrays and the `Keys` array subclass above any schema; the only class instances are references and `RegExp`s.
- Deliberate tamper (own `describe` override on a schema instance) bypasses the walk: same class as PR32-SEC-12 (i)/(j), not a finding.
- R3 slip: my first command ran read-only `git log`/`git status` inside the PR worktree (disclosed in both records).

**How to apply:**
- **Before merge:** no non-docs commit and no main merge touching a shared owned path after the R3 record. A docs-only main merge, or a main change to a path the PR does not change, keeps it.
- **Part 020-B follow-up:** a record is required; ride PR32-SEC-14/16 code, R2-n2 and PR32-SEC-17 if `define-route.ts` is opened. **020-C:** PR32-SEC-12 plus the R4 line.
- **TASK-052/055/060/091/171/261:** build `Principal.permissions` with `readonlySet`; TASK-060 reads permissions only behind the credential check.

Related: [[project-p5-pr8-authz-review]], [[project-p5-pr20-logging]], [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
