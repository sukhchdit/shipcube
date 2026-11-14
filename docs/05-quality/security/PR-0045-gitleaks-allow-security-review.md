# PR-0045 / D-ORCH-068: change-scoped security review (commit-bound Gitleaks allow-list for two `dd7a2dd` false positives)

| Field | Value |
|---|---|
| PR | #45 `ci(security): allow-list the two dd7a2dd gitleaks false positives by commit, path, rule and line`, https://github.com/sukhchdit/shipcube/pull/45 (D-ORCH-068) |
| Branch | `ci/gitleaks-allow-pr39-dd7a2dd`: 3 commits on the merge base `7d19dbb` (`77dbf70` entry and tests, `69af354` `^\n?` anchor fix, `66ae5c1` lane B evidence only); 7 files, +8,951 / -1, of which the 3 owned files are +140 / -1 and the rest is the evidence run |
| Head | 66ae5c14ea137d4a341d8db08db1c556e91c57c6 |
| Main when written | `d50d8d9`. Since the merge base, main changed only `docs/sdlc/*`, two code-review records (`PR-0044`, `PR-0045`) and `.claude/agent-memory/**`. None of these is one of the PR's three owned paths, so a later merge of main keeps this record valid (§5, case J) |
| Security-owned paths changed (CODEOWNERS, as lane A computes them) | `.gitleaks.toml`, `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt` (3). The evidence directory is not owned |
| Dependencies / workflows | `package.json`, `package-lock.json`, `.npmrc` and `.github/**` are untouched (`git diff 7d19dbb 66ae5c1` over them is empty). The evidence run's lockfile hash equals main's |
| Binding items checked | D-ORCH-068, D-SEC-PR25-01, D-SEC-PR28-01 (02), D-TASK015-02 (PR-0033 code review), D-SEC-PR23-02, PR10-SEC-01 (`.git`-only mount, `--ignore-gitleaks-allow`), PR10-SEC-03 (config from the base ref), PR10-SEC-08, PR25-SEC-01, PR25-SEC-02, CLAUDE.md §5 (no history rewrite) |
| Code-review twin | `docs/05-quality/reviews/PR-0045-gitleaks-allow-code-review.md` on main (`d50d8d9`): APPROVED_WITH_NITS (R1-m1..m3, R1-n1..n4, security flags SF-1..3). I cite it rather than duplicate it (§3.3, §3.4, §3.6) |
| Reviewer / date | security-analyst, 2026-11-14. Read-only. In the `Shipqube-GLALLOW` worktree I ran only `git log --oneline -5` and `git status --short`, and wrote this file. I did not touch the PR #39 worktree: I read `dd7a2dd`, `756d505` and `7dd3c64` from the shared object store in the main checkout (`git show`), where I also ran `git fetch` twice. `gh pr view`, `gh pr checks` and `gh run view` were read-only. The probes ran on a `git archive` extract of the head (its `node_modules` junctioned to the main checkout), a scratch probe repository and a scratch `clone --shared`. Docker: the pinned Gitleaks image (`v8.30.1@sha256:c00b6bd0…`, the `GITLEAKS_IMAGE` digest of `ci.yml`), run with `--pull=never --network none` and `.git` mounted read-only. Every run happened under the shared `docker.lock` directory (owner `sec-pr45`, three short windows, released each time). I made one registry download (the `effect` 3.20.0 tarball) into its own scratch directory. The scratch files are removed at the end |

## 1. Summary

**The change is correct and exact, and it weakens no gate.** It also does nothing the PR does not say.

- **The two matches are not secrets (FOCUS a).**
  - Both flagged values are byte-for-byte equal to the `IntervalSymbolKey` and `IntervalsSymbolKey` constants of `effect` 3.20.0 (MIT). That is the `@prisma/config` dependency pinned in the lockfile.
  - I downloaded the registry tarball. Its sha512 equals the lockfile `integrity`, and in all six copies (`dist/cjs`, `dist/esm` and `src`, for both `interval` and `intervals`) the constant equals the flagged value. In the `dist` copies the value feeds `Symbol.for(...)`.
  - So each value is a public module-namespace identifier of the form `effect/<letters>`, with 16 and 17 letters. Nothing needs rotating.
  - The values appear nowhere in this PR's diff, commit messages or body (0 occurrences, counted without printing).
- **The entry is exact (FOCUS b).**
  - With the real image, the entry removes exactly the two `dd7a2dd` fingerprints and nothing else.
  - In a scratch repository, the same two lines with the real values, in other commits, stay reported (12 of 12). So no future commit can be covered by this entry.
  - I also removed the commit binding to test the line patterns alone in the engine. The exact lines are then admitted, and all six near-miss shapes stay reported (§3.2).
- **D-GLALLOW-03 is confirmed.** The first commit's bare `^<line>$` form still reports both fingerprints. A bare pattern matches only when the line is the first added line of its hunk (P5). This confirms code review R1-n1's wording point.
- **D-GLALLOW-01 is accepted** as a narrow second class. D-SEC-PR25-01 is clarified, not reversed (D-SEC-PR45-01, §3.4).
- **The shape pin (D-GLALLOW-05) catches most changes.** Every new `[[allowlists]]` table, and every change to this entry's commit, rule, path, condition, description or fingerprint comment, turns the suite red (12 of 12 mutants). Three levers stay green:
  - `[extend] disabledRules` (with it, the real image reports 0 on `dd7a2dd`);
  - widening the older PR1-SEC-11 table's paths;
  - widening this entry's value class (= R1-m1).

  These are PR45-SEC-01 (LOW; partly pre-existing).
- **Lane A is unchanged.** `ci.yml` is untouched, and the PR25-SEC-01 pin is untouched and green. Lane A on the head ran Gitleaks green with the base config. It never loads the baseline or an ignore path.
- **The evidence is clean.** The D-SEC-PR23-02 statements are present verbatim. The hashes, ancestry and lockfile all match. The host-path scan is 0, and the same scan finds the known fragment in an older run (§3.8).

**Rulings on the five questions:**

| | Question | Ruling |
|---|---|---|
| (a) | Are the two flagged lines secrets? | **No.** Provenance proof against the registry tarball (§3.1) |
| (b) | Is the allow-list exact? Could another secret on a line of the same shape slip through in a future commit? | **Exact. No.** The commit binding alone keeps every other commit reported (P3, P4). Within `dd7a2dd` only the two findings exist (R1), so the entry can never suppress anything else (§3.2) |
| (c) | D-GLALLOW-01 against D-SEC-PR25-01 | **Accepted as a narrow second class.** D-SEC-PR25-01 is clarified, not amended away. Proposed text: D-SEC-PR45-01 (§3.4) |
| (d) | Do the shape-pin tests force every future allow-list through a test change and review? | **Every new table and every change to this entry's binding: yes. Not every config lever:** PR45-SEC-01 (§3.6). Review is still forced by the owned-path record and the base-ref config |
| (e) | Does lane A still never load the baseline or an ignore path? Is the evidence clean? | **Yes, and yes** (§3.7, §3.8) |

Findings: **1 LOW (PR45-SEC-01) and 1 INFO (PR45-SEC-02).** No Critical, High or Medium.

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-1** Provenance | I extracted the `dd7a2dd` blob of `tools/docker/scan-image-secrets.mjs` into scratch and took the quoted value from lines 272 and 273. I compared it, without printing it, with every `*SymbolKey = "…"` assignment in the six `effect` files: first in the installed tree, then in the registry tarball `effect-3.20.0.tgz` (sha512 checked against the lockfile `integrity`). Then I counted occurrences of both values in this PR's diff, commit messages and body | §3.1 |
| **P-2** Real Gitleaks image, git mode | Lane A's flags (`git /repo --config … --log-opts="--diff-merges=first-parent <range>" --ignore-gitleaks-allow --redact`, `.git` only, read-only, `--network none`, `--pull=never`), plus a JSON report written to a scratch `out` directory. Only rule id, short commit, path and line were read back. There were 9 scans of the real repository and 5 of a scratch probe repository. The configs were main, head, `77dbf70` (the bare form), and four scratch variants: the head entry with its path moved to the probe file (commit kept or removed), the `77dbf70` entry the same way, and main with `[extend] disabledRules` | §3.2, §3.3 |
| **P-3** The suite itself | I ran `tools/ci/sec-static.test.ts` from a `git archive` of the head through Jest (`unit` project, `--runInBand`): 18 of 18 pass. Then a 17-mutant matrix on `.gitleaks.toml`, restored byte-identical after each run (checked with `cmp`) | §3.6 |
| **P-4** Lane A | `git diff` of `.github/**` between the base and the head (empty); the Gitleaks step text on main; run 43567874884 on `66ae5c1` (`gh run view --json jobs`) | §3.7 |
| **P-5** Evidence | `summary.json` against the committed files (sha256 of the JUnit and coverage attachment, the lockfile and the manifest at `69af354`), ancestry, the files changed after `69af354`, the test names in the JUnit, and a count-only host-fragment scan with a positive control | §3.8 |
| **P-6** Record check | Main's `tools/ci/check-security-owned-paths.mjs` against a scratch `clone --shared` at the head, with 10 scenarios (6 negative controls) | §5 |
| Source review | The whole owned diff (`.gitleaks.toml` +22, `sec-static.test.ts` +115, baseline header +3/-1), the surrounding tests (AT-US-048-04, PR10-SEC-08, PR25-SEC-01, PR25-SEC-02), the lane A Gitleaks step, D-ORCH-068 and the code review twin | — |

## 3. Rulings

### 3.1 The two matches are not secrets

| Check | Result |
|---|---|
| The flagged lines at `dd7a2dd` | Lines 272 and 273 are inside a `//` comment of `IMAGE_SCAN_ALLOW_LIST`. The comment explains seven `packageFile('generic-api-key', …)` entries for the tooling image. Line lengths are 104 and 87 bytes, there is no CR, and each line has one quoted value: `effect/` followed by 16 and 17 ASCII letters. Both values fit the entry's class `effect/[A-Za-z]{1,32}` |
| Registry tarball | `effect-3.20.0.tgz`: sha512 equals `package-lock.json` `node_modules/effect` `integrity`. The package is `effect` 3.20.0, MIT. `node_modules/@prisma/config` declares `effect: 3.20.0` |
| Value equality | `IntervalSymbolKey` equals the line-272 value and `IntervalsSymbolKey` equals the line-273 value, in all six copies in the tarball and in the installed tree. In `dist/cjs` and `dist/esm` the next statement is `Symbol.for(<SymbolKey>)` |
| Exposure | 0 occurrences of either value in `git diff 7d19dbb 66ae5c1`, in the three commit messages and in the PR body. The `.gitleaks.toml` patterns hold only the class `effect/[A-Za-z]{1,32}`. The test builds its `effect/…` values at run time |
| Ruling | **Not credentials.** These are public, library-defined `Symbol.for` registry keys, so nothing needs rotating, and the false-positive class in D-SEC-PR45-01 applies |

### 3.2 The entry is exact (real image)

Real repository (main checkout `.git`, read-only):

| ID | Range (`--diff-merges=first-parent`) | Config | Findings |
|---|---|---|---|
| R1 | `dd7a2dd^..dd7a2dd` | main (no entry) | 2: `generic-api-key` at `tools/docker/scan-image-secrets.mjs:272` and `:273`. These are the PR's two fingerprints, and the commit holds no other finding |
| R2 | same | head | **0** |
| R3 | same | `77dbf70` (bare `^<line>$`) | 2 (the same two). See §3.3 |
| R4 | same | main plus `disabledRules = ["generic-api-key"]` under `[extend]` | 0. The PR45-SEC-01 lever is live in the engine |
| R5 | PR #39 local range `c998fae..756d505` | main | 2. These are only the two `dd7a2dd` fingerprints; nothing else in PR #39's range |
| R6 | same | head | **0** |
| R7 | PR #39 pushed range `c998fae..7dd3c64` | head | **0** |
| R8 | this PR `7d19dbb..66ae5c1` | main (what lane A reads for this PR) | 0 (the same result as the lane A run, §3.7) |
| R9 | same | head | 0 |

`c998fae` was main's tip when the scans ran. Main has moved since then, but only through docs and memory files.

Scratch probe repository: one 70-line filler file `probe/scan.mjs` and three commits on top of it.
- `c2` adds a filler line followed by the two real lines (lines 7 and 8, mid-hunk).
- `c3` adds the line-272 text as the only line of its hunk (line 1).
- `c4` adds eight one-variant hunks. Each hunk is a filler line followed by the variant, and unchanged lines separate the hunks.

The values were copied from the blob or generated at run time, and none was printed. In the table, "head, path moved" is the head entry with only `paths` changed to `^probe/scan\.mjs$`.

| Line(s) | Content | P1 main | P4 head | P3 head, path moved | P2 head, path moved, `commits` removed | P5 `77dbf70` form, path moved, `commits` removed |
|---|---|---|---|---|---|---|
| c2:7, c2:8 | the two flagged lines, real values, mid-hunk | reported | reported | reported | **admitted** | reported |
| c3:1 | line 272, real value, first line of its hunk | reported | reported | reported | **admitted** | **admitted** |
| c4:56, c4:60 | lines 272 and 273, real values, mid-hunk | reported | reported | reported | **admitted** | reported |
| c4:32 | line 272 with `effect/` plus mixed letters and digits | reported | reported | reported | reported | reported |
| c4:36 | line 272 with a generic 24-character secret as the value | reported | reported | reported | reported | reported |
| c4:40 | the exact line plus an appended `apiKey = "<generic>"` | reported (2) | reported (2) | reported (2) | reported (2) | reported (2) |
| c4:44 | the exact line, re-indented | reported | reported | reported | reported | reported |
| c4:48 | line 273 with `effect/` plus 33 letters | reported | reported | reported | reported | reported |
| c4:52 | the exact line plus a trailing space | reported | reported | reported | reported | reported |
| **Total** | | 12 | 12 | 12 | 7 | 11 |

**Reading.**
- **P3 and P4: commit binding alone.** With the commit binding in place, nothing outside `dd7a2dd` is ever admitted, even the exact lines with the real values. So a future commit cannot use this entry, whatever its line looks like.
- **P2: the line patterns alone.** They admit exactly the two lines and refuse every near miss, including a value outside `[A-Za-z]{1,32}` and anything appended.
- **Within `dd7a2dd`.** R1 shows the commit has exactly these two findings at that path, so even a widened regex in this entry could not suppress anything more today. That is why R1-m1 (value class not pinned) and PR45-SEC-01 (G3) carry no live exposure.
- **Commit binding is effective.** Commit matching is full-SHA equality: the PR's own control with the parent SHA, and the abbreviated-SHA unit control, both stay reported. A second commit with the same SHA would need a SHA-1 second preimage, which is not practical.

### 3.3 D-GLALLOW-03 (`^\n?`) and the wording point (R1-n1)

In git mode, Gitleaks builds a fragment from the added lines of each hunk. The `Line` that it hands to a `regexTarget = "line"` allow-list runs from the previous newline character up to the next one. So the line carries a leading `\n` for every line except the first one of a hunk.

The probes confirm this exactly:
- R3 and P5: the bare form fails on every mid-hunk line and matches only the first-in-hunk line (c3:1).
- P2: `^\n?` matches both forms.
- sec-static: a second newline, or any text before the comment, stays refused.

RE2's `$` without `(?m)` means end of text, the same as JavaScript's, so the test model and the engine agree on these sources.

Two edge cases fail closed:
- If the blob had CRLF line endings, the line would end in `\r` and fail to match.
- If a future image bump changes the line target, the entry stops matching, and lane A turns red on PR #39's range only.

The header comment (`.gitleaks.toml:16-17`) and the JSDoc (`sec-static.test.ts:177-179`) say the bare form "never matches". That is too strong: P5 shows it matches the first line of a hunk. I agree with R1-n1's rewording. It is not a separate finding, because the guard requires `^\n?` anyway.

### 3.4 Ruling on D-GLALLOW-01 (proposed D-SEC-PR45-01)

**Why D-SEC-PR25-01's "never" does not forbid this entry.**

1. **What the rule protects against.** D-SEC-PR25-01 says "never a `.gitleaks.toml` path/commit allowlist" for the 17 historic hits. The weakness behind it is PR10-SEC-08: an allow-list bound to a path and a line pattern hid three real secret shapes. It was bound to a mutable file, not to fixed content. An entry bound by path only or commit only suppresses content that nobody has reviewed yet.
2. **This entry binds a fixed, reviewed set.** A commit is immutable. R1 shows `dd7a2dd` holds exactly two `generic-api-key` findings at that path, and P3 and P4 show the entry can suppress nothing in any other commit.
   - It is as exact as a `.gitleaksignore` fingerprint: both bind the same commit, path and rule. The fingerprint binds the line number; the entry binds the line content, anchored.
   - Both cover the same two findings.
3. **The baseline cannot serve lane A, and making it do so would cost more.**
   - Lane A mounts only `.git` (PR10-SEC-01), because Gitleaks auto-loads `<source>/.gitleaksignore`. sec-static pins that lane A never mounts or references the baseline or an ignore path (PR25-SEC-01, D-SEC-PR28-01 (02), D-TASK015-02).
   - Opening an ignore-file input in lane A to handle one incident would re-open a pinned surface.
   - The `.gitleaks.toml` route keeps the PR10-SEC-03 property: lane A reads the config from the base ref. The entry must therefore reach main through its own reviewed PR, and a PR can never allow-list its own commit.
4. **History hits stay baseline-only.** The 17 fingerprints and any future main-history hit found by `gitleaks-full` stay in the baseline. D-GLALLOW-04 (baseline untouched, the 17-line pin unchanged) is correct.
   - If PR #39 ever landed as a merge commit, `dd7a2dd` would enter main's ancestry, and this entry would cover it in `gitleaks-full` too, because full-history scans read the same `.gitleaks.toml`. So no baseline line is needed in either landing.

**Proposed decision text (for the orchestrator to log; I do not edit DECISIONS.md):**

> **D-SEC-PR45-01 · 2026-11-14 · security-analyst · PR #45 r1 PASS_WITH_FOLLOW-UPS; commit-bound false-positive class (clarifies D-SEC-PR25-01)**
>
> - **Decision:** PR #45 security r1 at `66ae5c1` = PASS_WITH_FOLLOW-UPS (0 Critical/High/Medium; 1 LOW, 1 INFO).
>   - The two `dd7a2dd` findings are not secrets. They are byte-equal to `effect` 3.20.0's `IntervalSymbolKey`/`IntervalsSymbolKey` `Symbol.for` keys in the registry tarball, whose sha512 equals the lockfile integrity.
>   - **D-GLALLOW-01 is accepted. D-SEC-PR25-01 is clarified, not reversed.** Its "never a `.gitleaks.toml` path/commit allowlist" governs history hits on main, which stay in the exact-fingerprint baseline. It forbids any entry bound only by path and/or commit, or by path plus a line pattern.
> - **One second class is allowed: a non-credential false positive in a commit already pushed to a PR branch.** All of these must hold:
>   1. Provenance proves it is not a credential, and the value is never quoted.
>   2. The entry is exactly one `[[allowlists]]` table with `condition = "AND"` and `regexTarget = "line"`, holding:
>      - exactly one full 40-hex `commits` SHA;
>      - exactly one `targetRules` rule;
>      - one anchored `paths` regex;
>      - anchored full-line `regexes` of the form `^\n?<exact line>$`, with any variable part limited to the provenance's character class.
>   3. The `commit:path:rule:line` fingerprints sit in a comment next to the entry.
>   4. sec-static's description pin and commit-bound guard change in the same PR.
>   5. A real-image reproduction shows before and after on the commit range, plus other-commit and other-path controls.
>   6. The entry lands on main through its own PR with a security record, never inside the affected PR.
>   7. The affected PR removes the text from its tree before it merges.
> - **Excluded:** a real credential is never in this class. It is an incident: rotate first, then a separate ruling.
> - **Lifetime:** keep the entry. It is harmless once inert. It may be removed only after the affected PR is squash-merged or closed and `git merge-base --is-ancestor <commit> origin/main` is false, through an owned change with a record. It is never removed if the commit is in main's ancestry.
> - **Findings:**
>   - **PR45-SEC-01 (LOW):** pin the whole parsed config in sec-static: `[extend]` exactly `useDefault = true`, every table's literal sets exactly, `'''` literals only. Fold in R1-m1, R1-m2 and R1-n2. Owner TASK-015 or a PR #45 fix cycle. Due before the next `.gitleaks.toml` change, and before G3.
>   - **PR45-SEC-02 (INFO):** PR #39's final head carries `756d505` (0 quoted `effect/` strings at that path) and gets a new `pull_request` event after #45 merges. Its security delta round re-scans `main..<head>` with the merged config. No squash requirement from security.
> - **Reversibility:** High.

### 3.5 D-GLALLOW-02 and D-GLALLOW-04

- **D-GLALLOW-02 (binding by content): accepted.** Gitleaks allow-lists cannot bind a line number, and the commit binding makes content binding exact in effect (§3.2).
  - The fingerprint comment is pinned (`sec-static.test.ts`, the `toContain` of the `…:272 and :273` text). Mutant K10 confirms it.
- **D-GLALLOW-04: accepted.** The baseline header now names the new class and still forbids `.gitleaks.toml` entries for history hits. The 17 lines and their pin are untouched.

### 3.6 Shape pin (D-GLALLOW-05): mutation matrix

Each mutant was applied to `.gitleaks.toml` in the extract, the whole sec-static file was run (18 tests), and then the file was restored. I built the mutants by slicing the text, not with `String.replace`. A replacement string containing `$'''` expands `$'`; the code reviewer recorded the same pitfall, and my first probe-config build hit it too.

| Mutant | Expected | Result |
|---|---|---|
| K1 `commits` removed | red | red (2 tests) |
| K2 `targetRules` removed | red | red (2) |
| K3 path widened to `^tools/docker/` | red | red (2) |
| K4 first line pattern without `^\n?` | red | red (2) |
| K5 a third `[[allowlists]]` table (copy of the entry, new description) | red | red (1: description pin) |
| K6 abbreviated SHA | red | red (2) |
| K7 first line pattern replaced by `^\n?[^\n]*$` | red | red (3: negative controls) |
| K8 `condition = "OR"` on the entry | red | red (2) |
| K9 entry description changed | red | red (1) |
| K10 fingerprint comment removed | red | red (1) |
| K11 new table with a spaced `[[ allowlists ]]` header | red | red (1: PR25-SEC-02 table check) |
| K12 `[[rules]]` override with a rule allow-list | red | red (1: PR25-SEC-02) |
| **G1** `disabledRules = ["generic-api-key"]` under `[extend]` | red | **green (18 of 18)**. In the real image this gives 0 findings on `dd7a2dd` (R4) |
| **G2** PR1-SEC-11 `paths` widened to `^\.claude/` and `^[^/]*\.md$` | red | **green** |
| **G3** entry value class widened to `effect/[A-Za-z0-9+/=]{1,200}` (= R1-m1) | red | **green** (inert while the commit binding holds, §3.2) |
| G4 PR1-SEC-11 regex made `(?i)argon2id` | red | red. JavaScript `RegExp` rejects RE2's `(?i)`, so the test model fails closed on RE2-only syntax |
| G5 entry value class removed (`"[^"]*"`) | red | red (negative controls) |
| Control: unmutated file | green | green (18 of 18) |

**Reading.** The pin does what D-GLALLOW-05 needs for new tables and for this entry's binding. The tests do not cover `[extend]` keys or the literal sets of existing tables.

One more gap, found by reading:
- `literals()` (`sec-static.test.ts:32-35`) reads only `'''…'''` literals.
- So a `commits = ["…"]` array written with basic strings is invisible to it, and `commitBoundViolations` is skipped for that table (`:201`).
- A new table still trips the description pin, so a reviewer sees it, but the guard checks nothing.

This is PR45-SEC-01. I agree with R1-m2 (the oracle wrongly requires `paths` and `regexes`) and R1-n2 (select the entry by description, not by index). The fix below folds both in.

### 3.7 Lane A

- `.github/**` is byte-identical between the base and the head.
- The Gitleaks step mounts `.git` read-only and the base-ref `.gitleaks.toml` read-only, with `--ignore-gitleaks-allow` and no ignore-path flag.
- The `[PR25-SEC-01] lane A gitleaks neither mounts nor references the baseline…` test is unchanged and passes (18 of 18 on the extract; the evidence JUnit lists all 18 sec-static cases with no failure).
- Lane A run 43567874884 on `66ae5c14…`:
  - `fast-lane` succeeded.
  - In `scans`, the base-ref config step, **Gitleaks (PR commit range)** (main's config, the same result as R8), Semgrep and oasdiff all succeeded.
  - Only "Security-owned paths need a review record" failed, and `ci-gate` failed with it. That is expected until this record is committed.

### 3.8 Evidence hygiene (`docs/05-quality/tests/runs/20261114T0634Z_69af354/`)

| Check | Result |
|---|---|
| D-SEC-PR23-02 statements | The PR body's gate table states verbatim that `npm ci --ignore-scripts` + `npm run deps:rebuild` ran first (both exit 0), then `npm run quality:heavy -- --profile pr --base origin/main`, and that `.git/info/exclude` is empty (0 bytes). The profile is `pr`, so no wave or gate run is committed. This is not a lockfile PR (lockfile hash = main's), so the `ajv` statement is not owed |
| Run identity | `summary.json`: `git_sha` `69af35457400bc9c9a0bf4849844a02d49db86cc`, `git_dirty` false, `build_clean` true, verdict PASS, 0 `invalid_reasons`, 0 `env_overrides`. `unit`: 4458 tests, 0 failures, 0 errors, 2 skipped |
| Hashes | The sha256 of `unit.junit.xml` and of `coverage-summary.json` match `summary.json`. `lockfile_sha256` equals `package-lock.json` at `69af354` and at main. `manifest_sha256` equals `tools/quality/required-suites.json` at `69af354` |
| Ancestry | `69af354` is an ancestor of the head, and `69af354..66ae5c1` changes only the four run files, so the evidence covers the final code |
| New tests ran | The JUnit holds both `[D-ORCH-068]` cases and all 18 sec-static cases, none with a failure |
| Host-path scan (count only) | 0 for every needle over the four files. The needles were the OS user name, its 8.3 stem, the home and temp directories in both slash forms, the host name, the checkout path, and the Windows users-directory prefix in backslash, forward-slash and Git Bash forms. **Positive control:** the withdrawn PR #28 run (`dbfe4df`, D-ORCH-035) gives 3 hits (8.3 stem, temp dir, users dir), so the scanner sees this class of fragment. The PR's own result is also 0 |

### 3.9 What PR #39 still owes (PR45-SEC-02, for its security delta round)

1. The final head contains `756d505` or an equivalent edit: 0 quoted `effect/` strings in `tools/docker/scan-image-secrets.mjs`. Today the pushed tip `7dd3c64` still holds 2, and `756d505` holds 0 (R5, R6).
2. There is a new `pull_request` event after #45 merges. Re-running an old PR #39 run reuses its payload's base SHA, and with it the old config.
3. The delta record re-scans `origin/main..<final head>` with the merged config (expected 0) and states the planned landing.
   - Security does not require a squash (SF-2): in a merge-commit landing, the entry also covers `dd7a2dd` in `gitleaks-full` (§3.4 item 4).
   - The retirement rule in D-SEC-PR45-01 answers R1-m3.

## 4. Findings

### PR45-SEC-01 · LOW · sec-static's Gitleaks pins leave three config levers outside the review tripwire

- **CWE / OWASP:** CWE-693 (Protection Mechanism Failure); A05:2021 Security Misconfiguration.
- **Location:**
  - `tools/ci/sec-static.test.ts:122`: AT-US-048-04 checks only that `useDefault = true` follows `[extend]`.
  - `:30-35`: `allowlists` and `literals()` read only `'''…'''` literals.
  - `:194-221`: the D-ORCH-068 pin covers the descriptions plus this entry's commit, rule and path. It pins the regex sources only by count (`:207`).
  - `.gitleaks.toml:21-30`.
- **Description:** D-GLALLOW-05 says that any new or widened allow-list changes a test. The matrix in §3.6 turns red for every new table and every change to this entry's binding. Three edits stay green:
  - **G1:** `disabledRules = ["generic-api-key"]` under `[extend]`. With it the real image reports 0 on `dd7a2dd` (R4): the rule behind most hits is off for lane A and `gitleaks-full`.
  - **G2:** the PR1-SEC-11 table widened to every `.claude/` file and every root `*.md`.
  - **G3:** this entry's value class widened (= R1-m1; inert today).

  Separately, a `commits` array written with basic strings skips the commit-bound guard. G1 and G2 predate this PR (they are the PR25-SEC-02 family). G3 is new.
- **Exploitability and impact:** Each lever needs an edit of `.gitleaks.toml`. That file is CODEOWNED, needs a security record (lane A record step), and is read from the base ref, so a PR cannot use the edit on its own range. A reviewer would have to miss it.
  - If it were missed, G1 would silence the generic rule everywhere: impact medium to high, likelihood low.
  - The primary controls are intact, so this is LOW as defence in depth. That is consistent with PR25-SEC-02, which is the same family.
- **Remediation (code level, `tools/ci/sec-static.test.ts`):** replace the description-only pin with an exact pin of the parsed configuration, and add G1, G2 and G3 as in-test mutations:

  ```ts
  // [extend] holds exactly `useDefault = true` (no disabledRules, path or url).
  const extendTable = gitleaks.split(/^(?=\[)/mu).find((t) => t.startsWith('[extend]')) ?? '';
  const extendKeys = extendTable.split(/\r?\n/u).slice(1).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  expect(extendKeys).toEqual(['useDefault = true']);

  // Every table's keys and ''' literal sets, exactly, selected by description (also covers R1-n2).
  const EXPECTED: Record<string, Record<string, string[]>> = {
    'PR1-SEC-11 agent docs prose': { paths: [/* the two sources */], regexes: ['Argon2id/bcrypt for passwords'] },
    'D-ORCH-068 PR #39 dd7a2dd effect symbol-key comment': {
      targetRules: ['generic-api-key'], commits: [PR39_COMMIT], paths: [String.raw`^tools/docker/scan-image-secrets\.mjs$`],
      regexes: [/* the two exact sources, as String.raw literals */],
    },
  };
  for (const block of allowlists) {
    const description = /^description = "(.*)"$/mu.exec(block)?.[1] ?? '';
    const keys = [...block.matchAll(/^(\w+)\s*=/gmu)].map((m) => m[1] ?? '')
      .filter((k) => !['description', 'condition', 'regexTarget'].includes(k));
    expect(Object.fromEntries(keys.map((k) => [k, literals(block, k)]))).toEqual(EXPECTED[description]);
  }
  ```

  An extra key (for example `stopwords`), a basic-string array (where `literals` returns `[]`) or any widening then fails the exact comparison. In the same edit, make `allowedBy` treat an absent `paths` or `regexes` as "check not present" (= R1-m2).
- **Verification test:**
  - Mutants G1, G2 and G3 must turn the suite red, and K1 to K12 must stay red.
  - Add a basic-string `commits` mutant, which must turn red.
  - The unmutated file stays green.
- **Owner and due date:** TASK-015 (lane A hardening, PR25-SEC-02 lineage), or the PR #45 author if the code-review MINORs are fixed in this PR. A fix here changes owned paths, so a round-2 record must then name the new head. Due before the next `.gitleaks.toml` change, and before G3.

### PR45-SEC-02 · INFO · The entry works only together with PR #39's follow-through; lifetime rule

- **CWE / OWASP:** CWE-693 (residual; process dependency); A05:2021.
- **Location:** `.gitleaks.toml:32-43`; PR #39 `tools/docker/scan-image-secrets.mjs:272-273` at `dd7a2dd`.
- **Description:** The entry covers PR ranges that contain `dd7a2dd`, and `gitleaks-full` if that commit ever enters main's ancestry. Correctly, it covers the same text in no other commit.
  - So PR #39 must not merge with the values still in its tree. A squash commit would add the lines under a new SHA, and the push lane or `gitleaks-full` would report them. That is the right outcome, but it would leave main red.
  - `756d505` removes the values (R5, R6), but it is not pushed yet.
- **Exploitability and impact:** none for confidentiality, since the values are public. The risk is a red main or a stale re-run.
- **Remediation:**
  - The PR #39 delta round runs the three checks in §3.9.
  - Add one line to the entry comment stating the retirement rule from D-SEC-PR45-01. This folds with R1-m3.
- **Verification test:** the PR #39 security delta record shows the range scan with the merged config (0), the quoted-value count (0) and the ancestor check.
- **Owners:** senior-developer (PR #39); security-analyst (the PR #39 delta round). The comment line is part of the R1-m3 fix.

## 5. Record check (simulation)

I ran main's `tools/ci/check-security-owned-paths.mjs` (the copy lane A runs from the base ref) with `--root <scratch clone> --base 7d19dbb --head <scenario> --pr 45 --json`. The scenario commits were built with plumbing on a sparse `clone --shared` and checked out detached.

| Case | Scenario | Expected | Result |
|---|---|---|---|
| A | This record committed on the head | pass | pass (exit 0), satisfied by this record at `66ae5c1` |
| B | No record | missing | missing (exit 1) |
| C | Verdict changed to FAIL | missing | missing (exit 1) |
| D | The same record named `PR-0039-…` | missing | missing (exit 1) |
| E | A later `.gitleaks.toml` edit after the record | missing | missing (exit 1) |
| F | A later `sec-static.test.ts` edit after the record | missing | missing (exit 1) |
| G | A later docs-only commit after the record | pass | pass (exit 0), satisfied at `66ae5c1` |
| H | The Head SHA replaced by `dd7a2dd` (outside this PR's range) | missing | missing (exit 1) |
| I | No Verdict row | missing | missing (exit 1) |
| J | A merge of current main (`d50d8d9`) after the record, checked with main as the base | pass | pass (exit 0), satisfied at `66ae5c1` |

This record contains exactly one table row whose first cell starts with `Head`, and one `Verdict` row (the last one). I scanned it with the real image in `dir` mode using main's config: 0 findings. The same scan of a copy with a run-time generic secret appended gave 1 finding (`generic-api-key`), which shows the scan can see a finding. A count-only host-fragment scan of this file gave 0 for every needle of §3.8.

## 6. Verdict

| Item | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 1 LOW (PR45-SEC-01), 1 INFO (PR45-SEC-02) |
| Rulings | D-SEC-PR45-01 (§3.4): D-GLALLOW-01 accepted as a narrow second class, and D-SEC-PR25-01 clarified. D-GLALLOW-02, -03 and -04 accepted. D-GLALLOW-05 accepted, with PR45-SEC-01 |
| Merge | May merge once this record is committed, with no owned-path change after the head. Then PR #39 needs a new `pull_request` event (§3.9) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The two `dd7a2dd` matches are public `effect` symbol keys, not secrets. The entry is bound to one full SHA, one path, one rule and two anchored lines, and with the real image it removes exactly those two findings and nothing else. Lane A is unchanged. PR45-SEC-01 (LOW) and PR45-SEC-02 (INFO) are follow-ups, not merge blockers |
