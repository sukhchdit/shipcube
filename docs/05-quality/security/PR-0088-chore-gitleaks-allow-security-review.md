# PR-0088 / D-DEVOPS-003: change-scoped security review (commit-bound Gitleaks allow entries for the three PR080-SEC-07 merge commits)

| Field | Value |
|---|---|
| PR | #88 `ci(gitleaks): commit-bound allow entries for three merge commits (pr080-sec-07)`, https://github.com/sukhchdit/shipcube/pull/88 (D-DEVOPS-003). PR080-SEC-07 route (c) of D-SECPR040B1-02 |
| Branch | `chore/gitleaks-allow-merge-commits-pr080-sec-07`: one commit on `88fd7360` (main when the PR was opened); 2 files, +151 / -2 |
| Head | 641ff03cd904a6c153eef3d99b114d961a86878d |
| Main when written | `f8fc27b2` when committed (local main; `origin/main` `5e30d908`). Since `88fd7360`, 35 commits on main changed only `docs/**` and `.claude/agent-memory/**`, none of the two owned paths, so the PR branch needs no main merge for this record (§5) |
| Security-owned paths changed (main's checker) | `.gitleaks.toml`, `tools/ci/sec-static.test.ts` (2) |
| Dependencies / workflows | None. `package.json`, `package-lock.json`, `.npmrc` and `.github/**` are untouched |
| Binding items checked | D-SEC-PR45-01 conditions 1 to 7 and its lifetime rule; D-SEC-PR25-01; D-SECPR040-02 (record-bound commits); PR080-SEC-07 routes (a) to (c) (D-SECPR080-03, D-ORCH-168); PR45-SEC-01, PR45-SEC-02 pattern; PR25-SEC-02; PR10-SEC-01, -03, -08; PR46-SEC-17 (tested base = `HEAD^1`); D-DEVOPS-001 to -003; D-SECCHORE-01; D-ORCH-173; CLAUDE.md §5 (no history rewrite) |
| Code-review twin | D-CRCHORE-02, `docs/05-quality/reviews/PR-0088-chore-gitleaks-allow-code-review.md` on main (`b1bc9a8c`): APPROVED_WITH_NITS (R1-m1, R1-m2, R1-n1, R1-n2). I cite it and rule on its items in §3.6; I do not repeat its checks |
| Reviewer / date | security-analyst, 2026-11-21. Read-only on the branch: no command ran in the `Shipqube-GLALLOW` worktree or in any task worktree; every commit was read from the shared object store of the main checkout (`git show`, `git diff`, `git merge-tree`, `git fetch`). `gh pr view` / `gh pr list` were read-only. No `.env*` file was opened. The flagged phrase was compared only by hash, length and character class and is not written here or in any scratch output. Docker: the pinned image `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0…` (the local image id equals `ci.yml`'s `GITLEAKS_IMAGE` digest), run with `--pull=never --network none` and `.git` mounted read-only. All 23 runs happened in one hold of the shared `docker.lock` directory (owner file naming this review, 18:06:16Z to 18:10:45Z, released at once). Only rule id, commit, path and line were read back from the JSON reports, and every report has `Secret = REDACTED`. The container also scanned history that contains `.env.example` hunks; no finding fell on such a path, and nothing from them was read. The scratch files are removed at the end |

## 1. Summary

**The three tables are exact, the value is not a credential, and the change weakens no gate.**

- **Not a credential (condition 1).** The flagged value is a 12-character doc-comment phrase (12 distinct characters, lower-case letters and one `=`, entropy 3.585). It comes from TASK-051's own comment line `b34f954e:prisma/tests/catalog/tenant-keys.ts:75`, which main's D-ORCH-147 triage bullet quoted at `docs/sdlc/DECISIONS.md:7697`. Line 7697 is byte-equal in `d7585e78` and in the three merges, and each merge's first-parent diff adds it. Nothing needs rotating.
- **The shape is the D-SEC-PR45-01 shape (conditions 2 and 3).** One table per merge commit: `condition = "AND"`, `regexTarget = "line"`, one full SHA, `targetRules = generic-api-key`, the anchored path `^docs/sdlc/DECISIONS\.md$`, one `^\n?<exact line>$` pattern whose only non-literal part is `[a-z=]{12}`, and a fingerprint comment. The three patterns are identical and match the real line with and without the leading newline, and nothing else (§3.1).
- **Real image (condition 5).** With the pinned image and lane A's flags, each merge range goes from exactly one finding (its merge's `DECISIONS.md:7697`) to 0. Main's `d7585e78` (same line, path and rule) and `ed156913` (other path) stay reported. #88's own lane A range is 0 with main's config, and main's whole first-parent ancestry gives the same 19 findings with both configs. In a scratch repository a table rebound to a scratch commit removes exactly the two exact lines and keeps the 17 other findings (other commits, four other paths, nine near-miss shapes). Removing its commit, its path or its class limit, or scoping it to another rule, changes the outcome exactly as predicted (§3.2).
- **The pins catch every widening of the new tables (condition 4).** 26 mutants of `.gitleaks.toml` (plus 2 controls) through the head's own gitleaks tests: the 21 that widen or rebind one of the three tables, or change a global key the tests pin, all turn the suite red. Five stay green, and all five are known pre-existing levers: `[extend] disabledRules`, a widened PR1-SEC-11 path and a widened dd7a2dd value class (PR45-SEC-01), a `[[rules]]` override (PR25-SEC-02), and swapped fingerprint comments (code review R1-n1, cosmetic) (§3.4).
- **Its own PR with a record (condition 6):** this record. **The text leaves before the affected PRs merge (condition 7):** main reworded both DECISIONS.md copies in `1a2b9d7d` (D-ORCH-168), and the three branches never edit DECISIONS.md, so a squash of each head into main takes main's wording: 0 copies of the phrase in the simulated squash trees and 0 added lines carrying it (§3.3).
- **After the merge.** Lane A reads `.gitleaks.toml` from the tested base `HEAD^1` (main at the event), so each task PR needs a fresh `pull_request` event once #88 is on main; a re-run of an older run keeps its old test merge (§3.5). gitleaks-full and its int test are unaffected: the three merges are not in main's ancestry, and on a branch that holds both a table and #85's baseline line the baseline line is just unused, which the runner allows (it checks format, duplicates and count only).

**Rulings:**

| | Question | Ruling |
|---|---|---|
| (a) | Is the flagged value a secret? | **No.** Provenance by hash to TASK-051's comment line (§3.1) |
| (b) | Can a table suppress anything except the one intended fingerprint per merge? | **No.** With the real image each table removes only its own merge's line 7697 (three ranges, 1 to 0), and main's ancestry is unchanged (19 and 19). In a scratch repository a table bound to a scratch commit spares other commits, other paths, other rules and every near-miss line. A full SHA fixes the content of its commit, so no future commit can match (§3.2) |
| (c) | Is the local-only `c33e5e92` in the D-SEC-PR45-01 class (code review R1-n2)? | **Yes, through D-SECPR040-02 (record-bound commits).** My TASK-044 round-3 record binds head `33262314`, whose direct parent is the merge `c33e5e92`. Redoing that merge now would void the binding and owe a new merge-only round. Condition C4: TASK-044 pushes a head that contains `c33e5e92`, or, if it redoes the merge instead, the table is dead at once and joins PR88-SEC-01 (§3.6) |
| (d) | PR45-SEC-01 was due before this `.gitleaks.toml` change (code review R1-m1): fold or re-date? | **Re-dated, not folded.** #88's own tables are fully pinned (every widening of them is red), and the three open levers are pre-existing, need a security-owned change with its own record, and cannot act on the PR that adds them (lane A reads the tested base's config). New due: inside the retirement PR of PR88-SEC-01 (the next `.gitleaks.toml` change) and before G3 in any case (§3.6) |
| (e) | Retirement owner and trigger (code review R1-m2) | **PR88-SEC-01 (INFO)**, merged with PR85-SEC-01: one shrink-only PR by devops-engineer (§3.6, §4) |
| (f) | Do main's own fingerprints (`d7585e78`, `ed156913`) need tables? | **No.** No PR range `base..head` holds main's ancestry; they stay in the gitleaks-full baseline (D-SEC-PR45-01: history hits on main are baseline-only). With the real image both stay reported under #88's config (1 and 1 each, R4 and R5) |

Findings: **1 new INFO (PR88-SEC-01).** PR45-SEC-01 (LOW) is carried and re-dated. No Critical, High or Medium.

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-1** Provenance | A Node script read line 7697 of `docs/sdlc/DECISIONS.md` at `d7585e78` and at the three merges, the first parents of the merges, their first-parent `-U0` diffs, and `prisma/tests/catalog/tenant-keys.ts` at `b34f954e`. It printed only lengths, character class, entropy, sha256 prefixes, line numbers and equality flags | §3.1 |
| **P-2** Real Gitleaks image, git mode | Lane A's flags (`git /repo --config … --log-opts="--diff-merges=first-parent <range>" --ignore-gitleaks-allow --redact --no-banner --exit-code 1`), `.git` only and read-only, `--network none`, `--pull=never`, plus a JSON report in a scratch `out` directory. The whole-ancestry runs used gitleaks-full's log options (`--diff-merges=first-parent --text --no-textconv --no-ext-diff <sha>`) without a baseline. 15 runs on the real repository (configs: main `88fd7360` as "before", head `641ff03c` as "after") and 8 on the scratch repository. A script compared each result with a prediction written before the run: 20 of 20 matched | §3.2 |
| **P-3** Scratch probe repository | Built with git plumbing only (`hash-object`, a temporary index, `commit-tree`, `merge-tree`), no checkout: a base, a branch commit `X` with 11 shapes of the line in `docs/sdlc/DECISIONS.md` and the exact line at four other paths, a main-side commit `Mn` that adds the line, the merge `M` of `Mn` into `X` (so `M`'s first-parent diff adds it, like the real merges), and a later commit `Y` that adds it again. Phrases are random at run time (12 distinct characters, one `=`, entropy 3.585), never printed. Configs: main, head, the head with the TASK-044 table rebound to `X` or to `M`, and four controls on the `X` table that must change the outcome or prove a binding is load-bearing (commit removed, path removed, class widened to `[A-Za-z0-9=-]{11,13}`, `targetRules` set to another rule). A faithful Node emulation flagged all 21 planted findings first, so every shape is a real candidate | §3.2 |
| **P-4** The pins | The head's own gitleaks tests in-process against 28 variants of `.gitleaks.toml` (2 controls, 26 mutants) | §3.4 |
| **P-5** Condition 7 | `git merge-tree --write-tree <main> <head>` for the three heads; phrase count in the resulting DECISIONS.md and in the squash diff (equality only) | §3.3 |
| **P-6** Lane A and gitleaks-full | `ci.yml` at main (tested-base step, Gitleaks step, triggers), `tools/quality/gitleaks-full.mjs` and `gitleaks-full.int.test.ts` at main and at #85's head, D-SECCHORE-01 | §3.5 |
| **P-7** Record check | Main's `tools/ci/check-security-owned-paths.mjs` in a `clone --shared` sparse clone, merge-ref form: the record committed on main, GitHub's test merge with the head simulated by `merge-tree` + `commit-tree`, 10 scenarios (6 negative controls) | §5 |
| Source review | The whole diff (`.gitleaks.toml` +41, `sec-static.test.ts` +110 / -2), the helpers it relies on (`literals`, `commitBoundViolations`, `allowedBy`), D-DEVOPS-003 and the code review twin | — |

## 3. Rulings

### 3.1 The flagged value is not a credential (condition 1)

| Check | Result |
|---|---|
| The flagged line | `d7585e78:docs/sdlc/DECISIONS.md:7697`, 325 bytes: main's D-ORCH-147 triage bullet. It quotes one value in backticks after "key columns, ": 12 characters, 12 distinct, lower-case letters and exactly one `=`, Shannon entropy 3.585 (the rule's threshold is 3.5; the `=` is why the rule's all-letters allowlist does not apply) |
| Origin | `b34f954e:prisma/tests/catalog/tenant-keys.ts:75`, TASK-051's own commit: a comment line (92 bytes) that holds the same value, the only line of that file that does. It is a column-pair notation in a doc comment, not a key, token or password |
| The same line in the merges | Line 7697 of `docs/sdlc/DECISIONS.md` in `c33e5e92`, `0ccdd009` and `aade2672` is byte-equal to `d7585e78`'s (sha256 prefix `429e5a9b7e2a5977`). None of the merges' first parents (`cbd590db`, `a4aadd2e`, `12b8a10a`) holds it; each first-parent diff adds it at line 7697, not as the first line of its hunk |
| The patterns | The three regexes are identical. Against the real line they match `"\n" + line` and `line`, and not `"\n\n" + line` or `line + "\n"` |
| Exposure | 0 occurrences of the value in `.gitleaks.toml`, `sec-static.test.ts` and the commit message at `641ff03c` |
| Ruling | **Not a credential.** Nothing to rotate; D-SEC-PR45-01's false-positive class applies |

### 3.2 Exactness with the real image (condition 5)

Real repository (the main checkout's `.git`, read-only), lane A's flags. "Before" is main's `.gitleaks.toml` at `88fd7360`, "after" is the head's:

| ID | Range (`--diff-merges=first-parent`) | Before | After |
|---|---|---|---|
| R1 | `4ba683ad..33262314` (TASK-044: 7 commits, merge `c33e5e92`) | 1: `c33e5e92` `docs/sdlc/DECISIONS.md:7697` `generic-api-key` (exit 1) | 0 (exit 0) |
| R2 | `4ba683ad..9d1687b1` (040-B: 7 commits, merge `0ccdd009`) | 1: `0ccdd009` `docs/sdlc/DECISIONS.md:7697` (exit 1) | 0 (exit 0) |
| R3 | `3d54cef8..214ec79b` (041-B: 15 commits, 4 merges, among them `aade2672`) | 1: `aade2672` `docs/sdlc/DECISIONS.md:7697` (exit 1) | 0 (exit 0) |
| R4 | `d7585e78^..d7585e78` (main's own commit: same line, path and rule) | 1 | 1, the same fingerprint |
| R5 | `ed156913^..ed156913` (main's own commit: the phrase at another path, memory file line 23) | 1 | 1, the same fingerprint |
| R6 | `88fd7360..641ff03c` (#88's own lane A range) | 0 (exit 0) | 0 |
| R7 | `88fd7360..392bd8af` (main after the PR base: docs and memory only) | 0 | not run (no table can apply) |
| R8 | Main's whole first-parent ancestry at `88fd7360`, gitleaks-full's log options, no baseline | 19: the 17 baseline fingerprints, `d7585e78…:7697` and `ed156913…:23` | 19, the identical set |

Each before/after pair differs by exactly the one intended fingerprint (R1 to R3) or not at all (R4 to R8). Whether lane A's `base.sha` is the merge base or main's tip, each range is the same commit set (§3.5).

Scratch repository (plumbing only). With main's config the real image reports 19 findings. The emulator predicted 21; the real image drops the `generic-api-key` duplicate where an AWS-key finding covers the same value. Each row says what a config removes from those 19:

| ID | Config | Removed from the 19 | Reading |
|---|---|---|---|
| S1 | Head (tables bound to the real merges) | Nothing | The tables are inert on every other commit |
| S2 | Head, TASK-044 table rebound to `X` | Exactly the two exact lines in `X:docs/sdlc/DECISIONS.md`: line 12 (mid-hunk) and line 23 (first in its hunk) | Both line-target forms (`^\n?`) are admitted. Still reported in `X`: the phrase with a digit, with an upper-case letter, with 13 characters, or with a `-`; the line re-indented, prefixed, suffixed, or with an appended AWS-shaped token (both rules); an AWS-shaped value in the phrase slot (AWS rule); the exact line at `docs/sdlc/STATUS.md`, `archive/docs/sdlc/DECISIONS.md`, `docs/sdlc/DECISIONS.md.bak` and `docs/sdlc/decisions.md`. Still reported: the exact line in `Mn`, `M` and `Y` |
| S3 | Head, TASK-044 table rebound to the merge `M` | Exactly `M:docs/sdlc/DECISIONS.md:164` (the line in the merge's first-parent diff) | `Mn`, which adds the same line on the main side (the `d7585e78` analogue), stays reported, and so does `Y` |
| S4 | S2 without `commits` (control) | The two lines in `X`, plus `Mn`, `M` and `Y` | The commit binding is what keeps other commits reported |
| S5 | S2 without `paths` (control) | The two lines, plus the four other paths | The path binding is what keeps other paths reported |
| S6 | S2 with the class widened to `[A-Za-z0-9=-]{11,13}` (control) | The two lines, plus the digit, upper-case, 13-character and `-` shapes | The `[a-z=]{12}` class is what keeps near-miss values reported |
| S7 | S2 with `targetRules` set to `aws-access-token` (control) | Nothing | `targetRules` scopes the table: a table for another rule leaves `generic-api-key` findings alone |

**Reading.** With the pinned engine, each table removes exactly its merge's one fingerprint. It spares main's own commits (R4, R5, S3), every other path (S2), every near-miss value or line shape (S2), and other rules (S7, and the AWS findings in S2). Main's whole history is unchanged (R8). The controls S4 to S7 show that the probe sees each binding when it is removed. A full 40-hex SHA fixes the content of its commit, so no later commit can ever match a table.

### 3.3 D-SEC-PR45-01, condition by condition

| # | Condition | Evidence | Met |
|---|---|---|---|
| 1 | Provenance proof, value never quoted | §3.1. The phrase is absent from `.gitleaks.toml`, the test file and the commit message at the head (0 occurrences, counted by equality); the tests build their phrases at run time | Yes |
| 2 | One `[[allowlists]]` table per commit: AND, `regexTarget = "line"`, one full 40-hex `commits`, one `targetRules`, one anchored path, `^\n?<exact line>$` with a constrained value class | `.gitleaks.toml:55-84` at the head (three tables). The class is `[a-z=]{12}`, the exact length and alphabet of the real value. The three patterns are identical | Yes |
| 3 | A fingerprint comment | `.gitleaks.toml:54`, `:65`, `:76`: `<40-hex>:docs/sdlc/DECISIONS.md:generic-api-key:7697`, one per table, placed directly above its table. The test checks them with a whole-file `toContain` (R1-n1, §3.6) | Yes |
| 4 | A sec-static pin change | `sec-static.test.ts:194` (five descriptions), `:295` (shape and literal pins), `:330` (16 negative controls, 6 admitted shapes). Mutant matrix §3.4 | Yes |
| 5 | A real-image before/after with other-commit and other-path controls | §3.2 | Yes |
| 6 | Its own PR to main with a record | PR #88 carries only the two owned files; this record | Yes |
| 7 | The affected PR removes the text before it merges | Here the text is main's own line, so it was removed on main: `1a2b9d7d` (D-ORCH-168) rewords both DECISIONS.md copies. The three branches never edit DECISIONS.md (it reaches them only through the merges). `git merge-tree --write-tree <main> <head>` for each head gives a clean DECISIONS.md with 0 copies of the phrase, and the squash diff adds 0 lines carrying it (main `f8fc27b2`). Each head itself still holds 2 copies (lines 7697 and 7741; only 7697 is flagged) | Yes |
| Class | A non-credential false positive in a commit already pushed to a PR branch | `0ccdd009` and `aade2672` are pushed (`origin/feat/TASK-040-part-b-idempotency-production`, `origin/feat/TASK-041-part-b-rate-limit-rulings-rev2`). `c33e5e92` is local only: in the class through D-SECPR040-02 (commits already bound by review records), see ruling (c) | Yes, (c) |
| Lifetime | Remove only after the affected PR is squash-merged or closed and the commit is not an ancestor of main | None of the three is an ancestor of main (`git merge-base --is-ancestor`, all three "no"). PR88-SEC-01 sets the retirement trigger | Open by design |

### 3.4 The pins (condition 4): 28 variants through the head's own tests

Harness: the head's `tools/ci/sec-static.test.ts`, type-stripped (`stripTypeScriptTypes`, transform mode) and run in-process with main's real `expect` 30. The non-gitleaks imports (`@platform/config`, `env-file`, `check-audit`, `licence-check`, `yaml-subset`) are stubbed, and the one module-level `.env.example` read is replaced by an empty string, so that file is never read. Selected tests: AT-US-048-04, PR10-SEC-08, both `[D-ORCH-068]` and both `[PR080-SEC-07]` tests (6). Each variant gets its own root with the head's `ci.yml`, `dependabot.yml` and baseline. Variants are built by exact-once string splicing, never by `String.replace`.

| Variant | Result |
|---|---|
| Control: head `.gitleaks.toml` | green, 6 of 6. Repeated 50 times (the negative controls draw random phrases): 0 failures |
| Sensitivity control: main's `.gitleaks.toml` | red (D-ORCH-068, PR080-SEC-07) |
| Widen the class: `{1,64}` in one table, `{1,64}` in all three, `[^\n]*` in all three | red, red, red (PR080-SEC-07) |
| Rebind: commit to main's `d7585e78`; commits swapped between two tables; basic-string `commits = ["…"]` in one table and in all three | red in all four |
| Widen the path: `^docs/sdlc/`; a second path `^docs/` | red, red |
| Drop `targetRules`; `condition = "OR"`; `regexTarget = "match"` | red, red, red |
| Loosen the line: a second regex `^\n?.*$`; an unescaped dot; open end (no `$`); `\n*` for `\n?` | red in all four |
| Add a sixth table bound to `d7585e78`; delete the 041-B table; delete one fingerprint comment | red, red, red |
| Global keys: a legacy `[allowlist]` table; `useDefault = false` | red, red (AT-US-048-04) |
| `[extend] disabledRules = ["generic-api-key"]` | **green** (PR45-SEC-01, pre-existing; the real image honours it and reports nothing for that rule, PR-0045 R4) |
| PR1-SEC-11 table path widened to `^\.claude/` | **green** (PR45-SEC-01, pre-existing) |
| dd7a2dd table value class widened from `effect/[A-Za-z]{1,32}` to `effect/[^"]{1,200}` (both lines) | **green** (PR45-SEC-01 and PR-0045 code review R1-m1, pre-existing) |
| A `[[rules]]` override of `generic-api-key` appended after the last table | **green** (PR25-SEC-02, pre-existing) |
| Fingerprint comments of two tables swapped | **green** (code review R1-n1; cosmetic, the tables themselves are pinned) |

**Reading.** Every change that could make one of the three new tables match anything beyond its one fingerprint turns the suite red. The five green levers are older than #88 and do not involve its tables. Review is still forced for them by the owned-path record (`.gitleaks.toml` is security-owned), and none of them can act on the PR that introduces it, because lane A reads the tested base's config.

### 3.5 Lane A, gitleaks-full and the #85 baseline after the merge

- **Which config lane A reads.** `ci.yml:507-560` ("Gate tooling and scan configuration from the tested base"): on a `pull_request` event the tested base is `TOOLS_REF = HEAD^1`, the first parent of GitHub's test merge, that is main at the event (`ci.yml:518`, PR46-SEC-17), and `.gitleaks.toml` is copied from it (`ci.yml:535`). The scan range is `RANGE_BASE..RANGE_HEAD` = `pull_request.base.sha..head.sha`, first-parent (`ci.yml:577`).
  - So a task PR passes lane A's Gitleaks once its test merge is built on a main that holds #88. That takes a new `pull_request` event (`synchronize` by a push, or `reopened`; `ci.yml:41`). A re-run of an older run reuses its old test merge and stays red.
  - Precision on D-ORCH-173 ("lane A reads `.gitleaks.toml` from the event base") and code review merge condition 3: the config comes from `HEAD^1`, the range base from `base.sha`. The consequence is the same: a fresh push after #88 lands.
  - Whichever value `base.sha` takes (main's tip or the merge base; both have been seen live, PR46-SEC-17 and the PR #59 record), the branch-only commits of each range are the same set, because none of them is in main's ancestry: 7 commits for TASK-044 and 040-B, 15 for 041-B. Each range holds its merge commit until the squash.
- **#88's own lane A.** Its tested base is main without the tables, and its range is `88fd7360..641ff03c`. With the real image and main's config the range gives 0 findings (exit 0), and also 0 with the head's config (R6): lane A's Gitleaks step is predicted green on #88.
- **gitleaks-full and its int test (#85).** `tools/quality/gitleaks-full.mjs` reads `.gitleaks.toml` and the baseline from `--ref`; `validateBaseline` checks only the line format, duplicates and the count (`BASELINE_COUNT`). An unused baseline line is not an error. The int test (`gitleaks-full.int.test.ts`, today lane B's gitleaks evidence, D-SECCHORE-01) reads HEAD's config and baseline, expects 0 findings with the full baseline and exactly the dropped fingerprint with `baseline[0]` (`63accea…`) removed. On main after #85 and #88 the three merges are outside the ancestry, so the tables are inert there and both cases are unchanged. On a branch that holds a table and #85's line for the same merge, the table suppresses the finding first and the baseline line goes unused, which is allowed. The two mechanisms never conflict.
- **Unions with the other chores.** `git merge-tree` of `641ff03c` with #85 `72249e40`, #86 `72e3dc9f` and #87 `0ccac6bf` is clean pairwise (code review D-CRCHORE-02 also checked the four-way stack). All four PRs change `tools/ci/sec-static.test.ts`; D-ORCH-173's instruction (squash-merge them as they are, no branch updates) keeps every record valid, which my record simulation confirms for #88 (§5).

### 3.6 Rulings on the code review items

- **R1-m1 / PR45-SEC-01 (LOW, carried, re-dated).** Confirmed: the `[extend] disabledRules`, PR1-SEC-11 path and dd7a2dd value-class levers are all still green at the head (§3.4). The trigger "before the next `.gitleaks.toml` change" was missed by #88. I do not hold #88 for it:
  - #88's own tables are pinned against every widening (21 red variants);
  - the open levers are pre-existing and do not touch #88's tables;
  - each lever needs a security-owned change with its own record, and lane A reads the tested base's config, so no PR can use a lever on itself;
  - #88 unblocks lane A for three task PRs; a fix cycle here would also void D-CRCHORE-02 and this record for no change in exposure.

  **New due:** in the retirement PR of PR88-SEC-01, which will be the next `.gitleaks.toml` change, and before G3 in any case. Owner devops-engineer (it was 015-C under D-ORCH-070; whichever comes first). The fix stays as PR-0045 §4 wrote it: pin the parsed config exactly (`[extend]` keys = `useDefault = true` only; per description, the full key and literal set of each table; `'''` literals only; no `[[rules]]` table).
- **R1-m2 = PR88-SEC-01 (INFO, new).** Concur. Details in §4.
- **R1-n1 (NIT).** Concur: swapping two fingerprint comments stays green (§3.4). Bind each `# Fingerprint:` line to the table that follows it (for example, the comment block directly above `[[allowlists]]` must name that table's commit). Fold into the PR45-SEC-01 fix.
- **R1-n2 (NIT) and ruling (c).** Concur with the reading. `c33e5e92` is in TASK-044's head `33262314` (its direct parent), and my round-3 record on main (`docs/05-quality/security/PR-pending-TASK-044-security-review.md`, Head row `33262314`, D-SECPR044-03) binds that head, so D-SECPR040-02's extension (commits that review records already bound) applies. The header comment of `.gitleaks.toml` still says "already pushed"; reword it in the retirement PR.

### 3.7 Other observations

- **Main after the PR base.** Main moved past `88fd7360` during this review (docs and memory only; pushed up to `392bd8af`). The real image over `88fd7360..392bd8af` with main's config gives 0 findings (R7). So the new records that mention the phrase in prose (for example D-CRCHORE-01's) are not flagged, and main's next push range is clean as of `392bd8af`.
- **The phrase in prose on main.** It is still quoted in several docs and memory files on main (PR85-SEC-02 counts 6), in contexts the rule does not flag. My two memory files that quoted it are reworded in the working tree and land with the next memory commit. Not a new finding (PR85-SEC-02).
- **TASK-044 merge `c33e5e92`** is not on any remote branch. Until TASK-044 pushes, its table binds a commit only this host has, which is harmless (a commit SHA fixes the content).

## 4. Findings

### PR88-SEC-01 (INFO): commit-bound tables and branch-only baseline lines have no retirement owner or trigger (= code review R1-m2)

- **Where:** `.gitleaks.toml:36-43` (the dd7a2dd table) and `:55-84` (the three new tables); `tools/quality/gitleaks-baseline.txt` after #85 (the three branch-only lines, PR85-SEC-01).
- **CWE / OWASP:** CWE-1164 (Irrelevant Code: dead configuration); A05:2021 Security Misconfiguration.
- **Description.** D-SEC-PR45-01 says to remove a commit-bound table once its PR is squash-merged or closed and the commit is not an ancestor of main. Nobody owns that step:
  - the dd7a2dd table is already dead: PR #39 was squash-merged on 2026-11-15 (`3f589352`), and `dd7a2dd` is not an ancestor of main;
  - the three new tables die when TASK-044, 040-B and 041-B are squash-merged or closed; the `c33e5e92` table dies at once if TASK-044 redoes its merge instead of pushing it;
  - #85's three branch-only baseline lines die with them (PR85-SEC-01).
- **Exploitability / impact.** None today. A commit SHA fixes the content of its commit, so a dead table can only ever match lines inside that commit, which nothing scans once the branch is gone. The cost is audit noise: every extra table is one more thing a reviewer must re-derive, and the allow-list grows with each such incident.
- **Remediation (code level).** One shrink-only PR by devops-engineer after the three task PRs are squash-merged or closed:
  1. delete the dd7a2dd table and the three PR080-SEC-07 tables from `.gitleaks.toml`, and reword the header ("already pushed" now covers record-bound commits, R1-n2);
  2. delete the three branch-only lines from `tools/quality/gitleaks-baseline.txt` and set `BASELINE_COUNT` to 19;
  3. update the sec-static pins (descriptions, the PR25-SEC-01 count and commit list) and fold in PR45-SEC-01 and R1-n1 (this is the next `.gitleaks.toml` change);
  4. its own security record.
- **Verification.** Real image over main's first-parent ancestry with the shrunk config and baseline: the same 0 findings as before the shrink; sec-static green; a mutant that re-adds one of the tables is red.
- **Owner / due:** devops-engineer; trigger above; before G3 at the latest.

### Carried: PR45-SEC-01 (LOW), re-dated

Unchanged in substance (PR-0045 §4): `[extend] disabledRules`, a widened PR1-SEC-11 path and a widened dd7a2dd value class still pass sec-static (§3.4; the real image honours `disabledRules`). CWE-693, A05:2021. **New due:** inside the PR88-SEC-01 shrink PR (the next `.gitleaks.toml` change), and before G3 in any case. Owner devops-engineer (015-C under D-ORCH-070, if that lands first).

## 5. Record binding (simulated)

Main's `check-security-owned-paths.mjs` (from main, as lane A runs it from the tested base) in a scratch `clone --shared` with a sparse checkout of `/.github/`, `/docs/05-quality/security/` and `/tools/ci/`. Each scenario commits this record on top of main, builds GitHub's test merge with `merge-tree` + `commit-tree`, checks it out and runs the checker with `--base <event base> --head <PR head> --pr 88`.

| ID | Scenario | Expected | Result |
|---|---|---|---|
| S1 | Main + this record, test merge with the head, event base `88fd7360` (PR base) | pass | pass, 2 owned paths |
| S2 | Same, event base = main's tip | pass | pass, 2 owned paths |
| S3 | Main + this record + simulated squashes of #85, #86 and #87 (D-ORCH-173 order), base = the new tip | pass | pass, 2 owned paths |
| S4 | Same as S3, base `88fd7360` | pass | pass |
| N1 | No record (main only) | fail | fail: no `PR-0088-*.md` |
| N2 | The record with a final `FAIL` verdict row | fail | fail: verdict FAIL |
| N3 | The Head row names a main commit (`88fd7360`) | fail | fail: names no commit of this PR |
| N4 | An owned change (`.gitleaks.toml`) committed after the head | fail | fail: changed after `641ff03` |
| N5 | #88 updated by a merge of a main that holds #85 | fail | fail: 6 owned paths changed after `641ff03` (C3) |
| N6 | Only another PR's record (the same text as `PR-0087-…`) | fail | fail: no `PR-0088-*.md` |

This record has exactly one table row whose first cell starts with `Head` and one `Verdict` row, the last one. A faithful Gitleaks v8.30.1 emulation over this record and its DECISIONS entry, committed into a throwaway repository, gives 0 findings.

## 6. Conditions and follow-ups

| ID | What | Owner | Due / status |
|---|---|---|---|
| C1 | Code review merge condition 1 and D-SEC-PR45-01 condition 5: the real-image before/after on the three merge ranges, with other-commit, other-path and other-rule controls | security-analyst | **Met in this record (§3.2)** |
| C2 | Hosted lane A on #88 when billing returns, or the D-ORCH-162 user-merge path. Predicted: Gitleaks green with main's config (real image R6: 0 findings on `88fd7360..641ff03c` with main's config), this record found on the test merge | orchestrator | Before #88 merges (or as D-ORCH-162 allows) |
| C3 | Squash-merge #88 as it is, without updating its branch (D-ORCH-173). An update by a merge of a main that already holds #85, #86 or #87 changes `tools/ci/sec-static.test.ts` after this head and voids this record (sim N5): a merge-only round is then owed | orchestrator / user | At merge |
| C4 | After #88 is on main, each task PR (TASK-044, 040-B, 041-B) needs a fresh `pull_request` event before its lane A counts (§3.5). TASK-044 pushes a head that contains `c33e5e92` (`33262314` or a descendant); if it redoes the merge instead, its table goes on the PR88-SEC-01 list at once | orchestrator, task owners | Before each task PR's lane A is counted |
| F1 | PR88-SEC-01 shrink PR, folding PR45-SEC-01 (re-dated), R1-n1 and PR85-SEC-01 | devops-engineer | After the three task PRs merge or close; before G3 |

Any further change to `.gitleaks.toml` or `tools/ci/sec-static.test.ts` on this branch needs a delta round.

## 7. Verdict

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium. New: 1 INFO (PR88-SEC-01). Carried: PR45-SEC-01 (LOW), re-dated |
| D-SEC-PR45-01 | Conditions 1 to 7 met (§3.3); `c33e5e92` in the class through D-SECPR040-02 |
| Code review items | R1-m1: PR45-SEC-01 re-dated. R1-m2: PR88-SEC-01. R1-n1: concurred, folded into the PR45-SEC-01 fix. R1-n2: concurred, ruling (c) |
| Verdict | **PASS_WITH_CONDITIONS.** The flagged value is a non-secret doc-comment phrase. Each table binds one full merge SHA, one path, one rule and one exact line, and with the pinned image it removes exactly its merge's one fingerprint and nothing else: main's ancestry, main's own commits, other paths, other rules and near-miss lines stay reported. The pins catch every widening of the new tables. Open: C2 (hosted lane A or the D-ORCH-162 path), C3 (merge unchanged), C4 (a fresh push per task PR after the merge); follow-up F1 (PR88-SEC-01, with PR45-SEC-01 re-dated). |
