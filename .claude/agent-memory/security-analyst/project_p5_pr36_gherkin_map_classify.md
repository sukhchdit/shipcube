---
name: project-p5-pr36-gherkin-map-classify
description: PR #36 (qa-lead D-QA-016, gherkin map v1.1, KNOWN_DRIFT emptied) R1 @3eb7689 2026-11-14 code APPROVED_WITH_NITS + security PASS_WITH_FOLLOW-UPS; the old drift tests were blind to scenario edits in the five stories; reports/ is not git-ignored; AT-US-066-12 G3 dependency
metadata:
  type: project
---

Records (uncommitted in main when written): `docs/05-quality/reviews/PR-0036-qa-gherkin-map-code-review.md` (APPROVED_WITH_NITS) and `docs/05-quality/security/PR-0036-qa-gherkin-map-security-review.md` (Head `3eb7689ed2a85791fd39ee9ba05299a61919b295`, final Verdict PASS_WITH_FOLLOW-UPS). Base `e4ecff2` (main tip), two linear commits (`e88bc46` change, `3eb7689` docs-only evidence run `20261113T1845Z_e88bc46`, accepted by base-ref check-evidence). Owned set = exactly `tools/quality/gen-gherkin-map.test.ts` and `tools/quality/lib/test-ids.test.ts`; record sim 22/22.

**Why it matters:** with the old `KNOWN_DRIFT = [five stories]`, `storiesAsMapped()` rebuilt those stories from the map's own rows, so the byte-identity test was circular for them: appending or renaming a scenario in US-066/US-129 left 32/32 tests green (mutants M1-M3). With the list empty all 7 mutants fail (3 tests for an appended scenario). A "test edit is not a weakening" claim should be proved with a base-vs-head mutation run on the owned tests, not read.

**Findings (no C/H/M/L):** PR36-SEC-01 INFO = TEST-STRATEGY v1.4 §6 rule 2 says `reports/ac-trace.json` is "git-ignored"; `.gitignore` and `.prettierignore` have no `reports` entry, `prettier --check` fails on the generated file (so `format:check` fails locally after a default `quality:trace`), the PR worktree shows `?? reports/` (= PR #35 R2-n1, owner devops with 015-B; doc half fixable in this PR without voiding the record). Code R1-m2: AT-US-066-12 is G3-counted but its `PUT /me/notification-preferences` leg belongs to US-266 / TASK-263 (Should, cuttable); TASK-013's sheet lists 066-01..12 though 06 and 12 need later tasks' routes (TASK-186 sessions). Nits: ratchet should assert `message === ''`, TEST-STRATEGY Date row not bumped, rule 4 and wave-exit still say lane B evidence holds ac-trace.json (true only after 015-B), D-QA-016 sentence misattributes the guard to the kept bridge. PR35-SEC-05 closed (`--check` exit 0).

**Facts worth re-using:**
- The two evidence-run skips are POSIX-only `file-secret-provider` cases on the Windows host, not the docker.lock.
- `tools/ci/check-security-owned-paths.test.ts` fails on a `git archive` extract (it lists records with `git ls-files`): 867/868 there is an extract artefact.
- Quick map proof kit (scratch, session-scoped): `review/PR-36/probes/{mapdiff,mutate,record-sim}.mjs`: parse both maps with `parseGherkinMap`, compare every column; mutation harness applies story/assignments/map edits and runs jest JSON plus `--check`; record-sim with 22 scenarios (A..G8).
- Cleanup of an extract with a junctioned `node_modules`: unlink each entry with `rmdirSync` after an `lstat` check, then `rmSync` the tree; main stayed at 740 entries.

**Checks owed:** any owned-path commit after `3eb7689` (e.g. nit R1-n1) voids the Head row: batch with the next `tools/quality` change; `.gitignore`/`.prettierignore` `/reports/` with 015-B and a `gitignore.test.ts` row; qa-lead + product-manager settle AT-US-066-12 before Wave 7; D-QA-016 wording correction at logging time.

Related: [[project-p5-pr34-pr35-harness-traceability]], [[project-security-review-conventions]]
