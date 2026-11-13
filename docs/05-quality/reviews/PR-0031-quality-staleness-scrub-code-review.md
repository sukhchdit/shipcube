# PR #31 code review r1: lane B staleness for agent notes, host-path scrub, pending-case gate

VERDICT: APPROVED_WITH_NITS
HEAD REVIEWED: 69a997ce370c37f1540dddd955c737e6a17af1ee (branch fix/quality-staleness-agent-memory-scrub; base a7bb07f, main has since moved with docs-only commits, no file overlap)
SUMMARY: The three D-SEC-PR28-01 items are implemented as ruled. The pattern is exactly `.claude/agent-memory/*/*.md`, held in one constant shared with `docs-or-ci-only`. The mode guard parses `git diff --raw -z --no-renames` correctly. The scrub is a list plus a belt applied at one choke point. The pending-case gate behaves as D-SEC-PR28-01 and the PR #28 record specify. No BLOCKER or MAJOR. Three MINOR and a few NITs, none of which blocks the lane-B evidence of #20/#24/#26/#30.

## 1. Verification I performed myself

- `git archive` of the head into a scratch dir with a node_modules junction (removed; scratch dir deleted; main node_modules count unchanged at 740).
- `jest --selectProjects unit --testPathPatterns tools/quality`: 9 suites, 231 tests, all passed (180 s on this host).
- `prettier --check` on all 12 changed source/doc files: clean.
- `check-evidence --profile pr` at the head, run with BOTH the head checker and the main (base-ref) checker against the real repository: `run 20261113T0810Z_4f6a6c3 accepted`, PASS. Same checker at `--profile wave` and `--profile gate` (report-only) shows the new pending-case problems at gate (SEC-TC-14/-55/-29 at v0.1.0-m0, SEC-TC-22 at G3) and none at wave (no Wave-0-exit entries yet).
- Probe script importing `convert.mjs` and `manifest.mjs` from the head: matcher and scrub cases below.
- 12 mutations of `convert.mjs` in the copy, each run against `convert.test.ts` (restored byte-identical after each):

| Mutation | convert.test.ts |
|---|---|
| prefix regex made case-sensitive | killed |
| generic belt regex made case-sensitive | killed |
| JSON-escaped backslash variant removed | killed |
| 8.3 `<short>` pass removed | killed |
| generic profile pass removed | killed (7 failures) |
| `realpath` additions removed | killed |
| Jest title not scrubbed | killed |
| `scrubCases` message not scrubbed | killed |
| `scrubCases` classname not scrubbed | killed |
| `TEMP`/`TMP`/... env values dropped from the list | SURVIVED (see N1) |
| `jestToCases` classname not scrubbed | SURVIVED (redundant with `scrubCases`, see N1) |

- Committed evidence run `20261113T0810Z_4f6a6c3` (git objects at the head): no profile path, no `AppData`, no 8.3 token, no `<root>`-less temp path; the OS user name (full, 6-character prefix, profile directory name) occurs in no file of the run and in no tracked file at the head. The five `bootstrap.test.ts` cases carry the fixed labels. `git_sha` 4f6a6c3 is an ancestor; the only change since is the run directory. 2679 tests, 2 skipped (the POSIX-only cases), verdict PASS; the manifest hash is the pre-PR manifest, which is correct for a pr-profile run judged by the base manifest.
- Not re-run: `tools/db/bootstrap.test.ts` (title-only change; the committed run proves the five cases pass under their new titles), lint, typecheck, Docker suites. Lane A run 43391844910: fast-lane green; `scans` red only for "Security-owned paths need a review record" (expected, CODEOWNED `tools/quality/**`, see merge conditions).

## 2. Findings

| ID | Sev | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | MINOR | `tools/quality/lib/convert.mjs` `scrubPaths` (prefix loop, ~l.72-82) | The prefix replacement has no boundary check. With a list entry `C:\Users\Alice` the text `c:/users/alicexavier/appdata/x` becomes `<root>xavier/appdata/x` (and the JSON-escaped `ALICEX~1` form becomes `<root>X~1`): the suffix of a longer sibling name survives, and once the list has consumed the prefix the belt can no longer see a profile path. Real exposure is small (another account whose name extends the host account's, or a `/tmp` entry eating `/tmpfoo`), but it is the one way this scrub can leave a partial user name. | Require the match to end at a path boundary: for the regex branch append `(?![A-Za-z0-9_~.$-])`, for the `split` branch use the same lookahead through a regex. Add a convert.test case: prefix `C:\Users\Alice`, input `C:\Users\AliceXavier\x` must not contain `xavier`. |
| M2 | MINOR | `tools/quality/lib/manifest.mjs` `checkpointsReached` / `tools/quality/check-evidence.mjs` gate block; `TEST-STRATEGY.md` l.134, l.559 | `gate` returns all three checkpoints. TEST-STRATEGY says the same `gate` profile also runs the R0 `v0.1.0-m0` regression. At that tag a `G3` entry (today SEC-TC-22, TASK-172, Wave 6) is treated as reached and FAILs unless it carries a `D-` decision; the profile cannot tell the tag from G3. Probed: the head checker at `--profile gate` already lists SEC-TC-22 as reached. Not a defect of this PR's brief (the brief and the README state "gate: all three"), but the M0 tag will hit it. | Either document in README "Suite activation" and TEST-STRATEGY 9.2 that the `v0.1.0-m0` run needs a `decision` on every G3-checkpoint entry (and record that decision then), or add a `--checkpoint v0.1.0-m0` argument that narrows `checkpointsReached('gate')`. A tracked follow-up before the M0 tag is enough. |
| M3 | MINOR | `tools/quality/lib/convert.mjs` `NAME` (~l.50), `WINDOWS_PROFILE` | `NAME` stops at white space, so a Windows account with a space is only half scrubbed by the belt: `C:\Users\Jane Doe\x` becomes `<home> Doe\x`. The list is the control and covers the host's own profile directory (home, `USERPROFILE`, `TEMP`, realpath), so this only affects other accounts' paths. | Allow a space inside the name when the name is followed by a separator (`NAME_SPACED = [^\\/"'<>|:*?\r\n]+(?=SEP)` tried first, falling back to `NAME`). Add one case. |
| N1 | NIT | `convert.test.ts` | Two mutants survive: dropping the env-variable values from `hostScrubList`, and dropping the classname scrub in `jestToCases`. Both are redundant today (`os.tmpdir()` reads `TEMP`; `scrubCases` runs afterwards), so no hole, but the env contribution is not pinned by a test where it differs from `tmpdir()`/`homedir()`. | Add a `hostScrubList` case where `env.LOCALAPPDATA` or `env.TMP` is a path not equal to `homeDir`/`tmpDir`. |
| N2 | NIT | `convert.mjs` belt | A UNC profile (`\\host\share\Users\x`) and a percent-encoded `file:` URL (`Jane%20Doe`) are not covered; the POSIX belt also rewrites a legitimate route text such as ` /home/settings` standing alone in a title to `<home>/...` (cosmetic, only text starting at a separator). Accepted as documented belt limits. | None required; optionally mention in the README paragraph. |
| N3 | NIT | `manifest.mjs` `parsePending` | `decision` is validated by shape (`D-...`) only, like `deferred_at_gate`; a typo'd ID passes. | Acceptable; the G3 human check reads DECISIONS.md. |
| N4 | NIT | `manifest.test.ts` mutation suite | Mutants rewrite only the constant. The guard in `isAgentMemoryNote` (backslash, empty, `.`, `..`) is covered by the seven irregular-spelling cases against the real code, not by a mutation. Fine, noting it. | None. |

No BLOCKER, no MAJOR.

## 3. Focus-item rulings

**Glob matcher (staleness).** Correct and fail-closed. Probed 25 spellings. Allowed only for four-segment `.claude/agent-memory/<x>/<y>.md`. Refused: backslash (both separators), empty segment (`//`), `.`, `..`, nested, no agent dir, trailing slash, `.MD`, `.mdx`, `.md ` (trailing space), NUL, leading `./` or `/`, `x/.claude/...`, `.Claude/...`. On Windows the case is not folded, so a differently-cased spelling is stale (fail closed; git paths are case-sensitive in the tree, so a case-variant is a different path). Residual: a file literally named `.md` or `.x.md`, or a name containing `..` inside a segment (`a..b`), is allowed; they are four-segment `.md` regular files, harmless. `*` and `**` as literal file names (`a/*.md`) are allowed too, harmless.

**Mutation suite.** Meaningful: it loads a copy of the real `manifest.mjs` with the constant line replaced (asserting the replace target occurs exactly once), proves an unchanged copy passes, and shows six widenings fail the 13-case table. The 13 cases are the record's table plus the symlink case. The guard code is covered separately (N4).

**Mode guard (`git diff --raw -z`).** Correct. `--no-renames` makes every entry `:<old> <new> <sha> <sha> <status>\0<path>\0`, so the two-tokens-per-entry loop is right; copies cannot occur; type changes (`T`) carry the modes; the regex is strict and an unexpected shape throws (exit 2, fail closed); NUL is the only separator so paths with spaces, newlines or non-ASCII are safe; `--no-abbrev` gives full hashes. An allowed path stays allowed only for `100644`/`000000` on both sides, so add/delete pass and 120000/160000/100755 on either side do not (rename into or out of an allowed path is delete+add and is judged per side). Applied to `docs/**` too: `git ls-tree` at the head shows no non-100644 entry under `docs/` or `.claude/`. Tests cover symlink, submodule, executable, docs executable, and the CLI path on throw-away repositories (mode staged with `--cacheinfo`, so no symlink support needed on Windows).

**Selection rule sharing the constant.** Intended and safe. `docs-or-ci-only` now lists the constant, `manifest.test.ts` pins that it is the only rule that does, exactly once, and that `.claude` appears nowhere else in the manifest (`settings.json`, agents, commands still select `unit`). A memory-only PR is lane-A-only and needs no run, which is what D-SEC-PR28-01 allowed ("safe for the same reasons"). A mixed PR (memory plus code) is selected by the code paths. A symlink or executable named like a note, alone in a PR, also selects nothing; that is acceptable because nothing a suite reads can change and the guard rejects it the moment it follows evidence.

**Scrub.** List complete for this host class: repo root, `homedir()`, `tmpdir()`, `TEMP`/`TMP`/`TMPDIR`/`USERPROFILE`/`HOME`/`LOCALAPPDATA`/`APPDATA`, plus `realpathSync.native` of each (a throwing realpath is caught and the literal kept), trailing separators trimmed, entries shorter than 4 dropped, longest first. Probed with a fake 8.3 temp directory: long and short forms both reduce to `<root>`; Windows-style prefixes match case-insensitively; JSON-escaped `\\` form is scrubbed (mutation-checked); Git-Bash `/c/Users/x` and WSL `/mnt/c/Users/x` forms go to `<home>`; `apps/api/src/users/home.ts`, `https://.../home/page`, `/api/users/42` and `C:\Users` alone are untouched; repo-relative paths are not over-scrubbed (the generic belt needs a drive letter or a leading separator and is look-behind guarded). The 8.3 pass requires a separator before and a separator, space, quote or end after, and `{1,8}~digits`, so `v1.0`, `~6.0.3` and bare `~1` survive. Titles, classnames and messages are scrubbed in `jestToCases` and again in `done()`, which every `runSuite` return path goes through (checked: native converter output, Jest output, the early-return case); native JSON is scrubbed after `JSON.stringify`. Weak points are M1 and M3, both bounded by the list being the control.

**Pending-case gate.** Mapping is as ruled: `wave` reaches only `Wave-0 exit`, `gate` all three, `pr` none (M2 is the one wrinkle). A `D-` decision exempts the "still parked" problem but not the "implemented" problem (right: an implemented ID must return to `required_cases`). The implemented check is by title with the digit-boundary `nameHasId`, only over passing cases of the accepted run, a NOTE at `pr` (probed: the base-manifest judges the PR that adds the test) and a problem at `wave`/`gate`. `parseManifest` validation covers bad ID, owner, checkpoint, decision, unknown suite, non-array, and throws `ManifestError` (CLI exit 2; tested). Tests: gate fail/decision/empty, three wave checkpoints, pr never fails, implemented at wave fails, note at pr, `SEC-TC-140` does not satisfy `SEC-TC-14`, malformed entry exit 2.

**Evidence run committed.** Valid (accepted by both checkers), scrubbed (section 1). The earlier evidence commit `3fc9165` and `d6338a6` runs were superseded by `69a997c`; confirm the final squash carries one run (the squash does).

**bootstrap.test.ts title change.** Correct: fixed labels, `%s` replaced by the label; the assertion is unchanged. The committed JUnit shows the five new titles.

**Windows test-time cost.** The ~138 s file is the existing `bootstrap.test.ts` suite (real file system and link work), unchanged by this PR; the new `heavy.test.ts` end-to-end scrub case adds a few seconds. My targeted `tools/quality` run took 180 s for 231 tests on this host, in line with the earlier lane-B unit duration (256 s for 2679 tests). No action.

## 4. GOOD

- One exported constant, asserted equal in the manifest rule, with a test that nothing else in the manifest mentions `.claude`.
- Fail-closed parsing everywhere (`git diff --raw` shape, pending entries).
- Scrub applied at one choke point regardless of converter, plus a fixture-based end-to-end test that asserts absence of the real temp directory and profile forms across every file of a run.
- Mutation tests that load the real module source rather than a hand copy.
- The decision to make the "implemented" rule a note at `pr` is documented with the deadlock reason.

## 5. SECURITY-FLAGS (for security-analyst)

- Confirm the exact pattern, mode guard and shared selection against PR28-SEC-03 items 1-5 and rate the new `docs-or-ci-only` entry; `tools/quality/**` is CODEOWNED so a `PR-0031` security record is required.
- Confirm PR28-SEC-01 and PR28-SEC-02 closure; note M1 (no boundary) and M3 (spaced account names) as residuals of the belt.
- M2 touches the gate semantics for the M0 tag: decide whether a `--checkpoint` narrowing is wanted.
- Re-scan the committed run directory with the profile-path search once more before merge (done by me: clean).

## 6. Merge conditions

1. Security record `PR-0031` for the CODEOWNED `tools/quality/**` paths lands; the `scans` check "Security-owned paths need a review record" is then green. No other check is red.
2. M1 and M3 may be taken in this PR (small) or tracked as devops follow-ups; neither blocks. M2 must be tracked (README note or `--checkpoint`) before the `v0.1.0-m0` tag.
3. Any code push after this review (beyond a docs-only record) needs a delta review and, because the evidence run is bound to 4f6a6c3, a fresh lane-B run (a `tools/quality` change is not staleness-allowed). A docs-only commit keeps the run valid.
4. Squash-merge; this PR must merge before any other PR commits lane-B evidence (D-ORCH-035).
