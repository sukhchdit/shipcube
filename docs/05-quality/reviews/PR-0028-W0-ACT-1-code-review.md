# Code review: PR #28 W0-ACT-1 suite activation (qa-lead), round 1

| | |
|---|---|
| Verdict | **APPROVED_WITH_NITS** |
| Branch / head | `chore/W0-ACT-1-activate-suites` @ `22c6461d32aa0400e616d1ed425f1625fb84ebfa` (merge of main `9d188fd` into evidence commit `dbfe4df`) |
| Basis | D-ARCH-082 as amended by D-ORCH-030, D-SEC-PR23-02, D-ARCH-090; COND-PR23-2 / PR23-SEC-02; D-QA-014; D-ORCH-034 |
| Scope reviewed | `tools/quality/required-suites.json`, `tools/quality/activation.test.ts`, `docs/05-quality/README.md`, `docs/05-quality/TEST-STRATEGY.md` v1.1 §9.1–9.3, D-QA-014, evidence run `20261113T0645Z_11f1877` (and superseded `…0616Z_629a84d`) |

SUMMARY: The activation is correct and minimal. Only the five suites that have a `suite-runners.json` entry and tests on `main` are made active. The four parked SEC-TC IDs really have no test anywhere in the repo. The new test holds the active-needs-runner invariant under mutation. No BLOCKER or MAJOR. One real consequence the orchestrator must plan for (§5): from the next PR on, every non-docs PR needs fresh heavy evidence, and `.claude/**` commits on main make that evidence stale after any merge of main.

## 1. Verification I performed

Constraints honoured: no Docker, no full suites, no installs; targeted `tools/quality` tests only; lane A run 43381750062 relied on for lint/format/typecheck/full unit.

- **Lane A (run 43381750062, head 22c6461):** `fast-lane` success. `scans` fails only on the step "Security-owned paths need a review record" (expected: `tools/quality/**` is code-owned and security-analyst has not yet committed `PR-0028-*`). `ci-gate` fails only on "Aggregate lane A" because of that. In the Lane B evidence step the base-ref checker printed "run 11f1877 rejected (unit planned on base)", "run 629a84d rejected" and `check-evidence: PASS`.
- **Scratch clone** (`git clone` of the worktree at 22c6461, node_modules junction to the worktree, all removed afterwards; worktree `git status` clean, node_modules count still 748, no `C:\node_modules`):
  - `activation.test.ts` + `lib/manifest.test.ts`: 38/38 pass.
  - **Mutation run of `activation.test.ts`** (edit manifest/runners in the clone, run the test):

    | Mutation | Result |
    |---|---|
    | remove the `api` runner entry | caught |
    | add an orphan runner `bogus` | caught |
    | pending entry on a `planned` suite | caught |
    | ID both in `required_cases` and pending | caught |
    | checkpoint outside {Wave-0 exit, v0.1.0-m0, G3} | caught |
    | empty owner | caught |
    | same ID pending in two suites | caught |
    | pending ID that a passing test on `main` already carries (SEC-TC-05 on catalog) | **not caught** (see n2) |
    | a pending entry whose checkpoint has been reached | **not caught** (see m1) |
  - **Head checker on the activated manifest.** A fake base (9d188fd + the PR's manifest) was used so that the head checker reads the activated manifest. Results are in §5.
- **Claim "no test on main carries SEC-TC-14/55/22/29":** `grep -rE 'SEC-TC-(14|55|22|29)'` outside `docs/` and `node_modules` hits only `required-suites.json` and the checker's own id-matching tests (`check-evidence.mjs:247`, `check-evidence.test.ts:398,508`, which are fixtures, not suite tests). Confirmed. `SEC-TC-05` is carried by two passing catalog cases (`prisma/tests/catalog/c01-c12.int.test.ts:445` C4 and `:680` C11), so keeping it in `catalog-c1-c14` is right.
- Manifest diff is minimal: five `status` flips, four `required_cases` edits, two `tooling_inputs` lines, the new informational key, a date bump. Nothing else changed. `parseManifest` tolerates the new key (checker runs cleanly).

## 2. Focus (1): only suites with runners are active; activation test

Correct. Active set = `unit, integration, api, catalog-c1-c14, migrations` = exactly the keys of `suite-runners.json`. The test proves active ⇒ runner (real manifest) and that the check fires (mutation case: `lint` flipped to `active` on the parsed copy, with an explicit `runnerIds.has('lint') === false` precondition so the mutation case cannot go vacuous). It also proves no orphan runner and that the W0-ACT-1 five stay active, so a silent revert fails.

`required_cases_pending` invariants hold under mutation: active suites only, well-formed ID, non-empty owner, checkpoint in the D-ARCH-082 set, disjoint from `required_cases`, unique. Abuse resistance:

- The key is informational (the verifier reads only `required_cases`), so moving an ID there is a deliberate manifest edit on a code-owned, security-record-gated path.
- The base-ref rule means the PR that parks an ID is judged by the old `required_cases`.
- The hard rule (a skipped or failed SEC-TC testcase fails in any suite) is untouched.

The remaining gap is that nothing mechanical enforces the due checkpoint (m1).

## 3. Focus (2): D-QA-014 parking

Parking is correct and the owners/checkpoints are plausible:

| ID | Owner | Checkpoint | Assessment |
|---|---|---|---|
| SEC-TC-14 | TASK-049 (Wave 1, 1.4) | v0.1.0-m0 | plausible; its AC names SEC-TC-55's pre-hash part, which covers the same two-100-byte-passwords assertion |
| SEC-TC-55 | TASK-049 + TASK-057 (1.6) | v0.1.0-m0 | plausible; both AC name it (`plan-data.mjs:161,180`, `WAVE-01.md`) |
| SEC-TC-22 | TASK-172 (Wave 6, 6.2) | G3 | plausible by wave; TASK-172's AC does not name it (m3) |
| SEC-TC-29 | TASK-020 (Wave 0, 0.6) + first authenticated route | v0.1.0-m0 | plausible; AC does not name it (m3). The catalog (`security-test-cases.md:48`) says "Wave 0 (API helper)", so `v0.1.0-m0` is looser than the catalog; "Wave-0 exit" would be tighter if TASK-020 really lands the helper |

## 4. Focus (3): evidence run protocol

- Profile `pr` only, one suite (`unit`: 2592 tests, 0 failures, 0 errors, 2 skipped; the skips are POSIX-only cases, `unit` is not zero-skip, none carry a SEC-TC). `git_dirty:false`, `build_clean:true`, `env_overrides:[]`, no wave/gate run committed.
- Evidence commit `dbfe4df` adds only the run directory. Its message carries the D-SEC-PR23-02 gate table (install before run, empty `info/exclude`, clean tree, pr only).
- Rule-4 rejection on the base checker: confirmed in lane A (above). Head checker accepting: true at `dbfe4df` as the PR states, **not true at the pushed head** (§5, m2).
- One extra run `0616Z_629a84d` is still committed (superseded, stale). Harmless noise (n1).
- **"Evidence one merge behind head":** acceptable *for this PR*. On the base manifest `unit` is `planned`, so evidence is uncredited and not needed regardless of staleness. A re-run would only go stale again at the next commit on main. No re-run requested.

## 5. Focus (5): operational consequence after merge (for the orchestrator)

Reproduced on a scratch clone with an activated base manifest (base = 22c6461 stand-in for post-merge main):

| Change | Result |
|---|---|
| `docs/**`-only PR (e.g. `docs/zz.md`) | PASS, "no active lane B suite required" |
| `.claude/**`-only PR | FAIL: `unit` required, no accepted evidence |
| Root-file PR (e.g. `CLAUDE2.md`) | FAIL: same |
| This PR's own head checked as a *next* PR would be (base = activated manifest, head 22c6461) | **FAIL**: run 11f1877 "stale: 7 path(s) outside the staleness allow-list changed since 11f1877: `.claude/agent-memory/...`" |

Consequences:

1. **Every PR that touches any path outside `docs/**` and `.github/**` must commit a fresh `quality:heavy --profile pr` run** whose `git_sha` is an ancestor of the head, with only `docs/**` (minus `docs/03-architecture/api/**` and the tooling inputs) changed after it. A path that matches no path rule (`.claude/**`, root files, `tools/**`, `tests/**`) selects lane B and so `unit`. Backend paths additionally select `integration`, `api`, `catalog-c1-c14`, `migrations` etc., which need Docker under `docker.lock`. The pre-run `npm ci --ignore-scripts` + `npm run deps:rebuild` + clean-tree gate table (D-SEC-PR23-02) applies to each.
2. **Any merge of main into a PR branch after the evidence commit stales it** if main brought a non-docs change. Main receives `.claude/agent-memory/**` commits routinely, and `stalenessAllowed` is `docs/**` only (`lib/manifest.mjs:297`). So the cycle is: merge main, then `npm ci`, then heavy, then evidence commit, then push; and evidence must be the last non-docs-affecting step. Each of those runs is minutes (unit alone: about 108 s plus coverage; plus install). Concurrent PRs (#20, #24, #27, TASK-019/032 in-flight) are each invalidated by every main commit that carries `.claude/**` or code.
3. This matches D-ORCH-034 (2)-(3), which already records both the rule and the planned devops fix. My reproduction confirms it is real and applies to *this* PR's own mechanics proof.
4. Mitigations until the devops checker change lands:
   - the orchestrator batches `.claude/agent-memory` commits with docs commits and avoids pushing them while a PR is about to merge (D-ORCH-034);
   - a PR should take its last merge of main, then run evidence, then push nothing but docs;
   - a docs-only PR is unaffected.
5. Fix direction (not in this PR):
   - **Staleness only:** allow a *narrow* `.claude/agent-memory/**` pattern in `stalenessAllowed` (devops; the code is `lib/manifest.mjs`, base-ref read).
   - **Selection:** decide separately whether the same pattern joins the `docs-or-ci-only` path rule. A staleness-only change leaves memory-only PRs requiring `unit`.
   - Keep `.claude/settings*` and `.claude/agents/**` non-docs: they hold permissions and agent definitions.
   - Needs a security record because it touches `tools/quality/**`.

## 6. Findings

| ID | Sev | File:line | Issue | Why it matters | Required fix |
|---|---|---|---|---|---|
| R1-m1 | MINOR | `docs/05-quality/TEST-STRATEGY.md` §9.2 rule 5 / §9.3 "Pending required cases"; `docs/05-quality/README.md` "Required cases" | The due checkpoint of a pending ID is recorded but never checked: a parked ID can sit at `G3` and no rule, test or gate step fails. Backstop today is only the human "SEC-TC 64/64" line (§ G3 verification report) | The parking mechanism is the one new fail-open path this PR introduces; "back by checkpoint X" is a promise without an owner for the check | Docs, before merge: add one sentence to §9.2/§9.3 and README: at `v0.1.0-m0` and at G3 (`gate` profile) `required_cases_pending` must hold no entry whose checkpoint has been reached (quality-gatekeeper verifies; a leftover entry is FAIL unless it carries a D- ID). Follow-up task (devops, with the Wave-0-exit runner PR): `check-evidence --profile gate` fails on a non-empty pending list without a D- ID. Docs-only, so no evidence re-run |
| R1-m2 | MINOR | PR body "Head checker (activated manifest, same range) PASS, run 11f1877 accepted"; `docs/05-quality/README.md` "Suite activation" | The claim is true at `dbfe4df` (the range the PR states) but false at the pushed head 22c6461, where `.claude/agent-memory/**` changed since 11f1877 (§5). README says nothing about the steady-state rule or the `.claude/**` staleness gap, only D-ORCH-034 does | A reader (or the next qa-lead) reads "mechanics proven" and is surprised on the first PR | Reword the PR body to "accepted at dbfe4df; stale at 22c6461 only because of `.claude/agent-memory/**`". Add a README bullet "After activation": the §5.1–5.2 rules, linking D-ORCH-034. Docs-only |
| R1-m3 | MINOR | `tools/quality/required-suites.json` `required_cases_pending` (SEC-TC-14, -22, -29) | Only SEC-TC-55 is named in an owner task's acceptance criteria (`plan-data.mjs:161,180`). SEC-TC-14 is covered in substance by TASK-049's SEC-TC-55 clause; SEC-TC-22 (TASK-172) and SEC-TC-29 (TASK-020) appear in no task AC (grep over `docs/04-plan`, `docs/01-requirements`) | An owner who is not told about the case will not deliver it; the pending list then relies on the checkpoint check that R1-m1 shows is missing | Follow-up (senior-developer, before TASK-020 is dispatched, as it is Wave 0): add SEC-TC-29 to TASK-020's AC, SEC-TC-22 to TASK-172's, SEC-TC-14 to TASK-049's. Consider tightening SEC-TC-29's checkpoint to `Wave-0 exit` per `security-test-cases.md:48` |
| R1-n1 | NIT | `docs/05-quality/tests/runs/20261113T0616Z_629a84d/` | Superseded, stale run still committed (about 5.5k lines) and will land on main | Noise in `tests/runs`, `prune.mjs` has to remove it later | `git rm -r` the directory (docs-only, allowed after the evidence commit); keep `0645Z_11f1877` as the audit trail of the gate table |
| R1-n2 | NIT | `tools/quality/activation.test.ts:71-90` | Pending entries are checked structurally only: a pending ID that a passing test already carries (mutation M6) or a free-text owner that names no task goes undetected | After the owner task merges, nothing prompts the move back | Optional: assert each `owner` string contains a `TASK-\d{3}`; optional name-grep helper that fails when a pending ID appears in a test name on main ("move it back") |
| R1-n3 | NIT | `docs/05-quality/README.md` status table, "Next: Wave-0 exit" row | Omits the PR body's precondition that PR23-SEC-03/04/05 must merge before the generator/security suites are activated | Table reads as unconditional | Add "after PR23-SEC-03/04/05" to the row |

No BLOCKER, no MAJOR.

## 7. Deviation rulings

- **Parking in a new informational key instead of keeping IDs in `required_cases` or deleting them:** accepted. Keeping them would FAIL every PR selecting `unit`; deleting loses tracking.
- **Activating `api` before its Wave-0-exit deadline** (D-ORCH-030): accepted; it has a runner and 80 passing tests.
- **Rejecting `activate in the PR that adds the first test`** in favour of manifest-only checkpoint PRs: accepted; consistent with rule 4 and the interim controls.
- **Uncredited activation evidence at W0-ACT-1:** accepted; it is the intended behaviour of rule 4, proven in lane A.

## 8. GOOD

- Mutation case with a vacuity guard in `activation.test.ts`.
- Failure modes were found by running the real base-ref checker against the PR's own run, not by argument, and the SEC-TC parking was verified by name search.
- Doc claims are mostly checkable (the gate table in the evidence commit message).
- The README Rule-4 text was separated out of the FAIL list (closes PR #23 R2-n1).

## 9. SECURITY-FLAGS (for security-analyst)

- `tools/quality/**` is code-owned: PR23 record step is red until `docs/05-quality/security/PR-0028-W0-ACT-1-security-review.md` exists with a PASS-family verdict naming a commit after which no owned path changed. Merging `ccc1082` (docs/`.claude` only) does not touch owned paths.
- Rule on the exact narrow `.claude/` pattern for the staleness fix (D-ORCH-034 (3)). Reviewer note: `.claude/settings*` and `.claude/agents/**` must stay non-docs.
- `required_cases_pending` is a documented fail-open channel guarded only by code ownership and the security record; endorse or require R1-m1.
- Evidence host fields in `summary.json` (CPU model, RAM, versions) are standard schema content, no secret-shaped values seen.

## 10. Merge conditions

1. security-analyst record `PR-0028-*` with PASS / PASS_WITH_FOLLOW-UPS committed so that lane A's `scans` and `ci-gate` go green; no owned-path change after it.
2. R1-m1 and R1-m2 doc edits (README + TEST-STRATEGY wording, PR body) landed as a docs-only commit. This does not invalidate the security record or evidence. R1-n1 and R1-n3 may ride along.
3. Lane A green on the final head apart from the record step before it exists.
4. Follow-ups tracked: R1-m3 (senior-developer), R1-m1 gate check (devops, Wave-0-exit runner PR), `.claude/agent-memory` staleness pattern (devops, after the security ruling), R1-n2 optional.
5. Orchestrator: brief every subsequent build/fix dispatch with the §5 evidence cycle and hold `.claude/agent-memory` pushes while a PR is about to merge.
